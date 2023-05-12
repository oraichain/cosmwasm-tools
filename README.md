# Installation

```bash
yarn
```

# Build smart contracts

```bash
# options: -d|--debug: build debug, -s|--schema: schema, -w|--watch: watch mode, -o|--output: build folder
yarn start build contracts/package1 contracts/package2 contracts/package3 [-o build_folder] [-d] [-s] [-w]
```

The optimized contracts are generated in the artifacts/ directory.

# Generate typescript code

```bash
# options: -o|output: build folder, if no build folder is given, the default output is current directory
yarn start gents contracts/package1 contracts/package2 contracts/package3 [-o build_folder] [--react-query]

```

# Build to command

```bash
yarn build && cp dist/index.js /usr/local/bin/cwtools
# then you can type `cwtools gents` instead of `yarn start gents` and `cwtools build` instead of `yarn start build`
```
