import { spawn } from 'child_process';
import crypto from 'crypto';

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
