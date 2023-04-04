# Installation

`yarn`

# Build smart contracts

```bash
# options: -r: release, -s: schema
yarn build contracts/package1 contracts/package2 contracts/package3 [-r] [-s]
```

The optimized contracts are generated in the artifacts/ directory.

# Generate typescript code

```bash
yarn gen-ts --force --react-query --input [contracts_folder] --output [build_folder]

# if no --output is given, the default output is current directory, and then you can try with your desired .env from .env.example :
yarn ts-node examples/oracle.ts

```
