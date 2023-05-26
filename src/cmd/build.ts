// @ts-nocheck
import { execFileSync } from 'child_process';
import { watch } from 'chokidar';
import * as fs from 'fs';
import os from 'os';
import { basename, join, resolve } from 'path';
import toml from 'toml';
import { Argv } from 'yargs';
import { spawnPromise } from '../common';

const {
  existsSync,
  promises: { mkdir, readFile, copyFile, rm, stat }
} = fs;

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

const buildContract = async (contractDir: string, debug: boolean, output: string, targetDir: string, optimizeArgs: string[]) => {
  // name is extract from Cargo.toml
  const cargoPath = join(contractDir, 'Cargo.toml');
  const name = basename(contractDir);
  const tomlObj = toml.parse(await readFile(cargoPath).then((b) => b.toString()));
  if (!tomlObj.package?.name) {
    return console.warn(`"${contractDir}" is not a contract folder!`);
  }
  const buildName = tomlObj.package.name.replaceAll('-', '_');
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
    await spawnPromise('wasm-opt', [...optimizeArgs, '--disable-sign-ext', join(targetDir, 'wasm32-unknown-unknown', 'release', buildName + '.wasm'), '-o', wasmFile], contractDir);
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
const buildContracts = async (packages: string[], debug: boolean, schema: boolean, watchMode: boolean, output: string, optimizeArgs: string[]) => {
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
      return await buildContract(contractDir, debug, outputDir, targetDir, optimizeArgs);
    })
  );

  // start watching process
  if (watchMode) {
    console.log(`\n\nWatching these contract folders:\n ${contractDirs.join('\n')}`);
    const running = {};
    const interval = 1000;
    watch(contractDirs, { persistent: true, interval }).on('change', async (filename) => {
      if (!filename.endsWith('.rs')) return;
      // get first path that contains file
      const contractDir = contractDirs.find((p) => filename.startsWith(p));
      // running
      if (running[contractDir]) return;
      running[contractDir] = true;
      const start = Date.now();
      await buildContract(contractDir, debug, outputDir, targetDir, optimizeArgs);
      running[contractDir] = false;
      console.log('✨ all done in', Date.now() - start, 'ms!');
    });
  }
};

export default async (yargs: Argv) => {
  const { argv } = yargs
    .usage('usage: $0 build <paths...> [options]')
    .positional('paths', {
      describe: 'a list of contract folders',
      type: 'string'
    })
    .option('output', {
      alias: 'o',
      type: 'string',
      description: 'The output folder',
      default: undefined
    })
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
    })
    .option('optimize', {
      type: 'string',
      description: 'Pass args to `wasm-opt`',
      default: '-Os'
    });

  const start = Date.now();
  await buildContracts(argv._.slice(1), argv.debug, argv.schema, argv.watch, argv.output, argv.optimize.split(/\s+/));
  console.log('✨ all done in', Date.now() - start, 'ms!');
};
