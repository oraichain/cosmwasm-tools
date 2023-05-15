// @ts-nocheck

import * as cosmwasm from '@cosmjs/cosmwasm-stargate';
import { Argv } from 'yargs';

export default async (yargs: Argv) => {
  const { argv } = yargs
    .positional('address', {
      describe: 'the smart contract address',
      type: 'string'
    })
    .option('amount', {
      type: 'string'
    });
  const [address] = argv._.slice(-1);
  const client = await cosmwasm.CosmWasmClient.connect(process.env.RPC_URL);
  const input = argv.input.startsWith('{') ? JSON.parse(argv.input) : cosmwasm.fromBinary(argv.input);
  const queryResult = await client.queryContractSmart(address, input);
  console.log('query result: ');
  console.dir(queryResult, { depth: null });
};
