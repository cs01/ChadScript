// ChadScript-native ArgumentParser
// Simplified argparse-style CLI argument parsing for native binaries
// Note: Uses parallel arrays instead of objects to work around ChadScript type system limitations

export class ArgumentParser {
  programName: string;
  description: string;

  // Parallel arrays to store argument metadata (avoiding complex objects)
  argNames: string[];
  argShortFlags: string[];
  argLongFlags: string[];
  argHelp: string[];
  argIsFlag: boolean[];
  argDefaultValue: string[];
  argIsPositional: boolean[];

  // Parallel arrays for parsed results
  parsedPositionals: string[];
  parsedFlagNames: string[];
  parsedFlagValues: boolean[];
  parsedOptionNames: string[];
  parsedOptionValues: string[];

  constructor(name: string, desc: string) {
    this.programName = name;
    this.description = desc;
    this.argNames = [];
    this.argShortFlags = [];
    this.argLongFlags = [];
    this.argHelp = [];
    this.argIsFlag = [];
    this.argDefaultValue = [];
    this.argIsPositional = [];
    this.parsedPositionals = [];
    this.parsedFlagNames = [];
    this.parsedFlagValues = [];
    this.parsedOptionNames = [];
    this.parsedOptionValues = [];
  }

  // Add a boolean flag (e.g., -v, --verbose)
  addFlag(name: string, shortFlag: string, help: string): void {
    this.argNames.push(name);
    this.argShortFlags.push(shortFlag);
    this.argLongFlags.push(name);
    this.argHelp.push(help);
    this.argIsFlag.push(true);
    this.argDefaultValue.push("");
    this.argIsPositional.push(false);
  }

  // Add an option that takes a value (e.g., -o file.txt, --output file.txt)
  addOption(name: string, shortFlag: string, help: string, defaultVal: string): void {
    this.argNames.push(name);
    this.argShortFlags.push(shortFlag);
    this.argLongFlags.push(name);
    this.argHelp.push(help);
    this.argIsFlag.push(false);
    this.argDefaultValue.push(defaultVal);
    this.argIsPositional.push(false);
  }

  // Add a positional argument (e.g., filename)
  addPositional(name: string, help: string): void {
    this.argNames.push(name);
    this.argShortFlags.push("");
    this.argLongFlags.push("");
    this.argHelp.push(help);
    this.argIsFlag.push(false);
    this.argDefaultValue.push("");
    this.argIsPositional.push(true);
  }

  parse(argv: string[]): number {
    // Clear previous results
    this.parsedPositionals = [];
    this.parsedFlagNames = [];
    this.parsedFlagValues = [];
    this.parsedOptionNames = [];
    this.parsedOptionValues = [];

    // Initialize defaults
    let i = 0;
    while (i < this.argNames.length) {
      if (this.argIsFlag[i]) {
        this.parsedFlagNames.push(this.argNames[i]);
        this.parsedFlagValues.push(false);
      } else if (!this.argIsPositional[i]) {
        this.parsedOptionNames.push(this.argNames[i]);
        this.parsedOptionValues.push(this.argDefaultValue[i]);
      }
      i = i + 1;
    }

    // Parse argv (skip first element which is program name)
    let argIdx = 1;
    while (argIdx < argv.length) {
      const current = argv[argIdx];

      // Check for help
      if (current === "-h" || current === "--help") {
        this.printHelp();
        process.exit(0);
      }

      // Check if it starts with dash (flag or option)
      if (current.charAt(0) === "-") {
        const argIndex = this.findArgument(current);

        if (argIndex === -1) {
          console.log("Unknown option: " + current);
          console.log("Try '" + this.programName + " --help' for more information");
          process.exit(1);
        }

        if (this.argIsFlag[argIndex]) {
          // Set flag value by rebuilding array
          const newFlagValues: boolean[] = [];
          let flagIdx = 0;
          while (flagIdx < this.parsedFlagNames.length) {
            if (this.parsedFlagNames[flagIdx] === this.argNames[argIndex]) {
              newFlagValues.push(true);
            } else {
              newFlagValues.push(this.parsedFlagValues[flagIdx]);
            }
            flagIdx = flagIdx + 1;
          }
          this.parsedFlagValues = newFlagValues;
          argIdx = argIdx + 1;
        } else {
          // Get value
          argIdx = argIdx + 1;
          if (argIdx >= argv.length) {
            console.log("Option " + current + " requires a value");
            process.exit(1);
          }
          // Set option value by rebuilding array
          const newOptionValues: string[] = [];
          let optIdx = 0;
          while (optIdx < this.parsedOptionNames.length) {
            if (this.parsedOptionNames[optIdx] === this.argNames[argIndex]) {
              newOptionValues.push(argv[argIdx]);
            } else {
              newOptionValues.push(this.parsedOptionValues[optIdx]);
            }
            optIdx = optIdx + 1;
          }
          this.parsedOptionValues = newOptionValues;
          argIdx = argIdx + 1;
        }
      } else {
        // Positional argument
        this.parsedPositionals.push(current);
        argIdx = argIdx + 1;
      }
    }

    return 0;
  }

  findArgument(flag: string): number {
    // Remove leading dashes
    let cleanFlag = flag;
    if (flag.charAt(0) === "-") {
      if (flag.charAt(1) === "-") {
        cleanFlag = flag.substring(2, flag.length);
      } else {
        cleanFlag = flag.substring(1, flag.length);
      }
    }

    let i = 0;
    while (i < this.argNames.length) {
      if (this.argShortFlags[i] === cleanFlag || this.argLongFlags[i] === cleanFlag) {
        return i;
      }
      i = i + 1;
    }
    return -1;
  }

  printHelp(): void {
    console.log(this.programName);
    if (this.description.length > 0) {
      console.log(this.description);
    }
    console.log("");

    // Build usage line
    let usage = "Usage: " + this.programName;

    // Add options/flags
    let i = 0;
    while (i < this.argNames.length) {
      if (!this.argIsPositional[i]) {
        if (this.argShortFlags[i].length > 0) {
          usage = usage + " [-" + this.argShortFlags[i];
        } else {
          usage = usage + " [--" + this.argLongFlags[i];
        }

        if (!this.argIsFlag[i]) {
          usage = usage + " <" + this.argNames[i] + ">";
        }
        usage = usage + "]";
      }
      i = i + 1;
    }

    // Add positionals
    i = 0;
    while (i < this.argNames.length) {
      if (this.argIsPositional[i]) {
        usage = usage + " <" + this.argNames[i] + ">";
      }
      i = i + 1;
    }

    console.log(usage);
    console.log("");

    // Print options
    console.log("Options:");
    i = 0;
    while (i < this.argNames.length) {
      if (!this.argIsPositional[i]) {
        let line = "  ";
        if (this.argShortFlags[i].length > 0) {
          line = line + "-" + this.argShortFlags[i] + ", ";
        }
        line = line + "--" + this.argLongFlags[i];

        if (!this.argIsFlag[i] && this.argDefaultValue[i].length > 0) {
          line = line + " (default: " + this.argDefaultValue[i] + ")";
        }

        console.log(line);
        console.log("      " + this.argHelp[i]);
      }
      i = i + 1;
    }

    // Print positional arguments
    let hasPositionals = false;
    i = 0;
    while (i < this.argNames.length) {
      if (this.argIsPositional[i]) {
        hasPositionals = true;
      }
      i = i + 1;
    }

    if (hasPositionals) {
      console.log("");
      console.log("Arguments:");
      i = 0;
      while (i < this.argNames.length) {
        if (this.argIsPositional[i]) {
          console.log("  " + this.argNames[i]);
          console.log("      " + this.argHelp[i]);
        }
        i = i + 1;
      }
    }

    console.log("");
    console.log("  -h, --help");
    console.log("      Show this help message and exit");
  }

  // Public API - access parsed results without needing to pass args around
  getFlag(name: string): boolean {
    let i = 0;
    while (i < this.parsedFlagNames.length) {
      if (this.parsedFlagNames[i] === name) {
        return this.parsedFlagValues[i];
      }
      i = i + 1;
    }
    return false;
  }

  getOption(name: string): string {
    let i = 0;
    while (i < this.parsedOptionNames.length) {
      if (this.parsedOptionNames[i] === name) {
        return this.parsedOptionValues[i];
      }
      i = i + 1;
    }
    return "";
  }

  getPositional(index: number): string {
    if (index < this.parsedPositionals.length) {
      return this.parsedPositionals[index];
    }
    return "";
  }
}
