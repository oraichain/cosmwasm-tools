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
  const hashedPassword = crypto.createHash('sha256').update(password).digest();
  const IV = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', hashedPassword, IV);
  return Buffer.concat([IV, cipher.update(val), cipher.final()]).toString('base64');
};

export const decrypt = (password: string, val: string) => {
  const hashedPassword = crypto.createHash('sha256').update(password).digest();
  const encryptedText = Buffer.from(val, 'base64');
  const IV = encryptedText.subarray(0, 16);
  const encrypted = encryptedText.subarray(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', hashedPassword, IV);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString();
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
