#!/usr/bin/env node
import yargs from 'yargs';
import toml from 'toml';
import os from 'os';
import { hideBin } from 'yargs/helpers';
import { spawn, execFileSync } from 'child_process';
import { watch } from 'chokidar';
import codegen, { ContractFile } from '@cosmwasm/ts-codegen/packages/ts-codegen';
import * as fs from 'fs';
import { resolve, basename, join } from 'path';
import { File, TypescriptParser } from 'typescript-parser';

const {
  existsSync,
  promises: { readdir, readFile, writeFile, rm, mkdir, stat, copyFile }
} = fs;

const spawnPromise = async (cmd: string, args: readonly string[], currentDir?: string, env?: NodeJS.ProcessEnv) => {
  const proc = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: 'inherit', cwd: currentDir });
  return await new Promise((resolve, reject) => {
    proc.on('close', resolve);
    proc.on('error', reject);
  });
};

const genTS = async (contracts: Array<ContractFile>, tsFolder: string, enabledReactQuery: boolean = false) => {
  const outPath = resolve(tsFolder);
  await rm(outPath, { recursive: true, force: true });
  await codegen({
    contracts,
    outPath,

    // options are completely optional ;)
    options: {
      bundle: {
        bundleFile: 'index.ts',
        scope: 'contracts'
      },
      types: {
        enabled: true
      },
      client: {
        enabled: true
      },
      reactQuery: {
        enabled: enabledReactQuery,
        optionalClient: true,
        version: 'v4',
        mutations: true
      },
      recoil: {
        enabled: false
      },
      messageComposer: {
        enabled: false
      }
    }
  });

  await fixTs(outPath, enabledReactQuery);
};

const isPrivateType = (type: string) => {
  return type.endsWith('Response') || type === 'InstantiateMsg' || type === 'ExecuteMsg' || type === 'QueryMsg' || type === 'MigrateMsg';
};

const fixImport = async (clientName: string, ext: string, typeData: { [key: string]: string }, outPath: string) => {
  const clientFile = join(outPath, `${clientName}.${ext}`);
  const clientData = await readFile(clientFile);

  await writeFile(
    clientFile,
    clientData.toString().replace(new RegExp(`import\\s+\\{(.*?)\\}\\s+from\\s+"\\.\\/${clientName}\\.types";`), (_, g1: string) => {
      const [clientImportData, typesImportData] = g1
        .trim()
        .split(/\s*,\s*/)
        .reduce(
          (ret, el) => {
            ret[!typeData[el] ? 0 : 1].push(el);
            return ret;
          },
          [[], []]
        );

      return `import {${typesImportData.join(', ')}} from "./types";\nimport {${clientImportData.join(', ')}} from "./${clientName}.types";`;
    })
  );
};

const fixTs = async (outPath: string, enabledReactQuery = false) => {
  const parser = new TypescriptParser();
  const typeExt = '.types.ts';
  const typeData: { [key: string]: string } = {};
  const parsedData: { [key: string]: File } = {};
  const dirs = (await readdir(outPath)).filter((dir) => dir.endsWith(typeExt));

  await Promise.all(
    dirs.map(async (dir) => {
      const tsFile = join(outPath, dir);
      const tsData = (await readFile(tsFile)).toString();
      const parsed = await parser.parseSource(tsData);
      parsedData[dir] = parsed;

      for (let token of parsed.declarations) {
        if (!isPrivateType(token.name) && !typeData[token.name]) {
          typeData[token.name] = tsData.substring(token.start ?? 0, token.end);
        }
      }
    })
  );

  const classNames = await Promise.all(
    dirs.map(async (dir) => {
      const tsFile = join(outPath, dir);
      const tsData = (await readFile(tsFile)).toString();
      const parsed = parsedData[dir];
      const modifiedTsData: string[] = [];
      const importData: string[] = [];

      for (let token of parsed.declarations) {
        if (typeData[token.name]) {
          importData.push(token.name);
        } else {
          modifiedTsData.push(tsData.substring(token.start ?? 0, token.end));
        }
      }

      // import from types, and remove from client
      modifiedTsData.unshift(`import {${importData.join(', ')}} from "./types";`);

      await writeFile(tsFile, modifiedTsData.join('\n'));

      // update client file

      const className = basename(dir, typeExt);
      await fixImport(className, 'client.ts', typeData, outPath);

      if (enabledReactQuery) {
        await fixImport(className, 'react-query.ts', typeData, outPath);
      }
      return className;
    })
  );

  await writeFile(join(outPath, 'types.ts'), Object.values(typeData).join('\n'));

  const indexData = [];
  for (const className of classNames) {
    indexData.push(`export * as ${className}Types from './${className}.types';`);
    indexData.push(`export * from './${className}.client';`);
  }

  // add export from types
  indexData.push('export * from "./types";');
  // re-export
  await writeFile(join(outPath, 'index.ts'), indexData.join('\n'));
};

const genTypescripts = async (packages: string[], enabledReactQuery: boolean, output = 'build') => {
  const contracts = await Promise.all(
    packages.map(async (packagePath) => {
      const baseName = basename(packagePath);
      const schemaDir = join(packagePath, 'artifacts', 'schema');
      if (!existsSync(schemaDir)) return false;

      return {
        name: baseName.replace(/^.|_./g, (m) => m.slice(-1).toUpperCase()),
        dir: schemaDir
      };
    })
  );
  await genTS(contracts.filter(Boolean) as ContractFile[], output, enabledReactQuery);
};

const buildSchemas = async (packages: string[], targetDir: string) => {
  const res = await Promise.all(
    packages.map(async (contractDir) => {
      const binCmd = existsSync(join(contractDir, 'src', 'bin')) ? '--bin' : '--example';
      const artifactDir = join(contractDir, 'artifacts');
      if (!existsSync(artifactDir)) {
        await mkdir(artifactDir);
      }
      return [binCmd, artifactDir];
    })
  );

  // schema can not run in parallel
  for (const [binCmd, artifactDir] of res) {
    execFileSync('cargo', ['run', '-q', binCmd, 'schema', '--target-dir', targetDir], { cwd: artifactDir, env: process.env, stdio: 'inherit' });
  }
};

const buildContract = async (contractDir: string, debug: boolean, output: string, targetDir: string) => {
  // name is extract from Cargo.toml
  const cargoPath = join(contractDir, 'Cargo.toml');
  const name = basename(contractDir);
  const buildName = toml.parse(await readFile(cargoPath).then((b) => b.toString())).package.name.replaceAll('-', '_');
  const artifactDir = join(contractDir, 'artifacts');
  const outputDir = output || artifactDir;
  const wasmFile = join(outputDir, name + '.wasm');
  console.log(`Building contract in ${outputDir}`);
  // Linker flag "-s" for stripping (https://github.com/rust-lang/cargo/issues/3483#issuecomment-431209957)
  // Note that shortcuts from .cargo/config are not available in source code packages from crates.io
  if (!existsSync(outputDir)) {
    await mkdir(outputDir);
  }
  // rm old file to clear cache when displaying size
  await rm(wasmFile, { force: true });
  if (debug) {
    await spawnPromise('cargo', ['build', '-q', '--lib', '--target-dir', targetDir, '--target', 'wasm32-unknown-unknown'], contractDir);
    await copyFile(join(targetDir, 'wasm32-unknown-unknown', 'debug', buildName + '.wasm'), wasmFile);
  } else {
    await spawnPromise('cargo', ['build', '-q', '--release', '--lib', '--target-dir', targetDir, '--target', 'wasm32-unknown-unknown'], contractDir, {
      RUSTFLAGS: '-C link-arg=-s'
    });

    // wasm-optimize on all results
    console.log(`Optimizing ${wasmFile}`);
    await spawnPromise('wasm-opt', ['-Os', join(targetDir, 'wasm32-unknown-unknown', 'release', buildName + '.wasm'), '-o', wasmFile], contractDir);
  }

  // show content
  const { size } = await stat(wasmFile);
  const i = size == 0 ? 0 : Math.floor(Math.log(size) / Math.log(1024));
  const fileSize = (size / Math.pow(1024, i)).toFixed(0) + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][i];

  console.log(fileSize, wasmFile);
};

/**
 *
 * @param packages
 * @param buildDebug
 * @param buildSchema
 * @param watchContract
 * @param output
 */
const buildContracts = async (packages: string[], debug: boolean, schema: boolean, watchMode: boolean, output: string) => {
  const cargoDir = join(os.homedir(), '.cargo');
  const targetDir = join(cargoDir, 'target');

  if (schema) {
    return await buildSchemas(packages, targetDir);
  }

  // filter contract folder only
  const contractDirs = packages
    .filter((contractDir) => {
      return existsSync(join(contractDir, 'Cargo.toml'));
    })
    .map((contractDir) => resolve(contractDir));

  if (!contractDirs.length) return;

  // make cargo load crates faster
  process.env.CARGO_REGISTRIES_CRATES_IO_PROTOCOL = 'sparse';

  const sccacheDir = join(cargoDir, 'bin', 'sccache');
  if (existsSync(sccacheDir)) {
    process.env.RUSTC_WRAPPER = 'sccache';
    console.log('Info: sccache stats before build');
    execFileSync('sccache', ['-s'], { stdio: 'inherit' });
  } else {
    console.log("Run: 'cargo install sccache' for faster build");
  }

  const outputDir = output ? resolve(output) : output;

  // run build all frist
  await Promise.all(
    contractDirs.map(async (contractDir) => {
      return await buildContract(contractDir, debug, outputDir, targetDir);
    })
  );

  // start watching process
  if (watchMode) {
    console.log(`\n\nWatching these contract folders:\n ${contractDirs.join('\n')}`);
    let timer: NodeJS.Timer;
    const interval = 1000;
    watch(contractDirs, { persistent: true, interval }).on('change', (filename) => {
      if (!filename.endsWith('.rs')) return;
      // get first path that contains file
      clearTimeout(timer);
      const contractFolder = contractDirs.find((p) => filename.startsWith(p));
      timer = setTimeout(buildContract, interval, contractFolder, debug, outputDir, targetDir);
    });
  }
};

yargs(hideBin(process.argv))
  .scriptName('cwtools')
  .version('0.1.0')
  .command(
    'gents <paths...>',
    'build a list of contract folders',
    (yargs) => {
      return yargs.option('--react-query', {
        type: 'boolean',
        description: 'Build with react-query support',
        default: false
      });
    },
    async (argv) => {
      const start = Date.now();
      // @ts-ignore
      await genTypescripts(argv.paths, argv.reactQuery, argv.output);
      console.log('✨ all done in', Date.now() - start, 'ms!');
    }
  )
  .command(
    'build <paths...>',
    'build a list of contract folders',
    (yargs) => {
      return yargs
        .option('debug', {
          alias: 'd',
          type: 'boolean',
          description: 'Build with cargo debug',
          default: false
        })
        .option('schema', {
          alias: 's',
          type: 'boolean',
          description: 'Build cargo schema only',
          default: false
        })
        .option('watch', {
          alias: 'w',
          type: 'boolean',
          description: 'Build with watch mode',
          default: false
        });
    },
    async (argv) => {
      const start = Date.now();
      // @ts-ignore
      await buildContracts(argv.paths, argv.debug, argv.schema, argv.watch, argv.output);
      console.log('✨ all done in', Date.now() - start, 'ms!');
    }
  )
  .positional('paths', {
    describe: 'a list of contract folders',
    type: 'string'
  })
  .option('help', {
    alias: 'h',
    demandOption: false
  })
  .option('output', {
    alias: 'o',
    type: 'string',
    description: 'The output folder',
    default: undefined
  })
  .parse();
