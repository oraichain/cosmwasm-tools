// @ts-nocheck

import * as cosmwasm from '@cosmjs/cosmwasm-stargate';
import { stringToPath } from '@cosmjs/crypto';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { GasPrice } from '@cosmjs/stargate';
import { decryptMnemonic } from '../../../common';
import { Argv } from 'yargs';

export default async (yargs: Argv) => {
  const { argv } = yargs
    .positional('address', {
      describe: 'the smart contract address',
      type: 'string'
    })
    .option('amount', {
      type: 'string'
    })
    .option('memo', {
      type: 'string'
    });
  const [address] = argv._.slice(-1);
  const prefix = process.env.PREFIX || 'orai';
  const denom = process.env.DENOM || 'orai';
  const mnemonic = argv.ENCRYPTED_MNEMONIC ? decryptMnemonic(argv.ENCRYPTED_MNEMONIC) : argv.MNEMONIC;
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    hdPaths: [stringToPath(process.env.HD_PATH)],
    prefix
  });
  const [firstAccount] = await wallet.getAccounts();

  const client = await cosmwasm.SigningCosmWasmClient.connectWithSigner(process.env.RPC_URL, wallet, {
    gasPrice: GasPrice.fromString(`${process.env.GAS_PRICES}${prefix}`),
    prefix
  });
  const input = JSON.parse(argv.input);
  const amount = argv.amount ? [{ amount: argv.amount, denom }] : undefined;
  const result = await client.execute(firstAccount.address, address, input, 'auto', argv.memo, amount);
  console.log('result: ', result);
};
