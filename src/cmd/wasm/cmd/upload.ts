import { Argv } from "yargs";
import fs from "fs";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { decryptMnemonic } from "../../../common";
import { GasPrice } from "@cosmjs/stargate";
import * as cosmwasm from "@cosmjs/cosmwasm-stargate";

export const upload = async (argv) => {
  const [file] = argv._.slice(-1);
  const prefix = process.env.PREFIX || "orai";
  const denom = process.env.DENOM || "orai";

  const wasmBody = fs.readFileSync(file);
  const mnemonic = argv.ENCRYPTED_MNEMONIC
    ? decryptMnemonic(argv.ENCRYPTED_MNEMONIC)
    : argv.MNEMONIC;
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix,
  });
  const [firstAccount] = await wallet.getAccounts();
  const client = await cosmwasm.SigningCosmWasmClient.connectWithSigner(
    process.env.RPC_URL,
    wallet,
    {
      gasPrice: GasPrice.fromString(`${process.env.GAS_PRICES}${denom}`),
    }
  );

  try {
    // console.log('argv fees: ', argv);
    let res = await client.upload(
      firstAccount.address,
      Uint8Array.from(wasmBody),
      "auto",
      argv.memo
    );
    console.log(res.codeId);
    return res.codeId;
  } catch (error) {
    console.log("error: ", error);
  }
};

export default async (yargs: Argv) => {
  const { argv } = yargs
    .positional("file", {
      describe: "the smart contract file",
      type: "string",
    })
    .option("fees", {
      describe: "the transaction fees",
      type: "string",
    })
    .option("memo", {
      describe: "optional memo",
      type: "string",
    });

  await upload(argv);
};

// tsx src/index.ts wasm upload ../oraiswap/contracts/oraiswap_rewarder/artifacts/oraiswap-rewarder.wasm --env ../cosmwasm-tools/.env