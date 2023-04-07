import codegen, { ContractFile } from '@cosmwasm/ts-codegen';
import { TypescriptParser, File } from 'typescript-parser';
import { join, basename, resolve as _resolve } from 'path';
import * as fs from 'fs';

const {
  existsSync,
  promises: { readdir, readFile, writeFile, rm, mkdir }
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

const isPrivateType = (type) => {
  return type.endsWith('Response') || type === 'InstantiateMsg' || type === 'ExecuteMsg' || type === 'QueryMsg' || type === 'MigrateMsg';
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
    clientData.toString().replace(new RegExp(`import\\s+\\{(.*?)\\}\\s+from\\s+"\\.\\/${clientName}\\.types";`), (_, g1) => {
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

const fixTs = async (outPath, enabledReactQuery = false) => {
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

      const clientName = basename(dir, typeExt);
      await fixImport(clientName, 'client.ts', typeData, nestedTypes, outPath);

      if (nestedResponses) {
        await fixNested(clientName, 'client.ts', nestedResponses, outPath);
      }

      if (enabledReactQuery) {
        await fixImport(clientName, 'react-query.ts', typeData, nestedTypes, outPath);
        if (nestedResponses) {
          await fixNestedReactQuery(clientName, 'react-query.ts', nestedResponses, outPath);
        }
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

const fixNestedSchema = async (packagePath: string) => {
  const cargoMatched = (await readFile(join(packagePath, 'Cargo.toml'))).toString().match(/name\s*=\s*"(.*?)"/);
  if (!cargoMatched) return;
  const schemaPath = join(packagePath, 'artifacts', 'schema');
  const schemaFile = join(schemaPath, cargoMatched[1] + '.json');
  // fallback to old version
  if (!existsSync(schemaFile)) {
    return;
  }

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

let enabledReactQuery = false;
let tsFolder = _resolve(__dirname, 'build');

const nestedMap: {
  [key: string]: { [key: string]: [string, string, string[]] };
} = {};

(async () => {
  const packages: string[] = [];

  for (let i = 2; i < process.argv.length; ++i) {
    const arg = process.argv[i];
    switch (arg) {
      case '--react-query':
        enabledReactQuery = true;
        break;
      case '--output':
        tsFolder = process.argv[++i];
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
      // try fix nested schema if has
      const responses = await fixNestedSchema(packagePath);
      if (responses) {
        nestedMap[
          packagePath
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
  await genTS(contracts.filter(Boolean) as ContractFile[], tsFolder, enabledReactQuery);
  await fixTs(tsFolder, enabledReactQuery);
})();
