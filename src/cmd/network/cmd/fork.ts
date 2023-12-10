import { Argv } from "yargs";
import shell from "shelljs";
import { serializeError } from "serialize-error";
import { Coin, DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { stringToPath } from "@cosmjs/crypto";
import path from "path";
import { ChainInfo, MONIKER } from "./statesync";
import fs from "fs";
import json from "big-json";

const exportGenesisPath = "config/export-genesis.json";
const genesisAmount = "1000000000000000";
const walletName = "wallet";

const exportGenesisState = (
  daemon: string,
  home: string,
  destinationPath: string
) => {
  // > /dev/null to omit logs in terminal
  shell.exec(
    `${daemon} --home ${home} export 2>&1 | tee ${destinationPath} > /dev/null`
  );
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

// export class GenesisModifier {
//   constructor(public readonly genesisData: any) {}
//   readLargeBalances = async () => {
//     let totalBalances = 0;
//     for (let balance of this.genesisData.app_state.bank.balances) {
//       const coin = balance.coins.find((coin: Coin) => coin.denom === "orai");
//       if (!coin) continue;
//       totalBalances += parseInt(coin.amount);
//     }
//     console.log(
//       "Finished collecting the real total supply of the orai token with total balances: ",
//       totalBalances
//     );
//     return totalBalances.toString();
//   };
// }

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
    .option("exported-genesis-path", {
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
    });

  try {
    //@ts-ignore
    const [chainName] = argv._.slice(-1);
    //@ts-ignore
    const { syncHome, exportedGenesisPath, daemonPath } = argv;
    //@ts-ignore
    const { forkHome: expectedForkHome } = argv;
    //@ts-ignore
    const mnemonic = argv.MNEMONIC;
    let finalExportedGenesisPath = exportedGenesisPath;
    if (!expectedForkHome) {
      throw serializeError("You need to specify your fork node home");
    }
    if (!syncHome && !exportedGenesisPath) {
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

    // export our statesync genesis state if sync home is specified
    if (syncHome && !finalExportedGenesisPath) {
      finalExportedGenesisPath = path.join(syncHome, exportGenesisPath);
      exportGenesisState(
        chainInfo.daemonPath,
        syncHome,
        finalExportedGenesisPath
      );
    }
    const genesis = await readLargeJsonFile(finalExportedGenesisPath);
    // reset fork node to start over
    shell.rm("-r", forkHome);
    const homeFlag = `--home ${forkHome}`;
    const keyringBackendFlag = `--keyring-backend test`;
    const homeAndKeyringFlags = `${homeFlag} ${keyringBackendFlag}`;
    // init fork node
    shell.exec(`${daemon} init ${MONIKER} --chain-id ${chainId} ${homeFlag}`);
    shell.exec(
      `echo ${mnemonic} | ${daemon} keys add ${walletName} --recover ${homeAndKeyringFlags}`
    );
    shell.exec(
      `${daemon} add-genesis-account ${walletName} ${genesisAmount}${stakingTokenDenom} ${homeAndKeyringFlags}`
    );
    const goodLcd = await chainInfo.getGoodLcd();
    const bondedTokenPoolModuleAccount = await goodLcd.queryModuleAccount(
      "bonded_tokens_pool"
    );
    const bondedTokenAccountBalance: { address: string; coins: Coin[] } =
      genesis.app_state.bank.balances.find(
        (balance: any) => balance.address === bondedTokenPoolModuleAccount
      );
    if (!bondedTokenAccountBalance) {
      throw serializeError(
        "Cannot find bonded token module account balance in the genesis file"
      );
    }
    console.log("bonded token account balance: ", bondedTokenAccountBalance);
    // we have to get amount from exported genesis state of sync node because the balance on lcd will keep changing
    const bondedTokenPoolBalanceAmount =
      bondedTokenAccountBalance.coins[0].amount;
    // we gentx with bonded token pool from sync node so that the bonded amount of the fork node matches the total bonding of the sync node
    shell.exec(
      `${daemon} gentx ${walletName} ${bondedTokenPoolBalanceAmount}${stakingTokenDenom} --chain-id ${chainId} ${homeAndKeyringFlags}`
    );
    shell.exec(`${daemon} collect-gentxs ${homeFlag}`);
    shell.exec(`${daemon} validate-genesis ${homeFlag}`);

    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
      hdPaths: [stringToPath(process.env.HD_PATH)],
      prefix: chainInfo.bech32Prefix,
    });
    const [firstAccount] = await wallet.getAccounts();

    // read statesync genesis file
  } catch (error) {
    console.log(error);
  }
};

// eg: yarn start network fork oraichain --forkHome ~/.oraid-fork --exported-genesis-path ~/.oraid-sync/config/export-genesis.json