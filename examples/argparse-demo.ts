// ArgumentParser Demo - argparse-style CLI argument parsing

class ArgumentParser {
  programName: string;
  description: string;
  helpFlag: boolean;

  constructor(name: string, desc: string) {
    this.programName = name;
    this.description = desc;
    this.helpFlag = false;
  }

  parseFlags(): void {
    let i = 1;
    while (i < process.argv.length) {
      const arg = process.argv[i];

      if (arg === "-h" || arg === "--help") {
        this.helpFlag = true;
      }

      i = i + 1;
    }
  }

  showHelp(): void {
    console.log(this.programName);
    console.log(this.description);
  }
}

// Usage
const parser = new ArgumentParser("my-cli", "A demo CLI tool");
parser.parseFlags();

if (parser.helpFlag) {
  parser.showHelp();
  process.exit(0);
}

console.log("Running the CLI tool...");
process.exit(0);
