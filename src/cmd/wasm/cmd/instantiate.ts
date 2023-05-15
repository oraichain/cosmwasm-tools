// @ts-nocheck

import * as cosmwasm from '@cosmjs/cosmwasm-stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { GasPrice } from '@cosmjs/stargate';
import { Argv } from 'yargs';

export const instantiate = async (yargs: Argv) => {
  const { codeId, label } = yargs.option('admin', {
    describe: 'the admin to migrate smart contract',
    default: '',
    type: 'string'
  }).argv;

  const prefix = process.env.PREFIX || 'orai';
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(argv.mnemonic, {
    prefix
  });
  const [firstAccount] = await wallet.getAccounts();
  const client = await cosmwasm.SigningCosmWasmClient.connectWithSigner(process.env.RPC_URL, wallet, {
    gasPrice: GasPrice.fromString(`${process.env.GAS_PRICES}${prefix}`),
    prefix
  });

  try {
    // next instantiate code
    const input = JSON.parse(argv.input);

    const res = await client.instantiate(firstAccount.address, codeId, input, label, 'auto', { admin: argv.admin });

    console.log(res.contractAddress);
    return res.contractAddress;
  } catch (error) {
    console.log('error: ', error);
  }
};

export default async (yargs: Argv) => {
  const { argv } = yargs

    .option('code-id', {
      describe: 'the code id of the smart contract',
      type: 'number'
    })
    .option('label', {
      describe: 'the label of smart contract',
      type: 'string'
    })
    .option('fees', {
      describe: 'the transaction fees',
      type: 'string'
    })
    .option('amount', {
      type: 'string'
    })
    .option('admin', {
      type: 'string'
    });

  await instantiate(argv);
};
