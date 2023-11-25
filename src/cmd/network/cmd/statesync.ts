import { Argv } from "yargs";
import { serializeError } from "serialize-error";
import { Tendermint37Client } from "@cosmjs/tendermint-rpc";
import shell from "shelljs";
import { fetchRetry } from "../../../common";
import os from "os";
import Downloader from "nodejs-file-downloader";

// TODO: make RPC & P2P ports more dynamic
const PEER_RPC_PORT = 26657;
const PEER_P2P_PORT = 26656;
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

export const getDaemonPath = async (chainName: string, daemonPath?: string) => {
  // fetch chain info & download binary based on machine architecture
  const { daemon_name: daemonName, codebase } = await fetchChainInfo(chainName);
  console.log(daemonName, codebase);

  const localDaemonPath = shell.which(daemonName);
  let daemon = daemonPath
    ? daemonPath
    : localDaemonPath
    ? localDaemonPath.toString()
    : await downloadDaemon(codebase.binaries, daemonName);
  // if empty then it means the running machine does not have the binary downloaded yet. Make an attempt to download it & put it in daemonPath. If daemonPath not specified then we use default location, which is $HOME/<daemon-name>
  console.log("daemon: ", daemon);
  return daemon;
};

export class Peer {
  public readonly ip: string;
  public rpcUrl: string;
  public p2pUrl: string;
  public tmClient: Tendermint37Client;
  constructor(ip: string) {
    this.ip = ip;
    this.rpcUrl = this.buildRpcUrl(PEER_RPC_PORT);
  }

  // TODO: support rpc domain as well
  private buildRpcUrl = (port: number): string => {
    return `http://${this.ip}:${port}`;
  };

  private connectTmClient = async () => {
    if (!this.tmClient)
      this.tmClient = await Tendermint37Client.connect(this.rpcUrl);
  };

  buildP2pUrl = async (port: number): Promise<string> => {
    await this.connectTmClient();
    const status = await this.tmClient.status();
    this.p2pUrl = `${Buffer.from(status.nodeInfo.id).toString("hex")}@${
      this.ip
    }:${port}`;
    return this.p2pUrl;
  };

  fetchGenesisFile = async () => {
    const res = await fetchRetry(`${this.rpcUrl}/genesis`);
    const resJson = await res.json();
    // res json returns a jsonrpc response object: {"jsonrpc":"2.0", "id": -1, "result": {"genesis":{...actual genesis file here}}}
    return (resJson as any).result.genesis;
  };
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
    .option("peer-ips", {
      type: "array",
      description: 'Eg: "3.134.19.98"',
      default: [
        "134.209.106.91",
        "3.134.19.98",
        "34.75.13.200",
        "35.237.59.125",
      ],
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
    const { peerIps, trustHeightRange, nodeHome, daemonPath, unsafeResetAll } =
      argv;
    console.log(peerIps, trustHeightRange, nodeHome);
    if (peerIps.length === 0)
      throw serializeError(
        "There is no peer ip to process statesync. Please have at least one peer ip"
      );

    const peers: Peer[] = await Promise.all(
      peerIps.map(async (ip: string) => {
        const peer = new Peer(ip);
        await peer.buildP2pUrl(PEER_P2P_PORT);
        return peer;
      })
    );

    const daemon = await getDaemonPath(chainName, daemonPath);
    // init node so we have all the config & template files ready for statesync. The --chain-id flag is for temporary only, as we will replace it with the actual genesis file
    shell.exec(
      `${daemon} init ${MONIKER} --chain-id ${chainName} --home ${nodeHome}`
    );

    // download genesis from rpc & move it to the nodeHome
    // TODO: should not rely on the first peer. If error, switch to the next peers
    const firstPeer = peers[0];
    const genesisData = await firstPeer.fetchGenesisFile();
    // overwrite json genesis data
    shell
      .ShellString(JSON.stringify(genesisData))
      .to(`${nodeHome}/config/genesis.json`);

    // update config files for statesync config
    const appTomlPath = `${nodeHome}/config/app.toml`;
    const configTomlPath = `${nodeHome}/config/config.toml`;
    const latestHeight = (await firstPeer.tmClient.block()).block.header.height;
    const trustHeight = latestHeight - trustHeightRange;
    const hashBytes = (await firstPeer.tmClient.block(trustHeight)).blockId
      .hash;
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
      `persistent_peers = "${peers.map((peer) => peer.p2pUrl).join(",")}"`,
      configTomlPath
    );
    shell.sed(
      "-i",
      /^rpc_servers\s*=\s*.*/m,
      `rpc_servers = "${peers.map((peer) => peer.rpcUrl).join(",")}"`,
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

    // if unsafe-reset-all is true then we reset chain data to start the statesync process all over again
    if (unsafeResetAll) {
      shell.exec(`${daemon} tendermint unsafe-reset-all --home ${nodeHome}`);
    }

    // start the node to start statesync with halt height = latest height at the time of querying
    shell.exec(
      `${daemon} start --home ${nodeHome} --halt-height ${latestHeight}`
    );
    const isExecError = shell.error();
    if (isExecError) throw serializeError(isExecError.toString());
  } catch (error) {
    console.log(error);
  }
};
