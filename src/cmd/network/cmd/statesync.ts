import { Argv } from "yargs";
import { serializeError } from "serialize-error";
import { Tendermint37Client } from "@cosmjs/tendermint-rpc";
import shell from "shelljs";
import { fetchRetry } from "../../../common";
import os from "os";
import Downloader from "nodejs-file-downloader";
import path from "path";

export const MONIKER = "moniker";
const githubUserContent = "https://raw.githubusercontent.com/";

export const parseNodeHomeWithEnvVariable = (nodeHome: string): string => {
  // Define a regular expression to match the variable between $ and /
  const envVariableRegex = /\$(\w+)/;
  // Extract the environment variable name using the regular expression
  const match = nodeHome.match(envVariableRegex);

  // Check if a match is found
  if (match && match[1]) {
    const envVariableName = match[1];

    // Replace $CUSTOM_VAR with the value of the specified environment variable
    const replacedPath = nodeHome.replace(
      envVariableRegex,
      process.env[envVariableName]
    );

    // Use path.resolve to handle any relative paths or additional slashes
    const resolvedPath = path.resolve(replacedPath);
    return resolvedPath;
  }
  throw `The node home is: ${nodeHome}, which is absolute, which should not be correct!`;
};

/**
 * This function fetches the chain.json file on cosmos/chain-registry github of a cosmos-based chain
 * @param chainName the chain name matching the directory name of that chain.
 * @returns
 */
export const fetchChainInfo = async (chainName: string): Promise<any> => {
  const res = await fetchRetry(
    `${githubUserContent}/oraichain/chain-registry/master/${chainName}/chain.json`
  );
  switch (res.status) {
    case 404:
      throw `Cannot find the chain info given your chain name ${chainName}`;
    default:
      return res.json();
  }
};

export const detectDaemonArch = (): string => {
  const arch = os.arch();
  let returnArch: string;
  switch (arch) {
    case "x64":
      returnArch = "amd64";
      break;
    case "arm":
    case "arm64":
      returnArch = "arm64";
      break;
    default:
      returnArch = arch;
      break;
  }
  return `linux/${returnArch}`;
};

// binaries in the form of {"linux/amd64": "url", "linux/arm64": "url"}
// download the daemon & return the location of the downloaded file
export const downloadDaemon = async (
  binaries: object,
  daemonName: string
): Promise<string> => {
  const daemonArch = detectDaemonArch();
  const daemonUrl = binaries[daemonArch];
  const downloader = new Downloader({
    url: daemonUrl,
    directory: `${process.env.HOME}/${daemonName}`,
  });
  const { filePath, downloadStatus } = await downloader.download();
  if (downloadStatus === "ABORTED")
    throw "The daemon download process has been aborted for some reasons. Please try again!";
  return filePath;
};

export interface Callable {
  isCallable: () => Promise<boolean>;
}

export class RpcNode implements Callable {
  public rpcUrl: string;
  public tmClient: Tendermint37Client;
  private constructor(rpcUrl: string) {
    this.rpcUrl = this.buildRpcUrl(rpcUrl);
  }

  static async create(rpcUrl: string): Promise<RpcNode> {
    const peer = new RpcNode(rpcUrl);
    peer.tmClient = await Tendermint37Client.connect(peer.rpcUrl);
    return peer;
  }

  private buildRpcUrl = (rpcUrl: string): string => {
    const regex = /https/i; // The 'i' flag makes the regex case-insensitive
    const containsHttps = regex.test(rpcUrl);
    // force rpc port to be 443 because the statesync rpc servers in config.toml require the domains to have ports
    if (containsHttps) return `${rpcUrl}:443`;
    return rpcUrl;
  };

  public async isCallable(): Promise<boolean> {
    try {
      const res = await fetchRetry(`${this.rpcUrl}/health`);
      const data: any = await res.json();
      if (data.result) return true;
    } catch (error) {
      return false;
    }
  }
}

export class LcdNode implements Callable {
  constructor(public readonly lcdUrl: string) {}
  public async isCallable(): Promise<boolean> {
    try {
      const res = await fetchRetry(`${this.lcdUrl}`);
      const data: any = await res.json();
      // code 12 means not implemented -> lcd is working
      if (data.code && data.code === 12) return true;
    } catch (error) {
      return false;
    }
  }

  public async queryModuleAccount(moduleName: string): Promise<string> {
    const res = await fetchRetry(
      `${this.lcdUrl}/cosmos/auth/v1beta1/module_accounts/${moduleName}`
    );
    const result = await res.json();
    if (result.account) return result.account.base_account.address;
    throw serializeError("Module name is not found");
  }

  // public async queryAccountBalanceByDenom(
  //   address: string,
  //   denom: string
  // ): Promise<string> {
  //   const res = await fetchRetry(
  //     `${this.lcdUrl}/cosmos/bank/v1beta1/balances/${address}/by_denom?denom=${denom}`
  //   );
  //   const result = await res.json();
  //   if (result.balance) return result.balance.amount;
  //   throw serializeError(`Error getting account balance by denom: ${result}`);
  // }
}

export class ChainInfo {
  private _p2pNodes: string[];
  private _rpcs: RpcNode[];
  private _lcds: LcdNode[];
  private _daemonName: string;
  private _codebase: any;
  private _nodeHome: string;
  private _chainId: string;
  private _bech32Prefix: string;
  private _daemonPath: string;
  private _stakingTokenDenom: string;

  public static instance: ChainInfo;

  private constructor(public readonly chainName: string, nodeHome: string) {
    this._nodeHome = nodeHome;
  }
  get p2pNodes(): string[] {
    return this._p2pNodes;
  }
  get rpcs(): RpcNode[] {
    return this._rpcs;
  }
  get lcds(): LcdNode[] {
    return this._lcds;
  }
  get codebase(): any {
    return this._codebase;
  }
  get nodeHome(): string {
    return this._nodeHome;
  }
  get chainId(): string {
    return this._chainId;
  }
  get bech32Prefix(): string {
    return this._bech32Prefix;
  }
  get daemonPath(): string {
    return this._daemonPath;
  }
  get stakingTokenDenom(): string {
    return this._stakingTokenDenom;
  }
  private parseP2pPeer(id: string, address: string) {
    return `${id}@${address}`;
  }
  private parseRpc(address: string) {
    return address;
  }

  static async create(
    chainName: string,
    nodeHome: string,
    additionalP2ps: string[],
    additionalRpcs: string[],
    preferredDaemonPath?: string
  ): Promise<ChainInfo> {
    const chainInfo = new ChainInfo(chainName, nodeHome);
    await chainInfo.parseChainInfo(additionalP2ps, additionalRpcs);
    await chainInfo.getDaemonPath(preferredDaemonPath);
    this.instance = chainInfo;
    return chainInfo;
  }

  // fetch chain info from chain registry & store into the instance
  async parseChainInfo(
    additionalP2ps: string[],
    additionalRpcs: string[]
  ): Promise<void> {
    const {
      daemon_name: daemonName,
      codebase,
      peers,
      apis,
      node_home: nodeHome,
      chain_id: chainId,
      bech32_prefix: bech32Prefix,
      staking,
    } = await fetchChainInfo(this.chainName);
    // console.log(daemonName, codebase, peers, apis);

    // TODO: need to validate if the chain info matches the chain name or not. If not => throw error
    this._daemonName = daemonName;
    this._codebase = codebase;
    this._chainId = chainId;
    this._bech32Prefix = bech32Prefix;
    // main denom token is by default the first element of the array
    this._stakingTokenDenom = staking.staking_tokens[0].denom;
    // by default, we use node home on chain-registry if not specified. on chain registry we tend to use env var for node home
    if (!this._nodeHome) {
      this._nodeHome = parseNodeHomeWithEnvVariable(nodeHome);
    }
    const { persistent_peers: p2pNodes } = peers;
    const { rpc: rpcs, rest: lcds } = apis;
    this._p2pNodes = p2pNodes
      .map((persistent: any) =>
        this.parseP2pPeer(persistent.id, persistent.address)
      )
      .concat(additionalP2ps); // add additional p2p addresses if has
    const promiseSettled = await Promise.allSettled(
      rpcs
        .concat(additionalRpcs.map((rpc) => ({ address: rpc }))) // concat additional rpcs before map so that we can have additional Rpc node classes
        .map(async (rpc: any) => {
          const rpcUrl = this.parseRpc(rpc.address);
          return RpcNode.create(rpcUrl);
        })
    );
    this._rpcs = promiseSettled
      .map((data) => {
        if (data.status === "fulfilled") return data.value;
      })
      .filter((rpc) => rpc);

    this._lcds = lcds.map(
      (lcd: { address: string; provider: string }) => new LcdNode(lcd.address)
    );

    // update & store daemon path
  }

  async getGoodPeer() {
    return this.rpcs.find(async (instance) => {
      return instance.isCallable();
    });
  }

  async getGoodLcd() {
    return this._lcds.find(async (instance) => {
      return instance.isCallable();
    });
  }

  private fetchGenesisFile = async () => {
    const goodPeer = await this.getGoodPeer();
    const res = await fetchRetry(`${goodPeer.rpcUrl}/genesis`);
    const resJson = await res.json();
    // res json returns a jsonrpc response object: {"jsonrpc":"2.0", "id": -1, "result": {"genesis":{...actual genesis file here}}}
    return (resJson as any).result.genesis;
  };

  async overrideGenesisFile() {
    const genesisData = await this.fetchGenesisFile();
    shell
      .ShellString(JSON.stringify(genesisData))
      .to(`${this.nodeHome}/config/genesis.json`);
  }

  private getDaemonPath = async (preferredDaemonPath?: string) => {
    // fetch chain info & download binary based on machine architecture
    const localDaemonPath = shell.which(this._daemonName);
    let daemon = preferredDaemonPath
      ? preferredDaemonPath
      : localDaemonPath
      ? localDaemonPath.toString()
      : await downloadDaemon(this.codebase.binaries, this._daemonName);
    // if empty then it means the running machine does not have the binary downloaded yet. Make an attempt to download it & put it in daemonPath. If daemonPath not specified then we use default location, which is $HOME/<daemon-name>
    console.log("daemon: ", daemon);
    this._daemonPath = daemon;
  };
}

export class NodeConfigurator {
  constructor(public readonly chainInfo: ChainInfo) {}

  async getGoodPeer() {
    return this.chainInfo.rpcs.find(async (instance) => {
      const result = await instance.isCallable();
      return instance.tmClient && result;
    });
  }

  private populateRpcServers(): string[] {
    const rpcUrls = this.chainInfo.rpcs.map((rpc) => rpc.rpcUrl);
    if (this.chainInfo.rpcs.length > 1) {
      return rpcUrls;
    }
    if (rpcUrls.length === 0) {
      throw "Empty RPC URL list. Cannot start the statesync process";
    }
    // double the rpc servers so we can bypass the statesync error: at least two rpc_servers entries is required
    return rpcUrls.concat(rpcUrls);
  }

  async configureNodeForStateSync(trustHeightRange: number) {
    // update config files for statesync config
    const { p2pNodes, rpcs } = this.chainInfo;
    const appTomlPath = `${this.chainInfo.nodeHome}/config/app.toml`;
    const configTomlPath = `${this.chainInfo.nodeHome}/config/config.toml`;
    const goodPeer = await this.getGoodPeer();
    const latestHeight = (await goodPeer.tmClient.block()).block.header.height;
    const trustHeight = latestHeight - trustHeightRange;
    const hashBytes = (await goodPeer.tmClient.block(trustHeight)).blockId.hash;
    const trustHash = Buffer.from(hashBytes).toString("hex").toUpperCase();
    const rpcUrls = this.populateRpcServers();

    // auto config snapshot interval for other nodes to download statesync
    shell.sed(
      "-i",
      /^snapshot-interval\s*=\s*.*/m,
      "snapshot-interval = 1200",
      appTomlPath
    );

    shell.sed(
      "-i",
      /tcp:\/\/127\.0\.0\.1:26657/g,
      "tcp://0.0.0.0:26657",
      configTomlPath
    );

    // update moniker in config.toml
    shell.sed("-i", /^moniker *=.*/g, `moniker = "${MONIKER}"`, configTomlPath);
    // below are commands to add peers & statesync data into config.toml file
    shell.sed("-i", /^enable\s*=\s*.*/m, "enable = true", configTomlPath);
    shell.sed(
      "-i",
      /^allow_duplicate_ip\s*=\s*.*/m,
      "allow_duplicate_ip = true",
      configTomlPath
    );
    shell.sed(
      "-i",
      /^addr_book_strict\s*=\s*.*/m,
      "addr_book_strict = false",
      configTomlPath
    );
    shell.sed(
      "-i",
      /^persistent_peers\s*=\s*.*/m,
      `persistent_peers = "${p2pNodes.join(",")}"`,
      configTomlPath
    );
    // set maximum outbound peers to 0 because we dont want the p2p logs to be too verbose.
    // We only connect to working nodes on chain registry & custom peers from args
    shell.sed(
      "-i",
      /^max_num_outbound_peers\s*=\s*.*/m,
      `max_num_outbound_peers = 0`,
      configTomlPath
    );
    shell.sed(
      "-i",
      /^rpc_servers\s*=\s*.*/m,
      `rpc_servers = "${rpcUrls.join(",")}"`,
      configTomlPath
    );

    shell.sed(
      "-i",
      /^trust_height\s*=\s*.*/m,
      `trust_height = ${trustHeight}`,
      configTomlPath
    );

    shell.sed(
      "-i",
      /^trust_hash\s*=\s*.*/m,
      `trust_hash = "${trustHash}"`,
      configTomlPath
    );
  }
}

export default async (yargs: Argv) => {
  const { argv } = yargs
    .positional("chain-name", {
      type: "string",
      description:
        "The network's chain name matching the dir name on cosmos chain registry. Eg: oraichain for the Oraichain mainnet, cosmoshub for the Cosmos network, osmosis for the Osmosis network. Github link: https://github.com/cosmos/chain-registry",
    })
    .option("daemon-path", {
      type: "string",
      description:
        "your local Go binary path of the network. Eg: /home/go/oraid for Oraichain; /home/go/gaiad for Cosmos. This is optional",
    })
    .option("p2ps", {
      type: "array",
      description:
        'Extra p2p addresses with their node ids to guarantee that the statesync process will complete. Eg: "4d0f2d042405abbcac5193206642e1456fe89963@3.134.19.98:26656". This is optional as the script will automatically get all peers & rpcs on chain registry',
      default: [],
    })
    .option("rpcs", {
      type: "array",
      description:
        'Extra rpc addresses / domains. Eg: "htps://rpc.orai.io; http://3.134.19.98:26657". This is optional as the script will automatically get all peers & rpcs on chain registry',
      default: [],
    })
    .option("trust-height-range", {
      type: "number",
      default: 5000,
    })
    .option("unsafe-reset-all", {
      type: "boolean",
      default: false,
      description:
        "If true, then the statesync node will be reset and it will start the syncing process from latest height - trust height range",
    })
    .option("node-home", {
      type: "string",
      description:
        "The node's local config & data storage directory. If not specified, then the default directory will be collected from the chain registry",
      default: "",
    })
    .option("clear", {
      type: "boolean",
      description: "Clear the old directory before starting",
      default: false,
    });
  try {
    //@ts-ignore
    const [chainName] = argv._.slice(-1);
    if (!chainName)
      throw serializeError(
        "You need to specify the chain name so that we can fetch its chain id & matching binary"
      );
    //@ts-ignore
    const {
      p2ps,
      rpcs,
      trustHeightRange,
      nodeHome,
      daemonPath: preferredDaemonPath,
      unsafeResetAll,
      clear,
    } = argv as any;
    console.log(p2ps, rpcs, trustHeightRange, nodeHome);

    const chainInfo = await ChainInfo.create(
      chainName,
      nodeHome,
      p2ps,
      rpcs,
      preferredDaemonPath
    );
    await chainInfo.overrideGenesisFile();
    const { daemonPath: daemon, nodeHome: newNodeHome, chainId } = chainInfo;
    // clear the directory before init
    if (clear) {
      shell.rm("-r", newNodeHome);
    }

    shell.exec(
      `${daemon} init ${MONIKER} --chain-id ${chainId} --home ${newNodeHome}`
    );

    // update config files for statesync config
    const nodeConfigurator = new NodeConfigurator(chainInfo);
    await nodeConfigurator.configureNodeForStateSync(trustHeightRange);

    // if unsafe-reset-all is true then we reset chain data to start the statesync process all over again
    if (unsafeResetAll) {
      shell.exec(`${daemon} tendermint unsafe-reset-all --home ${newNodeHome}`);
    }

    // start the node to start statesync
    shell.exec(`${daemon} start --home ${newNodeHome}`);
  } catch (error) {
    console.log(error);
  }
};

// Eg: yarn start network statesync oraichain
