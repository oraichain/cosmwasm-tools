const { spawn } = require('child_process');
const { watch } = require('fs');

const packages = [];
let buildDebug = false;
let buildSchema = false;
let watchContract = false;
for (const arg of process.argv.slice(2)) {
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
      case 'd':
        buildDebug = true;
        break;
      case 's':
        buildSchema = true;
        break;
      case 'w':
        watchContract = true;
        break;
    }
  }
}

// run build command first
const args = ['build_contract.sh'];
if (buildSchema) args.push('-s');
if (buildDebug) args.push('-d');

// start process
const buildProcess = spawn('bash', args.concat(packages), { cwd: process.cwd(), env: process.env, stdio: 'inherit' });
buildProcess.on('close', () => {
  if (watchContract) {
    console.log(`\n\nWatching these contract folders:\n ${packages.join('\n')}`);
    packages.forEach((contractFolder) => {
      let timer = null;
      watch(contractFolder, { recursive: true }, (_, filename) => {
        if (!filename.endsWith('.rs')) return;
        // 500ms throttling
        clearTimeout(timer);
        timer = setTimeout(() => spawn('bash', args.concat([contractFolder]), { cwd: process.cwd(), env: process.env, stdio: 'inherit' }), 500);
      });
    });
  }
});
