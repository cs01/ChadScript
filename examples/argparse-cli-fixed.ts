// Full ArgumentParser Demo with == instead of ===
// Compile: npx tsx src/index.ts examples/argparse-cli-fixed.ts
// Run: ./examples/argparse-cli-fixed -v -o output.txt input.txt

import { ArgumentParser } from '../lib/argparse.js';

// Create parser
const parser = new ArgumentParser('argparse-cli', 'Example CLI tool with full argument parsing');

// Add flags
parser.addFlag('verbose', 'v', 'Enable verbose output');
parser.addFlag('force', 'f', 'Force overwrite of output file');

// Add options
parser.addOption('output', 'o', 'Output file path', 'output.txt');
parser.addOption('format', 't', 'Output format', 'text');

// Add positional arguments
parser.addPositional('input', 'Input file to process');

// Parse arguments
parser.parse(process.argv);

// Access parsed values
const verbose = parser.getFlag('verbose');
const force = parser.getFlag('force');
const output = parser.getOption('output');
const format = parser.getOption('format');
const input = parser.getPositional(0);

// Use the arguments
if (verbose) {
  console.log("Verbose mode enabled");
  console.log("Input file: " + input);
  console.log("Output file: " + output);
  console.log("Format: " + format);
  console.log("Force: " + (force ? "true" : "false"));
}

// Change === to ==
if (input.length == 0) {
  console.log("Error: No input file specified");
  parser.printHelp();
  process.exit(1);
}

console.log("Processing " + input + "...");
console.log("Writing to " + output);
console.log("Done!");

process.exit(0);
