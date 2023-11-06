import { spawn, execFileSync } from 'child_process';
import readlineSync from 'readline-sync';
import crypto from 'crypto';
import * as fs from 'fs';
import toml from 'toml';
import { join, resolve } from 'path';
import { extract } from 'tar';

const { mkdir, copyFile, rmdir, unlink, writeFile } = fs.promises;

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

const { platform } = process;

async function getUrl(binaryenVersion: number) {
  const { arch } = process;
  const baseURL = `https://github.com/WebAssembly/binaryen/releases/download/version_${binaryenVersion}`;

  switch (platform) {
    case 'win32':
      if (arch === 'x64') {
        return `${baseURL}/binaryen-version_${binaryenVersion}-x86_64-windows.tar.gz`;
      }
      break;
    case 'darwin':
      if (arch === 'arm64') {
        return `${baseURL}/binaryen-version_${binaryenVersion}-arm64-macos.tar.gz`;
      }
      if (arch === 'x64') {
        return `${baseURL}/binaryen-version_${binaryenVersion}-x86_64-macos.tar.gz`;
      }
      break;
    case 'linux':
      if (arch === 'x64') {
        return `${baseURL}/binaryen-version_${binaryenVersion}-x86_64-linux.tar.gz`;
      }
      break;
  }

  throw new Error('\x1b[33mThis platform not supported\x1b[0m');
}

export const getWasmOpt = async (binaryenVersion = 112) => {
  try {
    const executableFilename = platform === 'win32' ? 'wasm-opt.exe' : 'wasm-opt';
    const outputWasmOpt = resolve(__dirname, executableFilename);
    if (fs.existsSync(outputWasmOpt)) return outputWasmOpt;
    const binariesOutputPath = resolve(__dirname, 'binaries.tar');

    const binaryUrl = await getUrl(binaryenVersion);
    const binaryResponse = await fetch(binaryUrl);
    const binary = Buffer.from(await binaryResponse.arrayBuffer());

    await writeFile(binariesOutputPath, binary);

    await extract({
      file: binariesOutputPath,
      filter: (_path, stat) => {
        const { path: filePath } = stat.header;

        return [executableFilename, 'libbinaryen.dylib', 'libbinaryen.a', 'binaryen.lib'].some((filename) => filePath.endsWith(filename));
      }
    });

    const libName = {
      win32: 'binaryen.lib',
      linux: 'libbinaryen.a',
      darwin: 'libbinaryen.dylib'
    };

    const libFolder = 'lib';

    const unpackedFolder = resolve(__dirname, '..', `binaryen-version_${binaryenVersion}`);
    const unpackedLibFolder = resolve(unpackedFolder, libFolder);
    const unpackedBinFolder = resolve(unpackedFolder, 'bin');
    const downloadedWasmOpt = resolve(unpackedBinFolder, executableFilename);
    const downloadedLibbinaryen = resolve(unpackedLibFolder, libName[platform]);

    const outputLibbinaryen = resolve(__dirname, `../${libFolder}/${libName[platform]}`);

    const outFolder = resolve(__dirname, `../${libFolder}`);

    if (!fs.existsSync(outFolder)) {
      await mkdir(outFolder);
    }

    await copyFile(downloadedWasmOpt, outputWasmOpt);
    await copyFile(downloadedLibbinaryen, outputLibbinaryen);

    await unlink(binariesOutputPath);
    await unlink(downloadedWasmOpt);
    await unlink(downloadedLibbinaryen);
    await rmdir(unpackedBinFolder);
    await rmdir(unpackedLibFolder);
    await rmdir(unpackedFolder);
    return outputWasmOpt;
  } catch (e) {
    throw new Error(`\x1b[31m${e}\x1b[0m`);
  }
};
