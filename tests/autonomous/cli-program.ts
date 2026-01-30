import { ArgumentParser } from '../../lib/argparse.js';

const parser = new ArgumentParser('cli-program', 'ChadScript CLI test program');

parser.addFlag('verbose', 'v', 'Enable verbose output');
parser.addFlag('debug', 'd', 'Enable debug mode');
parser.addOption('output', 'o', 'Output file path', '');
parser.addOption('format', 'f', 'Output format', '');
parser.addPositional('input', 'Input file');

parser.parse(process.argv);

const input = parser.getPositional(0);

if (input.length == 0) {
  console.error("Error: input file required");
  process.exit(1);
}

const verbose = parser.getFlag('verbose');
const debug = parser.getFlag('debug');
const output = parser.getOption('output');
const format = parser.getOption('format');

if (verbose) {
  console.log("Verbose mode enabled");
}

if (debug) {
  console.log("Debug mode enabled");
}

if (output.length > 0) {
  console.log("Output: " + output);
}

if (format.length > 0) {
  console.log("Format: " + format);
}

console.log("Processing: " + input);
