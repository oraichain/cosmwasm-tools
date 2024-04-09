# Installation

You can install cwtools globally using npm `npm install -g @oraichain/cwtools` or yarn `yarn global add @oraichain/cwtools`

# Usage

Type `cwtools -h`

```bash
cwtools [command]

Commands:
  cwtools genjs   generate JavaScript classes for the contract folders
  cwtools gents   generate TypeScript classes for the contract folders
  cwtools build   build a list of contract folders
  cwtools wasm    wasm commands
  cwtools script  run custom typescript file

Options:
  -h, --help        Show help                                          [boolean]
      --version     Show version number                                [boolean]
      --env         Path to JSON config file                   [default: ".env"]
      --file-input  Path to JSON config file

```

Cosmwasm commands with encrypted mnemonic

Custom script: `scripts/show_account.ts`

```ts
export default async (argv, common, exports) => {
  const { stringToPath } = exports['@cosmjs/crypto'];
  const { GasPrice } = exports['@cosmjs/stargate'];
  const { SigningCosmWasmClient } = exports['@cosmjs/cosmwasm-stargate'];
  const { DirectSecp256k1HdWallet } = exports['@cosmjs/proto-signing'];

  const prefix = process.env.PREFIX || 'orai';
  const mnemonic = argv.ENCRYPTED_MNEMONIC ? common.decryptMnemonic(argv.ENCRYPTED_MNEMONIC) : argv.MNEMONIC;
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    hdPaths: [stringToPath(process.env.HD_PATH)],
    prefix
  });
  const [firstAccount] = await wallet.getAccounts();

  const client = await SigningCosmWasmClient.connectWithSigner(process.env.RPC_URL, wallet, {
    gasPrice: GasPrice.fromString(`${process.env.GAS_PRICES}${prefix}`)
  });

  console.log(firstAccount);
};
```

```bash
# generate encrypted mnemonic
cwtools script scripts/show_account.ts

# then put it into .env file then run
cwtools wasm -h
```
