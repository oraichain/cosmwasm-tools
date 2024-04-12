import { execFileSync } from 'child_process';
import { watch } from 'chokidar';
import * as fs from 'fs';
import os from 'os';
import { basename, join, resolve } from 'path';
import { Argv } from 'yargs';
import { buildSchema, getWasmOpt, filterContractDirs, spawnPromise } from '../common';

const {
  existsSync,
  promises: { mkdir, rm, stat }
} = fs;

const buildContract = async (packageName: string, contractDir: string, debug: boolean, output: string, targetDir: string, optimizeArgs: string[], cargoArgs: string[], RUSTFLAGS = []) => {
  const buildName = packageName.replaceAll('-', '_');
  const artifactDir = join(contractDir, 'artifacts');
  const outputDir = resolve(output || artifactDir);
  const wasmFile = join(outputDir, packageName + '.wasm');
  console.log(`Building contract in ${outputDir}`);
  // Linker flag "-s" for stripping (https://github.com/rust-lang/cargo/issues/3483#issuecomment-431209957)
  // Note that shortcuts from .cargo/config are not available in source code packages from crates.io
  if (!existsSync(outputDir)) {
    await mkdir(outputDir);
  }
  // rm old file to clear cache when displaying size
  await rm(wasmFile, { force: true });
  const options = {
    RUSTFLAGS: [...new Set(['-C', 'link-arg=-s'].concat(RUSTFLAGS))].join(' '),
    CARGO_INCREMENTAL: process.env.RUSTC_WRAPPER === 'sccache' ? '0' : '1'
  };

  const wasmOptPath = await getWasmOpt();

  const cargoCmd = RUSTFLAGS.some((arg) => arg.startsWith('-Zlocation-detail')) ? ['+nightly'] : [];

  if (debug) {
    await spawnPromise('cargo', [...cargoCmd, 'build', ...cargoArgs, '-q', '--lib', '--target-dir', targetDir, '--target', 'wasm32-unknown-unknown'], contractDir, options);
    console.log(`Optimizing ${wasmFile}`);
    await spawnPromise(wasmOptPath, ['-O1', '--signext-lowering', join(targetDir, 'wasm32-unknown-unknown', 'debug', buildName + '.wasm'), '-o', wasmFile], contractDir);
  } else {
    await spawnPromise('cargo', [...cargoCmd, 'build', ...cargoArgs, '-q', '--release', '--lib', '--target-dir', targetDir, '--target', 'wasm32-unknown-unknown'], contractDir, options);
    console.log(`Optimizing ${wasmFile}`);
    await spawnPromise(wasmOptPath, [...optimizeArgs, '--signext-lowering', join(targetDir, 'wasm32-unknown-unknown', 'release', buildName + '.wasm'), '-o', wasmFile], contractDir);
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
const buildContracts = async (packages: string[], debug: boolean, schema: boolean, watchMode: boolean, output: string, optimizeArgs: string[], cargoArgs: string[], RUSTFLAGS: string[]) => {
  const cargoDir = join(os.homedir(), '.cargo');
  const targetDir = join(cargoDir, 'target');

  // filter contract folder only
  const contractDirRet = filterContractDirs(packages);

  if (!contractDirRet.length) return;

  if (schema) {
    return await Promise.all(contractDirRet.map(([contractDir, packageName]) => buildSchema(packageName, contractDir, targetDir)));
  }

  // make cargo load crates faster
  process.env.CARGO_REGISTRIES_CRATES_IO_PROTOCOL = 'sparse';

  if (process.env.RUSTC_WRAPPER === 'sccache') {
    const sccacheDir = join(cargoDir, 'bin', 'sccache');
    if (existsSync(sccacheDir)) {
      console.log('Info: sccache stats before build');
      execFileSync('sccache', ['-s'], { stdio: 'inherit' });
    } else {
      console.log("Run: 'cargo install sccache' for faster build");
    }
  }

  const outputDir = output ? resolve(output) : output;

  // run build all frist
  await Promise.all(
    contractDirRet.map(async ([contractDir, packageName]) => {
      return await buildContract(packageName, contractDir, debug, outputDir, targetDir, optimizeArgs, cargoArgs, RUSTFLAGS);
    })
  );

  // start watching process
  const contractDirs = contractDirRet.map(([c]) => c);
  if (watchMode) {
    console.log(`\n\nWatching these contract folders:\n ${contractDirs.join('\n')}`);
    const running = {};
    const interval = 1000;
    watch(contractDirs, { persistent: true, interval }).on('change', async (filename) => {
      if (!filename.endsWith('.rs')) return;
      // get first path that contains file
      const [contractDir, packageName] = contractDirRet.find(([c]) => filename.startsWith(c));
      // running
      if (running[contractDir]) return;
      running[contractDir] = true;
      const start = Date.now();
      await buildContract(packageName, contractDir, debug, outputDir, targetDir, optimizeArgs, cargoArgs, RUSTFLAGS);
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
      default: '-Os --low-memory-unused'
    })
    .option('cargo', {
      type: 'string',
      description: 'Pass args to `cargo`',
      default: ''
    });

  const start = Date.now();
  // @ts-ignore
  await buildContracts(argv._.slice(1), argv.debug, argv.schema, argv.watch, argv.output, argv.optimize.split(/\s+/), argv.cargo.split(/\s+/), argv.RUSTFLAGS?.split(/\s+/));
  console.log('✨ all done in', Date.now() - start, 'ms!');
};
