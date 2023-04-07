import { spawn } from 'child_process';
import crypto from 'crypto';
import fs, { watch } from 'fs';

(async () => {
  const packages: string[] = [];
  let buildDebug = false;
  let buildSchema = false;
  let watchContract = false;
  for (let i = 2; i < process.argv.length; ++i) {
    const arg = process.argv[i];
    switch (arg) {
      case '--debug':
      case '-d':
        buildDebug = true;
        break;
      case '--schema':
      case '-s':
        buildSchema = true;
        break;
      case '--watch':
      case '-w':
        watchContract = true;
        break;
      default:
        packages.push(arg);
        break;
    }
  }

  // run build command first
  let args = ['build_contract.sh', ...packages];
  if (buildSchema) args.push('-s');
  if (buildDebug) args.push('-d');

  const buildProcess = spawn('bash', args, { cwd: process.cwd(), env: process.env, stdio: 'inherit' });

  buildProcess.on('close', () => {
    if (watchContract) {
      console.log(`\n\nWatching these contract folders:\n ${packages.join('\n')}`);

      packages.forEach((contractFolder) => {
        watch(contractFolder, { recursive: true }, (_, filename) => {
          if (!filename.endsWith('.rs')) return;
          let args = ['build_contract.sh', contractFolder];
          if (buildSchema) args.push('-s');
          if (buildDebug) args.push('-d');
          spawn('bash', args, { cwd: process.cwd(), env: process.env, stdio: 'inherit' });
        });
      });
    }
  });
})();
