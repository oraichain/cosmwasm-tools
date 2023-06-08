# Installation

You can install cwtools globally using npm (pass --ignore-scripts due to standalone build)

`npm install -g @oraichain/cwtools --ignore-scripts`

# Usage

Type `cwtools -h`

```bash
cwtools [command]

Commands:
  cwtools gents   generate TypeScript classes for the contract folders
  cwtools build   build a list of contract folders
  cwtools wasm    wasm commands
  cwtools script  run custom script

Options:
  -h, --help        Show help                                          [boolean]
      --version     Show version number                                [boolean]
      --env         Path to JSON config file                   [default: ".env"]
      --file-input  Path to JSON config file

```

Cosmwasm commands with encrypted mnemonic

```bash
# generate encrypted mnemonic
cwtools script scripts/encrypt_mnemonic.js [mnemonic_file]

# then put it into .env file then run
cwtools wasm -h
```
