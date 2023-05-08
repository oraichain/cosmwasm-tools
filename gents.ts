#!/usr/bin/env node

import codegen, { ContractFile } from '@cosmwasm/ts-codegen/packages/ts-codegen';
import * as fs from 'fs';
import { resolve, basename, join } from 'path';
import { File, TypescriptParser } from 'typescript-parser';

const {
  existsSync,
  promises: { readdir, readFile, writeFile, rm }
} = fs;

const genTS = async (contracts: Array<ContractFile>, outPath: string, enabledReactQuery: boolean = false) => {
  await rm(outPath, { recursive: true, force: true });
  await codegen({
    contracts,
    outPath,

    // options are completely optional ;)
    options: {
      bundle: {
        bundleFile: 'index.ts',
        scope: 'contracts'
      },
      types: {
        enabled: true
      },
      client: {
        enabled: true
      },
      reactQuery: {
        enabled: enabledReactQuery,
        optionalClient: true,
        version: 'v4',
        mutations: true
      },
      recoil: {
        enabled: false
      },
      messageComposer: {
        enabled: false
      }
    }
  });
  console.log('✨ all done!');
};

const isPrivateType = (type: string) => {
  return type.endsWith('Response') || type.match(/^(?:Instantiate|Init|Execute|Handle|Query|Migrate)Msg$/);
};

const fixImport = async (clientName: string, ext: string, typeData: { [key: string]: string }, outPath: string) => {
  const clientFile = join(outPath, `${clientName}.${ext}`);
  const clientData = await readFile(clientFile);

  await writeFile(
    clientFile,
    clientData.toString().replace(new RegExp(`import\\s+\\{(.*?)\\}\\s+from\\s+"\\.\\/${clientName}\\.types";`), (_, g1: string) => {
      const [clientImportData, typesImportData] = g1
        .trim()
        .split(/\s*,\s*/)
        .reduce(
          (ret, el) => {
            ret[!typeData[el] ? 0 : 1].push(el);
            return ret;
          },
          [[], []]
        );

      return `import {${typesImportData.join(', ')}} from "./types";\nimport {${clientImportData.join(', ')}} from "./${clientName}.types";`;
    })
  );
};

const fixTs = async (outPath: string, enabledReactQuery = false) => {
  const parser = new TypescriptParser();
  const typeExt = '.types.ts';
  const typeData: { [key: string]: string } = {};
  const parsedData: { [key: string]: File } = {};
  const dirs = (await readdir(outPath)).filter((dir) => dir.endsWith(typeExt));

  await Promise.all(
    dirs.map(async (dir) => {
      const tsFile = join(outPath, dir);
      const tsData = (await readFile(tsFile)).toString();
      const parsed = await parser.parseSource(tsData);
      parsedData[dir] = parsed;

      for (let token of parsed.declarations) {
        if (!isPrivateType(token.name) && !typeData[token.name]) {
          typeData[token.name] = tsData.substring(token.start ?? 0, token.end);
        }
      }
    })
  );

  await Promise.all(
    dirs.map(async (dir) => {
      const tsFile = join(outPath, dir);
      const tsData = (await readFile(tsFile)).toString();
      const parsed = parsedData[dir];
      const modifiedTsData: string[] = [];
      const importData: string[] = [];

      for (let token of parsed.declarations) {
        if (typeData[token.name]) {
          importData.push(token.name);
        } else {
          modifiedTsData.push(tsData.substring(token.start ?? 0, token.end));
        }
      }

      // import from types, and remove from client
      modifiedTsData.unshift(`import {${importData.join(', ')}} from "./types";`);

      await writeFile(tsFile, modifiedTsData.join('\n'));

      // update client file

      const clientName = basename(dir, typeExt);
      await fixImport(clientName, 'client.ts', typeData, outPath);

      if (enabledReactQuery) {
        await fixImport(clientName, 'react-query.ts', typeData, outPath);
      }
    })
  );

  await writeFile(join(outPath, 'types.ts'), Object.values(typeData).join('\n'));

  // add export from types
  const indexData = (await readFile(join(outPath, 'index.ts'))).toString();
  if (indexData.indexOf('export * from "./types";') === -1) {
    await writeFile(join(outPath, 'index.ts'), `${indexData}\nexport * from "./types";`);
  }
};

let enabledReactQuery = false;
let pwd = process.cwd();
// using current dir
let tsFolder = join(pwd, 'build');

(async () => {
  const packages: string[] = [];

  for (let i = 2; i < process.argv.length; ++i) {
    const arg = process.argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        console.log('%s contracts/package1 contracts/package2 contracts/package3 [-o build_folder] [--react-query]', process.argv[1].split('/').pop());
        process.exit();
      case '--react-query':
        enabledReactQuery = true;
        break;
      case '--output':
      case '-o':
        tsFolder = resolve(process.argv[++i]);
        break;
      default:
        // update new packages
        packages.push(arg);
        break;
    }
  }

  const contracts = await Promise.all(
    packages.map(async (packagePath) => {
      const baseName = basename(packagePath);
      const schemaDir = join(packagePath, 'artifacts', 'schema');
      if (!existsSync(schemaDir)) return false;

      return {
        name: baseName.replace(/^.|_./g, (m) => m.slice(-1).toUpperCase()),
        dir: schemaDir
      };
    })
  );
  await genTS(contracts.filter(Boolean) as ContractFile[], tsFolder, enabledReactQuery);
  await fixTs(tsFolder, enabledReactQuery);
})();
