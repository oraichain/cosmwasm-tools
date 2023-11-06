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

```bash
# generate encrypted mnemonic
cwtools script scripts/encrypt_mnemonic.ts [mnemonic_file]

# then put it into .env file then run
cwtools wasm -h
```
