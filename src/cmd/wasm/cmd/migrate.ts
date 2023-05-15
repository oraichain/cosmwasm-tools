// @ts-nocheck
import * as cosmwasm from '@cosmjs/cosmwasm-stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { GasPrice } from '@cosmjs/stargate';
import { decryptMnemonic } from '../../../common';
import { Argv } from 'yargs';

export const migrate = async (argv: Argv) => {
  const [address] = argv._.slice(-1);
  const { codeId } = argv;
  const prefix = process.env.PREFIX || 'orai';
  const mnemonic = argv.ENCRYPTED_MNEMONIC ? decryptMnemonic(argv.ENCRYPTED_MNEMONIC) : argv.MNEMONIC;
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
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

    const res = await client.migrate(firstAccount.address, address, codeId, input, 'auto');

    console.log(res);
  } catch (error) {
    console.log('error: ', error);
  }
};

export default async (yargs: Argv) => {
  const { argv } = yargs
    .positional('address', {
      describe: 'the smart contract address',
      type: 'string'
    })
    .option('code-id', {
      describe: 'the code id of the smart contract',
      type: 'number'
    });
  await migrate(argv);
};

// yarn oraicli wasm migrate orai195269awwnt5m6c843q6w7hp8rt0k7syfu9de4h0wz384slshuzps8y7ccm --input '{}' --codeId 815 --env .env.production
