import { Argv } from "yargs";
import { serializeError } from "serialize-error";
import { Tendermint37Client } from "@cosmjs/tendermint-rpc";
import shell from "shelljs";
import fetch from "node-fetch";

const PEER_RPC_PORT = 26657;
const PEER_P2P_PORT = 26656;
const MONIKER = "moniker";

export class Peer {
  public readonly ip: string;
  public rpcUrl: string;
  public p2pUrl: string;
  public tmClient: Tendermint37Client;
  constructor(ip: string) {
    this.ip = ip;
    this.rpcUrl = this.buildRpcUrl(PEER_RPC_PORT);
  }

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
    const res = await fetch(`${this.rpcUrl}/genesis`);
    const resJson = await res.json();
    // res json returns a jsonrpc response object: {"jsonrpc":"2.0", "id": -1, "result": {"genesis":{...actual genesis file here}}}
    return (resJson as any).result.genesis;
  };
}

export default async (yargs: Argv) => {
  const { argv } = yargs
    .positional("chain-id", {
      type: "string",
      description:
        "The network's chain id. Eg: Oraichain for the Oraichain mainnet",
    })
    .option("binary-name", {
      type: "string",
      description:
        "your Go binary name of the network. Eg: oraid for Oraichain; gaiad for Cosmos",
      default: "oraid",
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
    .option("node-home", {
      type: "string",
      default: `${process.env.HOME}/.oraid`,
    });
  try {
    //@ts-ignore
    const [chainId] = argv._.slice(-1);
    if (!chainId) throw serializeError("You need to specify the chain id");
    //@ts-ignore
    const { peerIps, trustHeightRange, nodeHome, binaryName } = argv;
    console.log(peerIps, trustHeightRange, nodeHome, binaryName);
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

    const binaryPath = shell.which(binaryName);
    console.log("binary path: ", binaryPath.toString());
    // init node so we have all the config & template files ready for statesync
    shell.exec(
      `${binaryName} init ${MONIKER} --chain-id ${chainId} --home ${nodeHome}`
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

    // start the node to start statesync with halt height = latest height at the time of querying
    shell.exec(
      `${binaryName} start --home ${nodeHome} --halt-height ${latestHeight}`
    );
    const isExecError = shell.error();
    if (isExecError) throw serializeError(isExecError.toString());
  } catch (error) {
    console.log(error);
  }
  // shell.env["VAR"] = "hello world";
  // const result = shell.echo(process.env.VAR);
  // console.log("result: ", result.toString());
};
