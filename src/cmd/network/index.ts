import { Argv } from "yargs";
import statesyncCmd from "./cmd/statesync";

export default (yargs: Argv) => {
  yargs
    .usage("usage: $0 network <command> [options]")
    .command(
      "statesync",
      "Run a state sync of a cosmos-based network",
      statesyncCmd
    );
};
