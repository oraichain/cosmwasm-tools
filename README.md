# Installation

`yarn`

# Build smart contracts

```bash
# options: -d: build debug, -s: schema, -w: watch mode
yarn build contracts/package1 contracts/package2 contracts/package3 [-d] [-s] [-w]
```

The optimized contracts are generated in the artifacts/ directory.

# Generate typescript code

```bash
yarn gen-ts --react-query --input contract_folders --input contract_folder1 --input contract_folder2 --output [build_folder]

# if no --output is given, the default output is current directory, and then you can try with your desired .env from .env.example :
yarn ts-node examples/oracle.ts

```
