import { Argv } from 'yargs';
import fs from 'fs';
import uploadCmd from './cmd/upload';
import instantiateCmd from './cmd/instantiate';
import deployCmd from './cmd/deploy';
import executeCmd from './cmd/execute';
import migrateCmd from './cmd/migrate';
import queryCmd from './cmd/query';

export default (yargs: Argv) => {
  yargs
    .usage('usage: $0 wasm <command> [options]')
    .config('file-input', (path) => {
      return { input: fs.readFileSync(path).toString() };
    })
    .command('upload', 'upload a smart contract', uploadCmd)
    .command('instantiate', 'instantiate a smart contract', instantiateCmd)
    .command('deploy', 'deploy a smart contract using cosmjs', deployCmd)
    .command('execute', 'execute a smart contract using cosmjs', executeCmd)
    .command('migrate', 'migrate a smart contract', migrateCmd)
    .command('query', 'query a smart contract using cosmjs', queryCmd)
    .option('input', {
      describe: 'the input to initilize smart contract',
      default: '{}',
      type: 'string'
    });
};
