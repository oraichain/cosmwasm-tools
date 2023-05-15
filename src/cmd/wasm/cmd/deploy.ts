// @ts-nocheck

import * as cosmwasm from '@cosmjs/cosmwasm-stargate';
import { stringToPath } from '@cosmjs/crypto';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { GasPrice } from '@cosmjs/stargate';
import fs from 'fs';
import { Argv } from 'yargs';

export default async (yargs: Argv) => {
  const { argv } = yargs
    .positional('file', {
      describe: 'the smart contract file',
      type: 'string'
    })
    .option('label', {
      describe: 'the label of smart contract',
      type: 'string'
    })
    .option('fees', {
      describe: 'the transaction fees',
      type: 'string'
    })
    .option('codeid', {
      description: 'smart contract code-id',
      type: 'number'
    })
    .option('amount', {
      type: 'string'
    });
  const [file] = argv._.slice(-1);
  const prefix = process.env.PREFIX || 'orai';
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(argv.mnemonic, {
    hdPaths: [stringToPath(process.env.HD_PATH)],
    prefix
  });
  const [firstAccount] = await wallet.getAccounts();

  const client = await cosmwasm.SigningCosmWasmClient.connectWithSigner(process.env.RPC_URL, wallet, {
    gasPrice: GasPrice.fromString(`${process.env.GAS_PRICES}${prefix}`),
    prefix
  });
  const wasmBody = fs.readFileSync(file);

  let codeId: number;
  if (argv.codeid) codeId = argv.codeid;
  else {
    // update smart contract to collect code id
    const uploadResult = await client.upload(firstAccount.address, wasmBody, 'auto');
    console.log('upload result: ', uploadResult);

    codeId = uploadResult.codeId;
  }
  const input = JSON.parse(argv.input);

  const instantiateResult = await client.instantiate(firstAccount.address, parseInt(codeId), input, argv.label, 'auto', { admin: argv.admin });
  console.log('instantiate result: ', instantiateResult);
};

// yarn oraicli wasm deploy ../oraiwasm/package/plus/cw4-group/artifacts/cw4-group.wasm --input '{"admin":"orai14n3tx8s5ftzhlxvq0w5962v60vd82h30rha573","members":[{"addr":"orai14n3tx8s5ftzhlxvq0w5962v60vd82h30rha573","weight":1}]}' --label 'cw4-group-0132-cosmwasm' --codeid 5613 --admin orai14n3tx8s5ftzhlxvq0w5962v60vd82h30rha573
