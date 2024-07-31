// @ts-nocheck

import * as cosmwasm from "@cosmjs/cosmwasm-stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { GasPrice } from "@cosmjs/stargate";
import { Argv } from "yargs";
import { decryptMnemonic } from "../../../common";

export default async (yargs: Argv) => {
  const { argv } = yargs

    .option("code-id", {
      describe: "the code id of the smart contract",
      type: "number",
    })
    .option("label", {
      describe: "the label of smart contract",
      type: "string",
    })
    .option("fees", {
      describe: "the transaction fees",
      type: "string",
    })
    .option("amount", {
      type: "string",
    })
    .option("admin", {
      type: "string",
    });

  const mnemonic = argv.ENCRYPTED_MNEMONIC
    ? decryptMnemonic(argv.ENCRYPTED_MNEMONIC)
    : argv.MNEMONIC;

  const prefix = process.env.PREFIX || "orai";
  const denom = process.env.DENOM || "orai";
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix,
  });
  const [firstAccount] = await wallet.getAccounts();

  const client = await cosmwasm.SigningCosmWasmClient.connectWithSigner(
    process.env.RPC_URL,
    wallet,
    {
      gasPrice: GasPrice.fromString(`${process.env.GAS_PRICES}${denom}`),
      prefix,
    }
  );

  const { codeId, label, admin = firstAccount.address } = argv;

  try {
    // next instantiate code
    const input = JSON.parse(argv.input);

    const res = await client.instantiate(
      firstAccount.address,
      codeId,
      input,
      label,
      "auto",
      { admin: admin }
    );

    console.log(res.contractAddress);
    return res.contractAddress;
  } catch (error) {
    console.log("error: ", error);
  }
};
