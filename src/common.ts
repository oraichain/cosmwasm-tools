import { spawn, execFileSync } from 'child_process';
import readlineSync from 'readline-sync';
import crypto from 'crypto';
import * as fs from 'fs';
import toml from 'toml';
import { join, resolve, basename } from 'path';

const {
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

export const decryptMnemonic = (encryptedMnemonic: string) => {
  const password = readlineSync.question('enter passphrase:', { hideEchoBack: true });
  return decrypt(password, encryptedMnemonic);
};

export const buildSchema = async (packageName: string, contractDir: string, targetDir: string) => {
  const binCmd = fs.existsSync(join(contractDir, 'src', 'bin')) ? '--bin' : '--example';
  const artifactDir = join(contractDir, 'artifacts');
  if (!fs.existsSync(artifactDir)) {
    await mkdir(artifactDir);
  }

  execFileSync('cargo', ['run', '-q', binCmd, 'schema', '--target-dir', targetDir], { cwd: artifactDir, env: process.env, stdio: 'inherit' });

  // check if we can merge into one
  const schemaDir = join(artifactDir, 'schema');
  const singleSchema = resolve(schemaDir, `${packageName}.json`);
  if (!fs.existsSync(singleSchema)) {
    // try to combine all json file into one then remove them
    const singleSchemaJson = {
      contract_name: 'oraiswap-oracle',
      contract_version: '0.1.1',
      idl_version: '1.0.0',
      responses: {}
    };
    for (const fileName of fs.readdirSync(schemaDir)) {
      const filePath = resolve(schemaDir, fileName);
      console.log(`Merging "${filePath}" into "${singleSchema}"`);
      const fileContentJson = JSON.parse(fs.readFileSync(filePath).toString());
      if (fileName.endsWith('_msg.json')) {
        singleSchemaJson[fileName.slice(0, -9)] = fileContentJson;
      } else if (fileName.endsWith('_response.json')) {
        singleSchemaJson.responses[fileName.slice(0, -14)] = fileContentJson;
      }
      fs.unlinkSync(filePath);
    }
    fs.writeFileSync(singleSchema, JSON.stringify(singleSchemaJson, null, 2));
  }
};

export const filterContractDirs = (packages: string[]) => {
  // filter contract folder only
  return packages
    .map((contractDir) => {
      // name is extract from Cargo.toml
      const cargoPath = join(contractDir, 'Cargo.toml');

      if (!fs.existsSync(cargoPath)) return [contractDir];

      const tomlObj = toml.parse(fs.readFileSync(cargoPath).toString());
      return [contractDir, tomlObj.package?.name];
    })
    .filter(([, packageName]) => packageName);
};
