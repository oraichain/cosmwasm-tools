//@ts-nocheck
import { Argv } from "yargs";
import shell from "shelljs";
import { serializeError } from "serialize-error";
import { Coin, DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { stringToPath } from "@cosmjs/crypto";
import path from "path";
import { ChainInfo, MONIKER } from "./statesync";
import fs from "fs";
import json from "big-json";

const defaultExportGenesisPath = "config/export-genesis.json";
const completedForkGenesisPath = "config/genesis.json";
const genesisAmount = "1000000000000000";
const walletName = "wallet";
const bondedTokenPoolModuleName = "bonded_tokens_pool";
const notBondedTokenPoolModuleName = "not_bonded_tokens_pool";
const defaultSyncExportedGenesisCacheName = "sync-genesis-state-cache.json";

export interface GenesisCache {
  [stakingTokenDenom: string]: {
    bank: {
      totalBalances: string;
    };
    [bondedTokenPoolModuleName]: string;
    [notBondedTokenPoolModuleName]: string;
    totalSupplyIndex: number;
  };
}

const exportGenesisState = (
  daemon: string,
  home: string,
  exportGenesisPath: string
) => {
  // > /dev/null to omit logs in terminal
  const fullGenesisPath = path.join(home, exportGenesisPath);
  shell.exec(
    `${daemon} --home ${home} export 2>&1 | tee ${fullGenesisPath} > /dev/null`
  );
  return fullGenesisPath;
};

const readLargeJsonFile = async (genesisPath: string): Promise<any> => {
  const readStream = fs.createReadStream(genesisPath);
  const parseStream = json.createParseStream();

  return new Promise((resolve) => {
    parseStream.on("data", function (data) {
      resolve(data);
    });

    readStream.pipe(parseStream);
  });
};

export class GenesisReader {
  static instance: GenesisReader;
  // inject chain info to simplify the reader process
  private chainInfo: ChainInfo;
  constructor(
    public readonly genesisStateData: any,
    public readonly stakingTokenDenom: string,
    public readonly cache: boolean
  ) {}

  static async create(
    genesisStatePath: string,
    stakingTokenDenom: string,
    genesisStateCachePath?: string
  ): Promise<GenesisReader> {
    let genesis: any;
    let cache: boolean = false;
    // read from cache instead for faster access
    if (genesisStateCachePath && shell.find(genesisStateCachePath).length > 0) {
      genesis = await readLargeJsonFile(genesisStateCachePath);
      console.log("genesis caching: ", genesis);
      cache = true;
    } else genesis = await readLargeJsonFile(genesisStatePath);
    const instance = new GenesisReader(genesis, stakingTokenDenom, cache);
    this.instance = instance;
    return instance;
  }

  withChainInfo(chainInfo: ChainInfo): GenesisReader {
    this.chainInfo = chainInfo;
    return this;
  }

  private async readBalanceOfAddress(address: string): Promise<string> {
    const bondedTokenAccountBalance: { address: string; coins: Coin[] } =
      this.genesisStateData.app_state.bank.balances.find(
        (balance: any) => balance.address === address
      );
    if (!bondedTokenAccountBalance) {
      throw serializeError(
        "Cannot find bonded token module account balance in the genesis file"
      );
    }
    // we have to get amount from exported genesis state of sync node because the balance on lcd will keep changing
    return bondedTokenAccountBalance.coins.find(
      (coin) => coin.denom === this.stakingTokenDenom
    ).amount;
  }

  private async readTotalBalancesWithCache() {
    if (this.cache) {
      return this.genesisStateData[this.stakingTokenDenom].bank
        .totalBalances as string;
    }
    return this.readTotalBalances();
  }

  private async readTotalBalances() {
    let totalBalances = 0;
    for (let balance of this.genesisStateData.app_state.bank.balances) {
      const coin = (balance.coins as Coin[]).find(
        (coin) => coin.denom === this.stakingTokenDenom
      );
      if (!coin) continue;
      totalBalances += parseInt(coin.amount);
    }
    return totalBalances.toString();
  }

  private async readBondedTokenPoolAmountWithCache(
    bondedTokenPoolModuleAccount: string
  ) {
    if (this.cache) {
      return this.genesisStateData[this.stakingTokenDenom][
        bondedTokenPoolModuleName
      ] as string;
    }
    return this.readBondedTokenPoolAmount(bondedTokenPoolModuleAccount);
  }

  private async readBondedTokenPoolAmount(
    bondedTokenPoolModuleAccount: string
  ) {
    return this.readBalanceOfAddress(bondedTokenPoolModuleAccount);
  }

  private async readUnbondingDelegationsWithCache(
    unbondingDelegationsAddress: string
  ) {
    if (this.cache) {
      return this.genesisStateData[this.stakingTokenDenom][
        notBondedTokenPoolModuleName
      ] as string;
    }
    return this.readBalanceOfAddress(unbondingDelegationsAddress);
  }

  private async readTotalSupplyIndexWithCache() {
    if (this.cache)
      return this.genesisStateData[this.stakingTokenDenom][
        "totalSupplyIndex"
      ] as number;
    return (this.genesisStateData.app_state.bank.supply as Coin[]).findIndex(
      (balance) => balance.denom === this.stakingTokenDenom
    );
  }

  async readGenesisData() {
    if (!this.chainInfo)
      throw serializeError(
        "Empty chain info. To call this function, you need to inject chainInfo object first by calling withChainInfo"
      );
    const goodLcd = await this.chainInfo.getGoodLcd();
    const bondedTokenPoolModuleAccount = await goodLcd.queryModuleAccount(
      bondedTokenPoolModuleName
    );
    const notBondedTokenPoolModuleAccount = await goodLcd.queryModuleAccount(
      notBondedTokenPoolModuleName
    );
    const bondedTokenPoolAmount = await this.readBondedTokenPoolAmountWithCache(
      bondedTokenPoolModuleAccount
    );
    const totalBalances = await this.readTotalBalancesWithCache();
    const totalUnbondingDelegations =
      await this.readUnbondingDelegationsWithCache(
        notBondedTokenPoolModuleAccount
      );
    const totalSupplyIndex = await this.readTotalSupplyIndexWithCache();

    const syncGenesisStateCache: GenesisCache = {
      [this.stakingTokenDenom]: {
        bank: { totalBalances },
        [bondedTokenPoolModuleName]: bondedTokenPoolAmount,
        [notBondedTokenPoolModuleName]: totalUnbondingDelegations,
        totalSupplyIndex,
      },
    };
    return syncGenesisStateCache;
  }
}

export default async (yargs: Argv) => {
  const { argv } = yargs
    .positional("chain-name", {
      type: "string",
      description:
        "The network's chain name matching the dir name on cosmos chain registry. Eg: oraichain for the Oraichain mainnet, cosmoshub for the Cosmos network, osmosis for the Osmosis network. Github link: https://github.com/cosmos/chain-registry",
    })
    .option("sync-home", {
      type: "string",
      description:
        "statesync node location so we can export its genesis state for forking. You must either specify sync-home or exported-genesis-path to fork the node",
    })
    .option("exported-sync-genesis-path", {
      type: "string",
      description:
        "URI of your exported genesis path. If you dont specify this, then you must specify your statesync node.",
    })
    .option("fork-home", {
      type: "string",
      description: "Fork node location",
    })
    .option("daemon-path", {
      type: "string",
      description:
        "your local Go binary path of the network. Eg: /home/go/oraid for Oraichain; /home/go/gaiad for Cosmos. This is optional",
    })
    .option("clear-cache", {
      type: "boolean",
      description:
        "If true, then the exported sync genesis state cache will be cleared, and the program will re-read the states from the original exported genesis file",
      default: false,
    })
    .option("rpc-port", {
      type: "number",
      description: "rpc port of the fork node",
      default: 46657,
    })
    .option("grpc-port", {
      type: "number",
      description: "grpc port of the fork node",
      default: 5090,
    })
    .option("p2p-port", {
      type: "number",
      description: "p2p port of the fork node",
      default: 46656,
    })
    .option("rest-port", {
      type: "number",
      description: "rest port of the fork node",
      default: 5317,
    })
    .option("grpc-web-port", {
      type: "number",
      description: "grpc web port",
      default: 5091,
    });

  try {
    //@ts-ignore
    const [chainName] = argv._.slice(-1);
    //@ts-ignore
    const { syncHome, exportedSyncGenesisPath, daemonPath, clearCache } = argv;
    const {
      forkHome: expectedForkHome,
      rpcPort,
      grpcPort,
      p2pPort,
      restPort,
      grpcWebPort,
    } = argv;
    //@ts-ignore
    const mnemonic = argv.MNEMONIC;
    if (!expectedForkHome) {
      throw serializeError("You need to specify your fork node home");
    }
    if (!syncHome && !exportedSyncGenesisPath) {
      throw serializeError(
        "You need to specify either sync-home or exported-genesis-uri"
      );
    }

    // we need to setup our fork node with basic config
    // fetch chain info data so we can use its lcd & rpc apis
    const chainInfo = await ChainInfo.create(
      chainName,
      expectedForkHome,
      [],
      [],
      daemonPath
    );
    const {
      nodeHome: forkHome,
      daemonPath: daemon,
      chainId,
      stakingTokenDenom,
    } = chainInfo;
    const homeFlag = `--home ${forkHome}`;
    const keyringBackendFlag = `--keyring-backend test`;
    const homeAndKeyringFlags = `${homeFlag} ${keyringBackendFlag}`;
    const appTomlPath = `${chainInfo.nodeHome}/config/app.toml`;
    const portsFlag = `--p2p.laddr tcp://0.0.0.0:${p2pPort} --grpc.address 0.0.0.0:${grpcPort} --rpc.laddr tcp://0.0.0.0:${rpcPort} --grpc-web.address 0.0.0.0:${grpcWebPort}`;
    // export our statesync genesis state if sync home is specified
    let finalExportedSyncGenesisPath: string = exportedSyncGenesisPath;
    if (syncHome && !finalExportedSyncGenesisPath) {
      finalExportedSyncGenesisPath = exportGenesisState(
        chainInfo.daemonPath,
        syncHome,
        defaultExportGenesisPath
      );
    }
    const syncGenesisCachePath = path.join(
      finalExportedSyncGenesisPath.substring(
        0,
        finalExportedSyncGenesisPath.lastIndexOf("/")
      ),
      defaultSyncExportedGenesisCacheName
    );
    if (clearCache) shell.rm(syncGenesisCachePath);
    const syncGenesisReader = await GenesisReader.create(
      finalExportedSyncGenesisPath,
      stakingTokenDenom,
      syncGenesisCachePath
    );
    const syncGenesisStateCache = await syncGenesisReader
      .withChainInfo(chainInfo)
      .readGenesisData();
    shell.echo(JSON.stringify(syncGenesisStateCache)).to(syncGenesisCachePath);
    const syncGenesisStateCacheStakingDenom =
      syncGenesisStateCache[stakingTokenDenom];

    // reset fork node to start over
    shell.rm("-r", forkHome);
    // init fork node
    shell.exec(`${daemon} init ${MONIKER} --chain-id ${chainId} ${homeFlag}`);
    shell.exec(
      `echo ${mnemonic} | ${daemon} keys add ${walletName} --recover ${homeAndKeyringFlags}`
    );
    shell.exec(
      `${daemon} add-genesis-account ${walletName} ${genesisAmount}${stakingTokenDenom} ${homeAndKeyringFlags}`
    );
    // we gentx with bonded token pool from sync node so that the bonded amount of the fork node matches the total bonding of the sync node
    shell.exec(
      `${daemon} gentx ${walletName} ${syncGenesisStateCacheStakingDenom[bondedTokenPoolModuleName]}${stakingTokenDenom} --chain-id ${chainId} ${homeAndKeyringFlags}`
    );
    shell.exec(`${daemon} collect-gentxs ${homeFlag}`);
    shell.exec(`${daemon} validate-genesis ${homeFlag}`);

    // change ports based on user inputs to avoid overlapping with other existing nodes
    shell.sed(
      "-i",
      /tcp:\/\/0\.0\.0\.0:1317/g,
      `tcp://0.0.0.0:${restPort}`,
      appTomlPath
    );

    // start the fork for a couple blocks and stop it after a few blocks so we can export the fork's genesis state
    // the purpose is to replace the fork's staking & consensus states to the sync's states so we can produce new blocks with the sync's states
    const execution = shell.exec(
      `${daemon} start --x-crisis-skip-assert-invariants ${homeFlag} ${portsFlag}`,
      {
        async: true,
      }
    );
    await new Promise((resolve) => setTimeout(resolve, 15000));
    execution.kill();

    // export fork's genesis state so we can start extracting its consensus state
    const forkExportGenesisPath = exportGenesisState(
      daemon,
      forkHome,
      defaultExportGenesisPath
    );
    // read fork's exported genesis state and get ready to extract its consensus state
    const forkGenesisState = await readLargeJsonFile(forkExportGenesisPath);
    console.log("fork genesis state: ", forkGenesisState);

    // we get consensus state from our fork genesis state and apply it to the sync genesis state for the fork
    const slashing = JSON.stringify(forkGenesisState.app_state.slashing);
    const currentDate = new Date();
    const nextYearDate = new Date(currentDate);
    nextYearDate.setFullYear(currentDate.getFullYear() + 1);
    forkGenesisState.app_state.staking.unbonding_delegations = [
      {
        delegator_address:
          forkGenesisState.app_state.staking.delegations[0].delegator_address,
        validator_address:
          forkGenesisState.app_state.staking.delegations[0].validator_address,
        entries: [
          {
            balance:
              syncGenesisStateCacheStakingDenom[notBondedTokenPoolModuleName],
            completion_time: nextYearDate.toISOString(),
            creation_height: "9305417",
            initial_balance:
              syncGenesisStateCacheStakingDenom[bondedTokenPoolModuleName],
          },
        ],
      },
    ];
    const staking = JSON.stringify(forkGenesisState.app_state.staking);
    const validators = JSON.stringify(forkGenesisState.validators);
    // TODO: add change admin of multisig to gain full control of the contracts (for Oraichain network only only)
    // const modifiedMultisigState = `.app_state.wasm.contracts[.app_state.wasm.contracts| map(.contract_address == "${groupAddress}") | index(true)].contract_state = [{"key":"00076D656D62657273${devSharedHexBytes}","value":"Mw=="},{"key":"746F74616C","value":"Mw=="},{"key":"61646D696E","value":"${adminMultiSigInBase64}"}]`;

    const jq = `'.app_state.slashing = ${slashing} | .app_state.staking = ${staking} | .validators = ${validators} | .app_state.staking.params.unbonding_time = "10s" | .app_state.gov.voting_params.voting_period = "60s" | .app_state.gov.deposit_params.min_deposit[0].amount = "1" | .app_state.gov.tally_params.quorum = "0.000000000000000000" | .app_state.gov.tally_params.threshold = "0.000000000000000000" | .app_state.mint.params.inflation_min = "0.500000000000000000" | .app_state.bank.supply[${syncGenesisStateCache.totalSupplyIndex}].amount = "${syncGenesisStateCache.bank.totalBalances}" | .chain_id = "${chainId}-fork"'`;

    // apply all the changes to the sync genesis state so that we can start producing blocks with the sync state
    shell.exec(
      `jq ${jq} ${finalExportedSyncGenesisPath} 2>&1 | tee ${path.join(
        forkHome,
        completedForkGenesisPath
      )} > /dev/null`
    );

    // reset all so that we can apply the new genesis to the fork node
    shell.exec(`${daemon} tendermint unsafe-reset-all ${homeFlag}`);

    // start the program without checking invariants (we dont need to). Remember that the first few blocks will take a very long time (about 30 mins) to produce
    // once done, then the node will start & produce blocks fast
    shell.exec(
      `${daemon} start --x-crisis-skip-assert-invariants ${homeFlag} ${portsFlag}`
    );
  } catch (error) {
    console.log(error);
  }
};

// eg: yarn start network fork oraichain --fork-home ~/.oraid-fork --exported-sync-genesis-path ~/.oraid-sync/config/export-genesis.json
