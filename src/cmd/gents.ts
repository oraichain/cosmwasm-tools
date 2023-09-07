import codegen, { ContractFile } from '@cosmwasm/ts-codegen/packages/ts-codegen';
import os from 'os';
import * as fs from 'fs';
import { basename, join, resolve } from 'path';
import { File, PropertyDeclaration, TypescriptParser } from 'typescript-parser';
import { Argv } from 'yargs';
import { buildSchemas, filterContractDirs } from '../common';

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

  await fixTs(outPath, enabledReactQuery);
  return { outPath };
};

// extract from cosmos_std
const publicTypes = Object.fromEntries(
  [
    'Binary',
    'Addr',
    'Coin',
    'Coins',
    'Timestamp',
    'VoteOption',
    'Null',
    'Boolean',
    'CosmosMsgForEmpty',
    'BankMsg',
    'StakingMsg',
    'DistributionMsg',
    'WasmMsg',
    'GovMsg',
    'HexBinary',
    'Ibc3ChannelOpenResponse',
    'IbcAcknowledgement',
    'IbcBasicResponse',
    'IbcChannel',
    'IbcChannelCloseMsg',
    'IbcChannelConnectMsg',
    'IbcChannelOpenMsg',
    'IbcChannelOpenResponse',
    'IbcEndpoint',
    'IbcMsg',
    'IbcOrder',
    'IbcPacket',
    'IbcPacketAckMsg',
    'IbcPacketReceiveMsg',
    'IbcPacketTimeoutMsg',
    'IbcReceiveResponse',
    'IbcTimeout',
    'IbcTimeoutBlock',
    'Decimal',
    'Decimal256',
    'Decimal256RangeExceeded',
    'DecimalRangeExceeded',
    'Fraction',
    'Int128',
    'Int256',
    'Int512',
    'Int64',
    'Isqrt',
    'Uint128',
    'Uint256',
    'Uint512',
    'Uint64',
    'BlockInfo',
    'ContractInfo',
    'MessageInfo',
    'TransactionInfo'
  ].map((k) => [k, true])
);
const isPrivateType = (type: string) => {
  return !publicTypes[type];
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
          // check props has private prop
          // @ts-ignore
          if (token.properties?.some((prop: PropertyDeclaration) => isPrivateType(prop.type))) continue;
          typeData[token.name] = tsData.substring(token.start ?? 0, token.end);
        }
      }
    })
  );

  const classNames = await Promise.all(
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

      const className = basename(dir, typeExt);
      await fixImport(className, 'client.ts', typeData, outPath);

      if (enabledReactQuery) {
        await fixImport(className, 'react-query.ts', typeData, outPath);
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
