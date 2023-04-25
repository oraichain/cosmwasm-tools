#!/usr/bin/env node

const { spawn } = require('child_process');
const { watch } = require('fs');

const packages = [];
let buildDebug = false;
let buildSchema = false;
let output;
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
    case '--output':
    case '-o':
      output = process.argv[++i];
      break;
    default:
      // update new packages
      packages.push(arg);
      break;
  }
}

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
