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

# Build to command

```bash
npm i -g @vercel/ncc
ncc build gents.ts --no-source-map-register -t -m
cp dist/index.js $(npm -g bin)/cw-gents

cp build_contract.sh $(npm -g bin)
ncc build build.ts --no-source-map-register -t -m
cp dist/index.js $(npm -g bin)/cw-build
# then you can type `cw-gents` instead of `yarn gents` and `cw-build` instead of `yarn build`
```
