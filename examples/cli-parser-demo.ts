// CLI Parser Demo - shows how to use ArgumentParser for professional CLI tools
import { ArgumentParser } from "chadscript/argparse";

const parser = new ArgumentParser("cli-parser-demo", "Example CLI tool with argument parsing");
parser.addFlag("verbose", "v", "Enable verbose output");
parser.addOption("output", "o", "Output file path", "output.txt");
parser.addOption("count", "c", "Number of iterations", "1");
parser.addPositional("input", "Input file to process");
parser.parse(process.argv);

const verbose = parser.getFlag("verbose");
const output = parser.getOption("output");
const count = parser.getOption("count");
const input = parser.getPositional(0);

console.log("CLI Parser Demo");
console.log("");

if (verbose) {
  console.log("  verbose:  enabled");
}
console.log("  output:   " + output);
console.log("  count:    " + count);
if (input.length > 0) {
  console.log("  input:    " + input);
} else {
  console.log("  input:    (none)");
}
console.log("");
console.log("Processing " + count + " iterations, writing to " + output);
