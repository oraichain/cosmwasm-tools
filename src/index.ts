#!/usr/bin/env node

import dotenv from 'dotenv';
import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import gentsCmd from './cmd/gents';
import buildCmd from './cmd/build';
import wasmCmd from './cmd/wasm';

yargs(hideBin(process.argv))
  .scriptName('cwtools')
  .version('0.1.0')
  .config('env', (path) => {
    return dotenv.config({ path }).parsed ?? {};
  })
  .default('env', '.env')
  // all commands
  .command('gents', 'generate TypeScript classes for the contract folders', gentsCmd)
  .command('build', 'build a list of contract folders', buildCmd)
  .command('wasm', 'wasm commands', wasmCmd)
  .command('script', 'run custom script', async (yargs) => {
    const { argv } = yargs.usage('usage: $0 script path').positional('path', {
      describe: 'a script command',
      type: 'string'
    });
    // @ts-ignore
    require(path.resolve(argv._[1]))(argv);
  })
  .option('help', {
    alias: 'h',
    demandOption: false
  })
  .parse();
