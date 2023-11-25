import { Argv } from "yargs";
import fs from "fs";
import statesyncCmd from "./cmd/statesync";

export default (yargs: Argv) => {
  yargs
    .usage("usage: $0 network <command> [options]")
    .config("file-input", (path) => {
      return { input: fs.readFileSync(path).toString() };
    })
    .command(
      "statesync",
      "Run a state sync of a cosmos-based network",
      statesyncCmd
    );
};
