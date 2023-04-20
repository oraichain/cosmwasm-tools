# Installation

`yarn`

# Build smart contracts

```bash
# options: -d|--debug: build debug, -s|--schema: schema, -w|--watch: watch mode, -o|--output: build folder
yarn build contracts/package1 contracts/package2 contracts/package3 [-o build_folder] [-d] [-s] [-w]
```

The optimized contracts are generated in the artifacts/ directory.

# Generate typescript code

```bash
# options: -o|output: build folder, if no build folder is given, the default output is current directory
yarn gents contracts/package1 contracts/package2 contracts/package3 [-o build_folder] [--react-query]

```
