import { ArgumentParser } from "../../../lib/argparse.js";

const parser = new ArgumentParser("myapp", "test double dash");
parser.addSubcommand("run", "Run the project");
parser.addFlag("verbose", "v", "Enable verbose output");
parser.addPositional("input", "Input file");

parser.parse(process.argv);

const cmd = parser.getSubcommand();
console.log("cmd:" + cmd);

const inp = parser.getPositional(0);
console.log("input:" + inp);

const rest = parser.getRestArgs();
let i = 0;
while (i < rest.length) {
  console.log("rest:" + rest[i]);
  i = i + 1;
}

console.log("TEST_PASSED");
process.exit(0);
