// Simple ArgumentParser Demo - minimal example without class arrays
// Compile: npx tsx src/index.ts examples/argparse-simple.ts
// Run: ./examples/argparse-simple -v

// Global state (avoids class arrays)
let verboseEnabled = false;
let outputFile = "output.txt";

function parseArgs(argv: string[]): number {
  let i = 1;  // Skip program name

  while (i < argv.length) {
    const arg = argv[i];

    if (arg === "-v" || arg === "--verbose") {
      verboseEnabled = true;
      i = i + 1;
    } else if (arg === "-o" || arg === "--output") {
      i = i + 1;
      if (i < argv.length) {
        outputFile = argv[i];
        i = i + 1;
      } else {
        console.log("Error: -o requires a value");
        return 1;
      }
    } else if (arg === "-h" || arg === "--help") {
      console.log("Usage: argparse-simple [-v] [-o output]");
      console.log("Options:");
      console.log("  -v, --verbose    Enable verbose output");
      console.log("  -o, --output     Output file (default: output.txt)");
      console.log("  -h, --help       Show this help");
      return 0;
    } else {
      console.log("Unknown option: " + arg);
      return 1;
    }
  }

  return 0;
}

// Main
const result = parseArgs(process.argv);

if (result === 0) {
  if (verboseEnabled) {
    console.log("Verbose mode enabled");
    console.log("Output file: " + outputFile);
  }

  console.log("Processing...");
  console.log("Writing to " + outputFile);
  console.log("Done!");
  console.log("TEST_PASSED");
}

process.exit(result);
