#!/usr/bin/env node

import { spawn } from 'child_process';
import { watch } from 'chokidar';

const packages = [];
let buildDebug = false;
let buildSchema = false;
let output: string;
let watchContract = false;

for (let i = 2; i < process.argv.length; ++i) {
  const arg = process.argv[i];
  switch (arg) {
    case '-h':
    case '--help':
      console.log('%s contracts/package1 contracts/package2 contracts/package3 [-o build_folder] [-d] [-s] [-w]', process.argv[1].split('/').pop());
      process.exit();
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
    let timer: NodeJS.Timer;
    const interval = 1000;
    watch(packages, { persistent: true, interval }).on('change', (filename) => {
      if (!filename.endsWith('.rs')) return;
      // get first path that contains file
      clearTimeout(timer);
      const contractFolder = packages.find((p) => filename.startsWith(p));
      timer = setTimeout(spawn, interval, 'bash', args.concat([contractFolder]), { cwd: process.cwd(), env: process.env, stdio: 'inherit' });
    });
  }
});
