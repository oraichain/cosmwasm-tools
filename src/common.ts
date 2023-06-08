import { spawn, execFileSync } from 'child_process';
import readlineSync from 'readline-sync';
import crypto from 'crypto';
import * as fs from 'fs';
import { join } from 'path';

const {
  existsSync,
  promises: { mkdir }
} = fs;

export const encrypt = (password: string, val: string) => {
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  const ENC_KEY = hash.substr(0, 32);
  const IV = hash.substr(32, 16);
  let cipher = crypto.createCipheriv('aes-256-cbc', ENC_KEY, IV);
  let encrypted = cipher.update(val, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
};

export const decrypt = (password: string, encrypted: string) => {
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  const ENC_KEY = hash.substr(0, 32);
  const IV = hash.substr(32, 16);
  let decipher = crypto.createDecipheriv('aes-256-cbc', ENC_KEY, IV);
  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  return decrypted + decipher.final('utf8');
};

export const spawnPromise = (cmd: string, args: readonly string[], currentDir?: string, env?: NodeJS.ProcessEnv) => {
  const proc = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: 'inherit', cwd: currentDir });
  return new Promise((resolve, reject) => {
    proc.on('close', resolve);
    proc.on('error', reject);
  });
};

export const decryptMnemonic = (mnemonic: string) => {
  const password = readlineSync.question('enter passphrase:', { hideEchoBack: true });
  return decrypt(password, mnemonic);
};

export const buildSchemas = async (packages: string[], targetDir: string) => {
  const res = await Promise.all(
    packages.map(async (contractDir) => {
      const binCmd = existsSync(join(contractDir, 'src', 'bin')) ? '--bin' : '--example';
      const artifactDir = join(contractDir, 'artifacts');
      if (!existsSync(artifactDir)) {
        await mkdir(artifactDir);
      }
      return [binCmd, artifactDir];
    })
  );

  // schema can not run in parallel
  for (const [binCmd, artifactDir] of res) {
    execFileSync('cargo', ['run', '-q', binCmd, 'schema', '--target-dir', targetDir], { cwd: artifactDir, env: process.env, stdio: 'inherit' });
  }
};
