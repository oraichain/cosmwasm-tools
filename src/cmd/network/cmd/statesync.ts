import { Argv } from "yargs";
import { serializeError } from "serialize-error";
import { Tendermint37Client } from "@cosmjs/tendermint-rpc";
import shell from "shelljs";
import { fetchRetry } from "../../../common";
import os from "os";
import Downloader from "nodejs-file-downloader";

const MONIKER = "moniker";
const githubUserContent = "https://raw.githubusercontent.com/";

/**
 * This function fetches the chain.json file on cosmos/chain-registry github of a cosmos-based chain
 * @param chainName the chain name matching the directory name of that chain.
 * @returns
 */
export const fetchChainInfo = async (chainName: string): Promise<any> => {
  const res = await fetchRetry(
    `${githubUserContent}/cosmos/chain-registry/master/${chainName}/chain.json`
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

export const getDaemonPath = async (
  daemonName: string,
  binaries: any,
  daemonPath?: string
) => {
  // fetch chain info & download binary based on machine architecture
  const localDaemonPath = shell.which(daemonName);
  let daemon = daemonPath
    ? daemonPath
    : localDaemonPath
    ? localDaemonPath.toString()
    : await downloadDaemon(binaries, daemonName);
  // if empty then it means the running machine does not have the binary downloaded yet. Make an attempt to download it & put it in daemonPath. If daemonPath not specified then we use default location, which is $HOME/<daemon-name>
  console.log("daemon: ", daemon);
  return daemon;
};

export class RpcNode {
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

export class ChainInfo {
  private _p2pNodes: string[];
  private _rpcs: RpcNode[];
  private _daemonName: string;
  private _codebase: any;

  constructor(public readonly chainName: string) {}

  async setupChainInfo(nodeHome: string, p2ps: string[], rpcs: string[]) {
    await this.fetchChainInfo(p2ps, rpcs);
    await this.overrideGenesisFile(nodeHome);
  }
  get p2pNodes(): string[] {
    return this._p2pNodes;
  }
  get rpcs(): RpcNode[] {
    return this._rpcs;
  }
  get daemonName(): string {
    return this._daemonName;
  }
  get codebase(): any {
    return this._codebase;
  }
  private parseP2pPeer(id: string, address: string) {
    return `${id}@${address}`;
  }
  private parseRpc(address: string) {
    return address;
  }

  async fetchChainInfo(additionalP2ps: string[], additionalRpcs: string[]) {
    const {
      daemon_name: daemonName,
      codebase,
      peers,
      apis,
    } = await fetchChainInfo(this.chainName);

    this._daemonName = daemonName;
    this._codebase = codebase;
    const { persistent_peers: p2pNodes } = peers;
    const { rpc: rpcs } = apis;
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

    console.log("persistent peers: ", this._p2pNodes);
    console.log("rpcs: ", this._rpcs);
  }

  async getGoodPeer() {
    return this.rpcs.find(async (instance) => {
      const result = await instance.isCallable();
      return result;
    });
  }

  private fetchGenesisFile = async () => {
    const goodPeer = await this.getGoodPeer();
    const res = await fetchRetry(`${goodPeer.rpcUrl}/genesis`);
    const resJson = await res.json();
    // res json returns a jsonrpc response object: {"jsonrpc":"2.0", "id": -1, "result": {"genesis":{...actual genesis file here}}}
    return (resJson as any).result.genesis;
  };

  async overrideGenesisFile(nodeHome: string) {
    const genesisData = await this.fetchGenesisFile();
    shell
      .ShellString(JSON.stringify(genesisData))
      .to(`${nodeHome}/config/genesis.json`);
  }
}

export class NodeConfigurator {
  constructor(public readonly chainInfo: ChainInfo) {}

  async getGoodPeer() {
    return this.chainInfo.rpcs.find(async (instance) => {
      const result = await instance.isCallable();
      return instance.tmClient && result;
    });
  }

  async configureNodeForStateSync(nodeHome: string, trustHeightRange: number) {
    // update config files for statesync config
    const { p2pNodes, rpcs } = this.chainInfo;
    const appTomlPath = `${nodeHome}/config/app.toml`;
    const configTomlPath = `${nodeHome}/config/config.toml`;
    const goodPeer = await this.getGoodPeer();
    const latestHeight = (await goodPeer.tmClient.block()).block.header.height;
    const trustHeight = latestHeight - trustHeightRange;
    const hashBytes = (await goodPeer.tmClient.block(trustHeight)).blockId.hash;
    const trustHash = Buffer.from(hashBytes).toString("hex").toUpperCase();

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
    shell.sed(
      "-i",
      /^rpc_servers\s*=\s*.*/m,
      `rpc_servers = "${rpcs.map((peer) => peer.rpcUrl).join(",")}"`,
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
      default: [
        // default for Oraichain mainnet peers
        "8b346750e75fd584645192a65c62c7ab88741791@134.209.106.91:26656",
        "4d0f2d042405abbcac5193206642e1456fe89963@3.134.19.98:26656",
        "d088d05d7689905819d4381ae30df4075dbb66e7@34.75.13.200:26656",
        "2c328c41e0ace21c6351265a5a935e1b3f37b62d@35.237.59.125:26656",
      ],
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
      default: `${process.env.HOME}/.oraid`,
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
      daemonPath,
      unsafeResetAll,
    } = argv as any;
    console.log(p2ps, rpcs, trustHeightRange, nodeHome);

    const chainInfo = new ChainInfo(chainName);
    await chainInfo.setupChainInfo(nodeHome, p2ps, rpcs);
    const { daemonName, codebase } = chainInfo;
    const daemon = await getDaemonPath(
      daemonName,
      codebase.binaries,
      daemonPath
    );
    // init node so we have all the config & template files ready for statesync. The --chain-id flag is for temporary only, as we will replace it with the actual genesis file
    shell.exec(
      `${daemon} init ${MONIKER} --chain-id ${chainName} --home ${nodeHome}`
    );

    // update config files for statesync config
    const nodeConfigurator = new NodeConfigurator(chainInfo);
    await nodeConfigurator.configureNodeForStateSync(
      nodeHome,
      trustHeightRange
    );

    // if unsafe-reset-all is true then we reset chain data to start the statesync process all over again
    if (unsafeResetAll) {
      shell.exec(`${daemon} tendermint unsafe-reset-all --home ${nodeHome}`);
    }

    // start the node to start statesync
    shell.exec(`${daemon} start --home ${nodeHome}`);
    const isExecError = shell.error();
    if (isExecError) throw serializeError(isExecError.toString());
  } catch (error) {
    console.log(error);
  }
};

// Eg: yarn start network statesync oraichain
