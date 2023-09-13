import codegen, { ContractFile } from '@oraichain/ts-codegen';
import os from 'os';
import * as fs from 'fs';
import { basename, join, resolve } from 'path';
import { ClassLikeDeclaration, Declaration, File, TypescriptParser } from 'typescript-parser';
import { Argv } from 'yargs';
import { buildSchemas, filterContractDirs } from '../common';

const {
  existsSync,
  promises: { readdir, readFile, writeFile, rm }
} = fs;

const nestedMap: {
  [key: string]: { [key: string]: [string, string, string[]] };
} = {};

const fixNestedSchema = async (packagePath: string) => {
  const schemaPath = join(packagePath, 'artifacts', 'schema');
  const schemaName = (await readdir(schemaPath)).find((file) => !file.match(/\/raw\//));

  // fallback to old version
  if (!schemaName) {
    return;
  }

  const schemaFile = join(schemaPath, schemaName);

  const schemaJSON = JSON.parse((await readFile(schemaFile)).toString());
  if (!schemaJSON.query.anyOf) return;
  const responses = {};
  let update = false;
  schemaJSON.query.anyOf = schemaJSON.query.anyOf.map((item: any) => {
    if (item.$ref) {
      update = true;
    }
    const ref = item.$ref || item.properties[item.required[0]].$ref;
    if (!ref) return item;
    const matched = ref.match(/([A-Z][a-z]+)Query$/)[1];
    const name = matched.toLowerCase();
    const input = ref.split('/').pop();
    const subResponses = schemaJSON.query.definitions[input].oneOf.map((item: any) => schemaJSON.responses[item.required[0]].title);

    responses[`${matched}Response`] = [name, input, subResponses];

    return item.$ref
      ? {
          type: 'object',
          required: [name],
          properties: {
            [name]: item
          },
          additionalProperties: false
        }
      : item;
  });

  if (update) {
    await writeFile(schemaFile, JSON.stringify(schemaJSON, null, 2));
  }
  return responses;
};

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

const fixNested = async (clientName: string, ext: string, nestedResponses: { [key: string]: [string, string, string[]] }, outPath: string) => {
  const clientFile = join(outPath, `${clientName}.${ext}`);
  let clientData = (await readFile(clientFile)).toString();
  Object.entries(nestedResponses).forEach(([key, [name, inputType]]) => {
    clientData = clientData
      .replace(`${name}: () => Promise<${key}>;`, `${name}: (input: ${inputType}) => Promise<${key}>;`)
      .replace(`${name} = async (): Promise<${key}> => {`, `${name} = async (input:${inputType}): Promise<${key}> => {`)
      .replace(`${name}: {}`, `${name}: input`);
  });
  await writeFile(clientFile, clientData);
};

const fixNestedReactQuery = async (clientName: string, ext: string, nestedResponses: { [key: string]: [string, string, string[]] }, outPath: string) => {
  const clientFile = join(outPath, `${clientName}.${ext}`);
  let clientData = (await readFile(clientFile)).toString();
  Object.entries(nestedResponses).forEach(([key, [name, inputType]]) => {
    clientData = clientData
      .replace(`${inputType}<TData> extends ${clientName}ReactQuery<${key}, TData> {}`, `${inputType}<TData> extends ${clientName}ReactQuery<${key}, TData> {input: ${inputType}}`)
      // use regular for dynamic replacement
      .replace(new RegExp(`\\n\\}:\\s*([\\w_\\d]+${inputType})<TData>`), `,\n\tinput\n}: $1<TData>`)
      .replace(`client.${name}()`, `client.${name}(input)`);
  });
  await writeFile(clientFile, clientData);
};

const fixImport = async (clientName: string, ext: string, typeData: { [key: string]: string }, nestedTypes: string[], outPath: string) => {
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

      return `import {${typesImportData.join(', ')}} from "./types";\nimport {${[...clientImportData, ...nestedTypes].join(', ')}} from "./${clientName}.types";`;
    })
  );
};

const privateMsgsMap = Object.fromEntries(['MigrateMsg', 'QueryMsg', 'ExecuteMsg', 'HandleMsg', 'InitMsg', 'InstantiateMsg'].map((c) => [c, true]));

// if declaration appears at least twice then move it to global
const getIdentity = (declaration: ClassLikeDeclaration): string => {
  if (declaration.properties.length === 0) return '{}';
  return declaration.properties
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => `${p.name}:${p.type}`)
    .join(',');
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
      if (privateMsgsMap[token.name]) continue;
      const tokenStr = tsData.substring(token.start ?? 0, token.end);
      const identity = 'properties' in token ? getIdentity(token as ClassLikeDeclaration) : tokenStr.replace(/[\s\n\t]+/g, ' ');
      processedTokens.push([token, tokenStr, identity]);
      typeCheck[identity] = (typeCheck[identity] ?? 0) + 1;
    }
  }

  for (const [token, tokenStr, identity] of processedTokens) {
    // already added
    if (typeData[token.name]) continue;
    if (typeCheck[identity] > 1) {
      typeData[token.name] = tokenStr;
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
      const contractName = basename(dir, typeExt);
      const nestedResponses = nestedMap[contractName];
      const nestedTypes: string[] = [];
      if (nestedResponses) {
        Object.entries(nestedResponses).forEach(([key, value]) => {
          nestedTypes.push(key);
          modifiedTsData.push(`export type ${key} = ${value[2].join(' | ')};`);
        });
      }

      // import from types, and remove from client
      modifiedTsData.unshift(`import {${importData.join(', ')}} from "./types";`);

      await writeFile(tsFile, modifiedTsData.join('\n'));

      // update client file

      const className = basename(dir, typeExt);
      await fixImport(className, 'client.ts', typeData, nestedTypes, outPath);

      if (nestedResponses) {
        await fixNested(className, 'client.ts', nestedResponses, outPath);
      }

      if (enabledReactQuery) {
        await fixImport(className, 'react-query.ts', typeData, nestedTypes, outPath);

        if (nestedResponses) {
          await fixNestedReactQuery(className, 'react-query.ts', nestedResponses, outPath);
        }
      }
      return className;
    })
  );

  const exportArr = Object.values(typeData);
  // add export for @cosmjs/cosmwasm-stargate
  exportArr.push('export { CosmWasmClient, SigningCosmWasmClient, ExecuteResult } from "@cosmjs/cosmwasm-stargate";');

  await writeFile(join(outPath, 'types.ts'), exportArr.join('\n'));

  const indexData = [];
  for (const className of classNames) {
    indexData.push(`export * as ${className}Types from './${className}.types';`);
    indexData.push(`export * from './${className}.client';`);
  }

  // add export from types
  indexData.push('export * from "./types";');
  // re-export
  await writeFile(join(outPath, 'index.ts'), indexData.join('\n'));
};

export const genTypescripts = async (packages: string[], enabledReactQuery: boolean, output = 'build') => {
  const cargoDir = join(os.homedir(), '.cargo');
  const targetDir = join(cargoDir, 'target');

  // filter contract folder only
  const contractDirs = filterContractDirs(packages);

  const contracts = await Promise.all(
    contractDirs.map(async (contractDir) => {
      const baseName = basename(contractDir);
      const schemaDir = join(contractDir, 'artifacts', 'schema');

      // make sure to build schema first time
      if (!existsSync(schemaDir)) {
        await buildSchemas([contractDir], targetDir);
      }

      // try fix nested schema if has
      const responses = await fixNestedSchema(contractDir);
      if (responses) {
        nestedMap[
          contractDir
            .split('/')
            .pop()!
            .replace(/(^\w|_\w)/g, (m, g1) => g1.slice(-1).toUpperCase())
        ] = responses;
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
