import codegen, { ContractFile } from '@oraichain/ts-codegen';
import os from 'os';
import * as fs from 'fs';
import { basename, join, resolve } from 'path';
import { ClassLikeDeclaration, Declaration, File, TypescriptParser } from 'typescript-parser';
import { Argv } from 'yargs';
import { buildSchema, filterContractDirs } from '../common';

const {
  existsSync,
  promises: { readdir, readFile, writeFile, rm }
} = fs;

const genTS = async (contracts: Array<ContractFile>, tsFolder: string, enabledReactQuery: boolean = false) => {
  const outPath = resolve(tsFolder);
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
        enabled: true,
        queryPrefixOnConflict: 'get_'
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

  await fixTs(outPath, enabledReactQuery);
  return { outPath };
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
      let importStr = `import {${clientImportData.join(', ')}} from "./${clientName}.types";`;
      if (typesImportData.length) importStr = `import {${typesImportData.join(', ')}} from "./types";\n${importStr}`;
      return importStr;
    })
  );
};

const privateMsgsMap = Object.fromEntries(['MigrateMsg', 'QueryMsg', 'ExecuteMsg', 'HandleMsg', 'InitMsg', 'InstantiateMsg'].map((c) => [c, true]));

// if declaration appears at least twice then move it to global
const getIdentity = (declaration: ClassLikeDeclaration): string => {
  return (
    declaration.name +
    '{' +
    declaration.properties
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => `${p.name}:${p.type}`)
      .join(',') +
    '}'
  );
};

const fixTs = async (outPath: string, enabledReactQuery = false) => {
  const parser = new TypescriptParser();
  const typeExt = '.types.ts';
  const typeData: { [key: string]: string } = {};
  const parsedData: { [key: string]: [File, string, string] } = {};
  const dirs = (await readdir(outPath)).filter((dir) => dir.endsWith(typeExt));
  const processedTokens: Array<[Declaration, string, string]> = [];
  const typeCheck: { [key: string]: number } = {};
  for (const dir of dirs) {
    const tsFile = join(outPath, dir);
    const tsData = fs.readFileSync(tsFile).toString();
    const parsed = await parser.parseSource(tsData);
    parsedData[dir] = [parsed, tsData, tsFile];
    // check public type
    for (let token of parsed.declarations) {
      if (privateMsgsMap[token.name] || token.name.match(/Response(?:ForEmpty)?$/)) continue;
      const tokenStr = tsData.substring(token.start ?? 0, token.end);
      const identity = 'properties' in token ? getIdentity(token as ClassLikeDeclaration) : tokenStr.replace(/[\s\n\t]+/g, ' ');
      processedTokens.push([token, tokenStr, identity]);
      typeCheck[identity] = (typeCheck[identity] ?? 0) + 1;
    }
  }

  for (const [token, tokenStr, identity] of processedTokens) {
    if (typeCheck[identity] > 1) {
      typeData[token.name] = tokenStr;
    } else {
      // incase there is duplicate name but with different identity
      delete typeData[token.name];
    }
  }

  const classNames = await Promise.all(
    dirs.map(async (dir) => {
      const [parsed, tsData, tsFile] = parsedData[dir];
      const modifiedTsData: string[] = [];
      const importData: string[] = [];

      for (let token of parsed.declarations) {
        if (typeData[token.name]) {
          importData.push(token.name);
        } else {
          modifiedTsData.push(tsData.substring(token.start ?? 0, token.end));
        }
      }

      // fix nested schema
      // modifiedTsData.push(`export type ${key} = ${value[2].join(' | ')};`);

      // import from types, and remove from client
      if (importData.length) modifiedTsData.unshift(`import {${importData.join(', ')}} from "./types";`);

      await writeFile(tsFile, modifiedTsData.join('\n'));

      // update client file

      const className = basename(dir, typeExt);
      await fixImport(className, 'client.ts', typeData, outPath);

      if (enabledReactQuery) {
        await fixImport(className, 'react-query.ts', typeData, outPath);
      }
      return className;
    })
  );

  const exportArr = Object.values(typeData);

  const indexData = [];
  for (const className of classNames) {
    indexData.push(`export * as ${className}Types from './${className}.types';`);
    indexData.push(`export * from './${className}.client';`);
  }

  if (exportArr.length) {
    await writeFile(join(outPath, 'types.ts'), exportArr.join('\n'));
    // add export from types
    indexData.push('export * from "./types";');
  }

  // re-export
  await writeFile(join(outPath, 'index.ts'), indexData.join('\n'));
};

export const genTypescripts = async (packages: string[], enabledReactQuery: boolean, output = 'build') => {
  const cargoDir = join(os.homedir(), '.cargo');
  const targetDir = join(cargoDir, 'target');

  // filter contract folder only
  const contractDirRet = filterContractDirs(packages);

  const contracts = await Promise.all(
    contractDirRet.map(async ([contractDir, packageName]) => {
      const baseName = basename(contractDir);
      const schemaDir = join(contractDir, 'artifacts', 'schema');

      // make sure to build schema first time
      if (!existsSync(schemaDir)) {
        await buildSchema(packageName, contractDir, targetDir);
      }

      return {
        name: baseName.replace(/^.|_./g, (m) => m.slice(-1).toUpperCase()),
        dir: schemaDir
      };
    })
  );
  return await genTS(contracts.filter(Boolean) as ContractFile[], output, enabledReactQuery);
};

export default async (yargs: Argv) => {
  const { argv } = yargs
    .usage('usage: $0 gents <paths...> [options]')
    .positional('paths', {
      describe: 'a list of contract folders',
      type: 'string'
    })
    .option('--react-query', {
      type: 'boolean',
      description: 'Build with react-query support',
      default: false
    })
    .option('output', {
      alias: 'o',
      type: 'string',
      description: 'The output folder',
      default: undefined
    });

  const start = Date.now();
  // @ts-ignore
  await genTypescripts(argv._.slice(1), argv.reactQuery, argv.output);
  console.log('✨ all done in', Date.now() - start, 'ms!');
};
