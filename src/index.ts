#!/usr/bin/env node

import dotenv from 'dotenv';
import * as fs from 'fs';
import path from 'path';
import readlineSync from 'readline-sync';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { decrypt } from './common';
import gentsCmd from './cmd/gents';
import buildCmd from './cmd/build';
import wasmCmd from './cmd/wasm';

let password: string;
const decryptMnemonic = (mnemonic: string) => {
  if (mnemonic && mnemonic.indexOf(' ') === -1) {
    if (!password) {
      password = readlineSync.question('enter passphrase:', { hideEchoBack: true });
    }
    return decrypt(password, mnemonic);
  }
  return mnemonic;
};

yargs(hideBin(process.argv))
  .scriptName('cwtools')
  .version('0.1.0')
  .config('env', (path) => {
    const config = dotenv.config({ path }).parsed ?? {};
    return { mnemonic: config.ENCRYPTED_MNEMONIC ? decryptMnemonic(config.ENCRYPTED_MNEMONIC) : config.MNEMONIC };
  })
  .config('file-input', (path) => {
    return { input: fs.readFileSync(path).toString() };
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
