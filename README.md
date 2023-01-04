# Installation

`yarn`

# Build smart contracts

```bash
yarn build contracts/[package]
```

The optimized contracts are generated in the artifacts/ directory.

# Generate typescript code

```bash
yarn gen-ts --force --react-query --input [contracts_folder] --output [build_folder]

# if no --output is given, the default output is current directory, and then you can try with your desired .env from .env.example :
yarn ts-node examples/oracle.ts

```
