import { Argv } from "yargs";
import statesyncCmd from "./cmd/statesync";
import forkCmd from "./cmd/fork";

export default (yargs: Argv) => {
  yargs
    .usage("usage: $0 network <command> [options]")
    .command(
      "statesync",
      "Run a state sync of a cosmos-based network",
      statesyncCmd
    )
    .command(
      "fork",
      "Fork a cosmos-based network. Before running: need .env file for MNEMONIC env var, jq for parsing json, shelljs npm installed globally ",
      forkCmd
    );
};
