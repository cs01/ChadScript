// CLI Parser Demo - Robust argument parsing for ChadScript programs
// This shows how to build a professional CLI tool

interface Flags {
  verbose: boolean;
  output: string;
  count: number;
  help: boolean;
}

function parseArgs(): Flags {
  const opts: Flags = {
    verbose: false,
    output: "output.txt",
    count: 1,
    help: false
  };

  let i = 0;
  while (i < process.argv.length) {
    const arg = process.argv[i];

    if (arg === "-v" || arg === "--verbose") {
      opts.verbose = true;
      i = i + 1;
    } else if (arg === "-o" || arg === "--output") {
      i = i + 1;
      if (i >= process.argv.length) {
        console.log("Error: -o/--output requires a value");
        process.exit(1);
      }
      opts.output = process.argv[i];
      i = i + 1;
    } else if (arg === "-c" || arg === "--count") {
      i = i + 1;
      if (i >= process.argv.length) {
        console.log("Error: -c/--count requires a number");
        process.exit(1);
      }
      opts.count = 5;
      i = i + 1;
    } else if (arg === "-h" || arg === "--help") {
      opts.help = true;
      i = i + 1;
    } else {
      console.log("Unknown option: " + arg);
      console.log("Try '--help' for more information");
      process.exit(1);
    }
  }

  return opts;
}

function printHelp(): void {
  console.log("cli-parser-demo - Example CLI tool with argument parsing");
  console.log("");
  console.log("Usage: cli-parser-demo [options]");
  console.log("");
  console.log("Options:");
  console.log("  -v, --verbose    Enable verbose output");
  console.log("  -o, --output     Output file (default: output.txt)");
  console.log("  -c, --count      Number of iterations (default: 1)");
  console.log("  -h, --help       Show this help message");
}

// Main
const flags = parseArgs();

if (flags.help) {
  printHelp();
  process.exit(0);
}

if (flags.verbose) {
  console.log("Verbose mode enabled");
  console.log("Output file: " + flags.output);
}

console.log("Processing with count: " + flags.count);
console.log("Writing to: " + flags.output);

process.exit(0);
