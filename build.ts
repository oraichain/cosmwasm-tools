import { spawn } from 'child_process';
import crypto from 'crypto';
import fs, { watch } from 'fs';

const getFileHash = (file: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const fd = fs.createReadStream(file);
    const hash = crypto.createHash('md5');
    hash.setEncoding('hex');

    fd.on('end', () => {
      hash.end();
      resolve(hash.read()); // the desired sha1sum
    });

    fd.on('error', reject);

    // read all file and pipe it (write it) to the hash object
    fd.pipe(hash);
  });

// export default class Watcher extends EventEmitter {
//   private readonly pollInterval: number;
//   private readonly hfiles: Map<string, string>;
//   private readonly mfiles: Map<string, number>;
//   constructor({ checkContent = true, pollInterval = 100, ...options } = {}) {
//     super(options);
//     this.pollInterval = pollInterval;
//     if (checkContent) this.hfiles = new Map();
//     this.mfiles = new Map();

//     this.run();
//   }

//   async watch(file: string, callback: (arg: number) => void) {
//     if (!this.mfiles.has(file)) {
//       this.mfiles.set(file, fs.statSync(file).mtime.getMilliseconds());
//       if (this.hfiles) {
//         const hash = await getFileHash(file);
//         this.hfiles.set(file, hash);
//       }
//     }
//     this.addListener(file, callback);
//   }

//   unwatch(file: string, callback: (arg: number) => void) {
//     this.removeListener(file, callback);

//     if (!this.listenerCount(file)) {
//       this.mfiles.delete(file);
//       if (this.hfiles) this.hfiles.delete(file);
//     }
//   }

//   unwatchAll(file: string) {
//     this.removeAllListeners(file);
//     this.mfiles.delete(file);
//     if (this.hfiles) this.hfiles.delete(file);
//   }

//   run = async () => {
//     await Promise.all(
//       this.eventNames().map(async (file) => {
//         const filePath = file as string;
//         const mtime = fs.statSync(filePath).mtime.getMilliseconds();
//         if (mtime !== this.mfiles.get(filePath)) {
//           this.mfiles.set(filePath, mtime);
//           if (this.hfiles) {
//             const hash = await getFileHash(filePath);
//             if (this.hfiles.get(filePath) !== hash) {
//               this.hfiles.set(filePath, hash);
//               this.emit(file, mtime, hash);
//             }
//           } else {
//             this.emit(file, mtime);
//           }
//         }
//       })
//     );

//     setTimeout(this.run, this.pollInterval);
//   };
// }

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

  spawn('bash', args, { cwd: process.cwd(), env: process.env, stdio: 'inherit' });

  if (watchContract) {
    console.log(`watching these contract folders:\n ${packages.join('\n')}`);

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
})();
