#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { spawn } from 'child_process';
import { watch } from 'chokidar';
import codegen, { ContractFile } from '@cosmwasm/ts-codegen/packages/ts-codegen';
import * as fs from 'fs';
import { resolve, basename, join } from 'path';
import { File, TypescriptParser } from 'typescript-parser';

const {
  existsSync,
  promises: { readdir, readFile, writeFile, rm }
} = fs;

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

  console.log('✨ all done!');
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

const buildContracts = (packages: string[], buildDebug: boolean, buildSchema: boolean, watchContract: boolean, output: string) => {
  // run build command first
  const args = ['build_contract.sh'];
  if (buildSchema) args.push('-s');
  if (buildDebug) args.push('-d');
  if (output) args.push('-o', output);

  // start process
  const buildProcess = spawn('bash', args.concat(packages), { cwd: process.cwd(), env: process.env, stdio: 'inherit' });
  buildProcess.on('close', () => {
    if (watchContract) {
      console.log(`\n\nWatching these contract folders:\n ${packages.join('\n')}`);
      let timer: NodeJS.Timer;
      const interval = 1000;
      watch(packages, { persistent: true, interval }).on('change', (filename) => {
        if (!filename.endsWith('.rs')) return;
        // get first path that contains file
        clearTimeout(timer);
        const contractFolder = packages.find((p) => filename.startsWith(p));
        timer = setTimeout(spawn, interval, 'bash', args.concat([contractFolder]), { cwd: process.cwd(), env: process.env, stdio: 'inherit' });
      });
    }
  });
};

yargs(hideBin(process.argv))
  .scriptName('cwtools')
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
    (argv) => {
      // @ts-ignore
      genTypescripts(argv.paths, argv.reactQuery, argv.output);
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
    (argv) => {
      // @ts-ignore
      buildContracts(argv.paths, argv.debug, argv.schema, argv.watch, argv.output);
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
