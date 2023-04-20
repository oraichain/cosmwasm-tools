import { spawn } from 'child_process';
import { watch } from 'fs';

(async () => {
  const packages: string[] = [];
  let buildDebug = false;
  let buildSchema = false;
  let watchContract = false;
  for (let i = 2; i < process.argv.length; ++i) {
    const arg = process.argv[i];
    if (!arg.startsWith('-')) {
      packages.push(arg);
      continue;
    }

    // processing options
    const options = arg.substring(1);

    // long options
    if (options.startsWith('-')) {
      switch (options.substring(1)) {
        case 'debug':
          buildDebug = true;
          break;
        case 'schema':
          buildSchema = true;
          break;
        case 'watch':
          watchContract = true;
          break;
      }
      continue;
    }

    // normal options
    for (const option of options) {
      switch (option) {
        case '-d':
          buildDebug = true;
          break;
        case '-s':
          buildSchema = true;
          break;
        case '-w':
          watchContract = true;
          break;
      }
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
