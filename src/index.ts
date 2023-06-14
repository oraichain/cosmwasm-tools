#!/usr/bin/env node

import dotenv from 'dotenv';
import path from 'path';
import readlineSync from 'readline-sync';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { version } from '../package.json';
import buildCmd from './cmd/build';
import gentsCmd from './cmd/gents';
import wasmCmd from './cmd/wasm';
import { encrypt } from './common';

yargs(hideBin(process.argv))
  .scriptName('cwtools')
  .version(version)
  .config('env', (path) => {
    return dotenv.config({ path }).parsed ?? {};
  })
  .default('env', '.env')
  // all commands
  .command('gents', 'generate TypeScript classes for the contract folders', gentsCmd)
  .command('build', 'build a list of contract folders', buildCmd)
  .command('wasm', 'wasm commands', wasmCmd)
  .command('encrypt', 'encrypt mnemonic from file or input', async (yargs) => {
    const { argv } = yargs.usage('usage: $0 encrypt [path]').positional('path', {
      describe: 'a mnemonic file',
      type: 'string'
    });

    // @ts-ignore
    const mnemonic = (argv?._[1] ? require('fs').readFileSync(argv._[1]).toString() : readlineSync.question('enter mnemonic:', { hideEchoBack: true })).trim();
    const password = readlineSync.question('enter passphrase:', { hideEchoBack: true });
    console.log(encrypt(password, mnemonic));
  })
  .command('script', 'run custom script', async (yargs) => {
    const { argv } = yargs.usage('usage: $0 script path').positional('path', {
      describe: 'a script command',
      type: 'string'
    });
    // @ts-ignore
    (__non_webpack_require__ ?? require)(path.resolve(argv._[1]))(argv);
  })
  .option('help', {
    alias: 'h',
    demandOption: false
  })
  .parse();
