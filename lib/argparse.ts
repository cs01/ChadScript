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
  argSubcommands: string[];

  // Subcommand metadata
  subcmdNames: string[];
  subcmdDescriptions: string[];
  parsedSubcommand: string;

  // Rest args (after --)
  restArgs: string[];

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
    this.argSubcommands = [];
    this.subcmdNames = [];
    this.subcmdDescriptions = [];
    this.parsedSubcommand = "";
    this.restArgs = [];
    this.parsedPositionals = [];
    this.parsedFlagNames = [];
    this.parsedFlagValues = [];
    this.parsedOptionNames = [];
    this.parsedOptionValues = [];
  }

  addSubcommand(name: string, desc: string): void {
    this.subcmdNames.push(name);
    this.subcmdDescriptions.push(desc);
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
    this.argSubcommands.push("");
  }

  addScopedFlag(name: string, shortFlag: string, help: string, subcommands: string): void {
    this.argNames.push(name);
    this.argShortFlags.push(shortFlag);
    this.argLongFlags.push(name);
    this.argHelp.push(help);
    this.argIsFlag.push(true);
    this.argDefaultValue.push("");
    this.argIsPositional.push(false);
    this.argSubcommands.push(subcommands);
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
    this.argSubcommands.push("");
  }

  addScopedOption(name: string, shortFlag: string, help: string, defaultVal: string, subcommands: string): void {
    this.argNames.push(name);
    this.argShortFlags.push(shortFlag);
    this.argLongFlags.push(name);
    this.argHelp.push(help);
    this.argIsFlag.push(false);
    this.argDefaultValue.push(defaultVal);
    this.argIsPositional.push(false);
    this.argSubcommands.push(subcommands);
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
    this.argSubcommands.push("");
  }

  isArgInScope(argIndex: number, subcommand: string): boolean {
    if (this.argSubcommands[argIndex].length === 0) {
      return true;
    }
    if (subcommand.length === 0) {
      return false;
    }
    const scopes = this.argSubcommands[argIndex];
    let start = 0;
    let pos = 0;
    while (pos <= scopes.length) {
      if (pos === scopes.length || scopes.charAt(pos) === ",") {
        const part = scopes.substring(start, pos);
        if (part.length > 0 && part === subcommand) {
          return true;
        }
        start = pos + 1;
      }
      pos = pos + 1;
    }
    return false;
  }

  findSubcommand(name: string): number {
    let i = 0;
    while (i < this.subcmdNames.length) {
      if (this.subcmdNames[i].length > 0 && this.subcmdNames[i] === name) {
        return i;
      }
      i = i + 1;
    }
    return -1;
  }

  splitEqualsFlag(arg: string): string {
    let pos = 0;
    while (pos < arg.length) {
      if (arg.charAt(pos) === "=") {
        return arg.substring(0, pos);
      }
      pos = pos + 1;
    }
    return arg;
  }

  splitEqualsValue(arg: string): string {
    let pos = 0;
    while (pos < arg.length) {
      if (arg.charAt(pos) === "=") {
        return arg.substring(pos + 1, arg.length);
      }
      pos = pos + 1;
    }
    return "";
  }

  hasEquals(arg: string): boolean {
    let pos = 0;
    while (pos < arg.length) {
      if (arg.charAt(pos) === "=") {
        return true;
      }
      pos = pos + 1;
    }
    return false;
  }

  setFlagValue(argIndex: number): void {
    const newFlagValues: boolean[] = [];
    let flagIdx = 0;
    while (flagIdx < this.parsedFlagNames.length) {
      if (this.parsedFlagNames[flagIdx].length > 0 && this.argNames[argIndex].length > 0 &&
          this.parsedFlagNames[flagIdx] === this.argNames[argIndex]) {
        newFlagValues.push(true);
      } else {
        newFlagValues.push(this.parsedFlagValues[flagIdx]);
      }
      flagIdx = flagIdx + 1;
    }
    this.parsedFlagValues = newFlagValues;
  }

  setOptionValue(argIndex: number, value: string): void {
    const newOptionValues: string[] = [];
    let optIdx = 0;
    while (optIdx < this.parsedOptionNames.length) {
      if (this.parsedOptionNames[optIdx].length > 0 && this.argNames[argIndex].length > 0 &&
          this.parsedOptionNames[optIdx] === this.argNames[argIndex]) {
        newOptionValues.push(value);
      } else {
        newOptionValues.push(this.parsedOptionValues[optIdx]);
      }
      optIdx = optIdx + 1;
    }
    this.parsedOptionValues = newOptionValues;
  }

  initDefaults(): void {
    this.parsedPositionals = [];
    this.parsedFlagNames = [];
    this.parsedFlagValues = [];
    this.parsedOptionNames = [];
    this.parsedOptionValues = [];
    this.parsedSubcommand = "";
    this.restArgs = [];

    let i = 0;
    while (i < this.argNames.length) {
      if (this.argNames[i].length > 0) {
        if (this.argIsFlag[i]) {
          this.parsedFlagNames.push(this.argNames[i]);
          this.parsedFlagValues.push(false);
        } else if (!this.argIsPositional[i]) {
          this.parsedOptionNames.push(this.argNames[i]);
          if (this.argDefaultValue[i].length > 0) {
            this.parsedOptionValues.push(this.argDefaultValue[i]);
          } else {
            this.parsedOptionValues.push("");
          }
        }
      }
      i = i + 1;
    }
  }

  parseFlag(argv: string[], argIdx: number): number {
    const raw = argv[argIdx];
    let flagPart = raw;
    let valuePart = "";
    let gotEquals = false;

    if (this.hasEquals(raw)) {
      flagPart = this.splitEqualsFlag(raw);
      valuePart = this.splitEqualsValue(raw);
      gotEquals = true;
    }

    const argIndex = this.findArgument(flagPart);

    if (argIndex === -1) {
      console.error("Unknown option: " + raw);
      console.error("Try '" + this.programName + " --help' for more information");
      process.exit(1);
    }

    if (this.argIsFlag[argIndex]) {
      this.setFlagValue(argIndex);
      return argIdx + 1;
    } else {
      if (gotEquals) {
        this.setOptionValue(argIndex, valuePart);
        return argIdx + 1;
      } else {
        const nextIdx = argIdx + 1;
        if (nextIdx >= argv.length) {
          console.error("Error: Option --" + this.argNames[argIndex] + " requires a value");
          process.exit(1);
        }
        this.setOptionValue(argIndex, argv[nextIdx]);
        return nextIdx + 1;
      }
    }
  }

  parse(argv: string[]): number {
    this.initDefaults();

    if (this.subcmdNames.length === 0) {
      return this.parseSimple(argv);
    }
    return this.parseWithSubcommands(argv);
  }

  parseSimple(argv: string[]): number {
    let argIdx = 0;
    while (argIdx < argv.length) {
      if (argv[argIdx].length > 0 && (argv[argIdx] === "-h" || argv[argIdx] === "--help")) {
        this.printHelp();
        process.exit(0);
      }

      if (argv[argIdx].length > 0 && argv[argIdx] === "--") {
        argIdx = argIdx + 1;
        while (argIdx < argv.length) {
          this.restArgs.push(argv[argIdx]);
          argIdx = argIdx + 1;
        }
        return 0;
      }

      if (argv[argIdx].length > 0 && argv[argIdx].charAt(0) === "-") {
        argIdx = this.parseFlag(argv, argIdx);
      } else {
        if (argv[argIdx].length > 0) {
          this.parsedPositionals.push(argv[argIdx]);
        }
        argIdx = argIdx + 1;
      }
    }

    return 0;
  }

  parseWithSubcommands(argv: string[]): number {
    let argIdx = 0;

    while (argIdx < argv.length) {
      const cur = argv[argIdx];

      if (cur.length > 0 && (cur === "-h" || cur === "--help")) {
        this.printHelp();
        process.exit(0);
      }

      if (cur.length > 0 && cur.charAt(0) === "-") {
        const flagPart = this.hasEquals(cur) ? this.splitEqualsFlag(cur) : cur;
        const argIndex = this.findArgument(flagPart);
        if (argIndex !== -1 && this.isArgInScope(argIndex, "")) {
          argIdx = this.parseFlag(argv, argIdx);
        } else if (argIndex !== -1) {
          argIdx = this.parseFlag(argv, argIdx);
        } else {
          console.error("Unknown option: " + cur);
          console.error("Try '" + this.programName + " --help' for more information");
          process.exit(1);
        }
      } else {
        if (cur.length > 0) {
          const subcmdIdx = this.findSubcommand(cur);
          if (subcmdIdx !== -1) {
            this.parsedSubcommand = cur;
            argIdx = argIdx + 1;
            return this.parseAfterSubcommand(argv, argIdx);
          } else {
            const endsTs = cur.length >= 3 && cur.substr(cur.length - 3) === ".ts";
            const endsJs = cur.length >= 3 && cur.substr(cur.length - 3) === ".js";
            if (endsTs || endsJs) {
              console.error(this.programName + ": error: missing command. did you mean " + this.programName + " build " + cur + "?");
            } else {
              console.error(this.programName + ": error: unknown command '" + cur + "'");
            }
            console.error("Run " + this.programName + " --help for usage");
            process.exit(1);
          }
        }
        argIdx = argIdx + 1;
      }
    }

    return 0;
  }

  parseAfterSubcommand(argv: string[], startIdx: number): number {
    let argIdx = startIdx;

    while (argIdx < argv.length) {
      const cur = argv[argIdx];

      if (cur.length > 0 && (cur === "-h" || cur === "--help")) {
        this.printSubcommandHelp(this.parsedSubcommand);
        process.exit(0);
      }

      if (cur.length > 0 && cur === "--") {
        argIdx = argIdx + 1;
        while (argIdx < argv.length) {
          this.restArgs.push(argv[argIdx]);
          argIdx = argIdx + 1;
        }
        return 0;
      }

      if (cur.length > 0 && cur.charAt(0) === "-") {
        argIdx = this.parseFlag(argv, argIdx);
      } else {
        if (cur.length > 0) {
          this.parsedPositionals.push(cur);
        }
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
      // Check length > 0 to avoid strcmp on NULL/empty strings
      if ((this.argShortFlags[i].length > 0 && this.argShortFlags[i] === cleanFlag) ||
          (this.argLongFlags[i].length > 0 && this.argLongFlags[i] === cleanFlag)) {
        return i;
      }
      i = i + 1;
    }
    return -1;
  }

  printHelp(): void {
    if (this.subcmdNames.length > 0) {
      this.printTopLevelHelp();
    } else {
      this.printSimpleHelp();
    }
  }

  printSimpleHelp(): void {
    console.log(this.programName);
    if (this.description.length > 0) {
      console.log(this.description);
    }
    console.log("");

    let usage = "Usage: " + this.programName;

    let i = 0;
    while (i < this.argNames.length) {
      if (!this.argIsPositional[i]) {
        if (this.argShortFlags[i].length > 0) {
          if (!this.argIsFlag[i]) {
            usage = usage + " [-" + this.argShortFlags[i] + " <" + this.argNames[i] + ">]";
          } else {
            usage = usage + " [-" + this.argShortFlags[i] + "]";
          }
        } else {
          if (!this.argIsFlag[i]) {
            usage = usage + " [--" + this.argLongFlags[i] + " <" + this.argNames[i] + ">]";
          } else {
            usage = usage + " [--" + this.argLongFlags[i] + "]";
          }
        }
      }
      i = i + 1;
    }

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
        if (this.argShortFlags[i].length > 0) {
          if (!this.argIsFlag[i] && this.argDefaultValue[i].length > 0) {
            console.log("  -" + this.argShortFlags[i] + ", --" + this.argLongFlags[i] + " (default: " + this.argDefaultValue[i] + ")");
          } else {
            console.log("  -" + this.argShortFlags[i] + ", --" + this.argLongFlags[i]);
          }
        } else {
          if (!this.argIsFlag[i] && this.argDefaultValue[i].length > 0) {
            console.log("  --" + this.argLongFlags[i] + " (default: " + this.argDefaultValue[i] + ")");
          } else {
            console.log("  --" + this.argLongFlags[i]);
          }
        }
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

  printTopLevelHelp(): void {
    console.log(this.programName);
    if (this.description.length > 0) {
      console.log(this.description);
    }
    console.log("");
    console.log("Usage: " + this.programName + " <command> [options]");
    console.log("");
    console.log("Commands:");
    let i = 0;
    while (i < this.subcmdNames.length) {
      let line = "  " + this.subcmdNames[i];
      let padLen = 16 - this.subcmdNames[i].length;
      if (padLen < 2) {
        padLen = 2;
      }
      let pad = 0;
      while (pad < padLen) {
        line = line + " ";
        pad = pad + 1;
      }
      line = line + this.subcmdDescriptions[i];
      console.log(line);
      i = i + 1;
    }

    let hasGlobalArgs = false;
    i = 0;
    while (i < this.argNames.length) {
      if (!this.argIsPositional[i] && this.argSubcommands[i].length === 0) {
        hasGlobalArgs = true;
      }
      i = i + 1;
    }

    if (hasGlobalArgs) {
      console.log("");
      console.log("Global options:");
      i = 0;
      while (i < this.argNames.length) {
        if (!this.argIsPositional[i] && this.argSubcommands[i].length === 0) {
          this.printArgLine(i);
        }
        i = i + 1;
      }
    }

    console.log("");
    console.log("  -h, --help");
    console.log("      Show this help message and exit");
    console.log("");
    console.log("Run '" + this.programName + " <command> --help' for more information on a command.");
  }

  printSubcommandHelp(subcmd: string): void {
    let subcmdDesc = "";
    let i = 0;
    while (i < this.subcmdNames.length) {
      if (this.subcmdNames[i] === subcmd) {
        subcmdDesc = this.subcmdDescriptions[i];
      }
      i = i + 1;
    }

    console.log(this.programName + " " + subcmd);
    if (subcmdDesc.length > 0) {
      console.log(subcmdDesc);
    }
    console.log("");

    let usage = "Usage: " + this.programName + " " + subcmd;
    i = 0;
    while (i < this.argNames.length) {
      if (!this.argIsPositional[i] && this.isArgInScope(i, subcmd)) {
        if (this.argShortFlags[i].length > 0) {
          if (!this.argIsFlag[i]) {
            usage = usage + " [-" + this.argShortFlags[i] + " <" + this.argNames[i] + ">]";
          } else {
            usage = usage + " [-" + this.argShortFlags[i] + "]";
          }
        } else {
          if (!this.argIsFlag[i]) {
            usage = usage + " [--" + this.argLongFlags[i] + " <" + this.argNames[i] + ">]";
          } else {
            usage = usage + " [--" + this.argLongFlags[i] + "]";
          }
        }
      }
      i = i + 1;
    }
    i = 0;
    while (i < this.argNames.length) {
      if (this.argIsPositional[i]) {
        usage = usage + " <" + this.argNames[i] + ">";
      }
      i = i + 1;
    }
    console.log(usage);
    console.log("");

    let hasOptions = false;
    i = 0;
    while (i < this.argNames.length) {
      if (!this.argIsPositional[i] && this.isArgInScope(i, subcmd)) {
        hasOptions = true;
      }
      i = i + 1;
    }

    if (hasOptions) {
      console.log("Options:");
      i = 0;
      while (i < this.argNames.length) {
        if (!this.argIsPositional[i] && this.isArgInScope(i, subcmd)) {
          this.printArgLine(i);
        }
        i = i + 1;
      }
    }

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

  printArgLine(i: number): void {
    if (this.argShortFlags[i].length > 0) {
      if (!this.argIsFlag[i] && this.argDefaultValue[i].length > 0) {
        console.log("  -" + this.argShortFlags[i] + ", --" + this.argLongFlags[i] + " (default: " + this.argDefaultValue[i] + ")");
      } else {
        console.log("  -" + this.argShortFlags[i] + ", --" + this.argLongFlags[i]);
      }
    } else {
      if (!this.argIsFlag[i] && this.argDefaultValue[i].length > 0) {
        console.log("  --" + this.argLongFlags[i] + " (default: " + this.argDefaultValue[i] + ")");
      } else {
        console.log("  --" + this.argLongFlags[i]);
      }
    }
    console.log("      " + this.argHelp[i]);
  }

  // Public API
  getSubcommand(): string {
    return this.parsedSubcommand;
  }

  getRestArgs(): string[] {
    return this.restArgs;
  }

  getFlag(name: string): boolean {
    let i = 0;
    while (i < this.parsedFlagNames.length) {
      // Check length > 0 to avoid strcmp on NULL/empty strings
      if (this.parsedFlagNames[i].length > 0 && this.parsedFlagNames[i] === name) {
        return this.parsedFlagValues[i];
      }
      i = i + 1;
    }
    return false;
  }

  getOption(name: string): string {
    let i = 0;
    while (i < this.parsedOptionNames.length) {
      // Check length > 0 to avoid strcmp on NULL/empty strings and only compare if valid
      if (this.parsedOptionNames[i].length > 0 && this.parsedOptionNames[i] === name) {
        // Return the value, checking if it's empty first
        if (this.parsedOptionValues[i].length === 0) {
          return "";
        }
        return this.parsedOptionValues[i];
      }
      i = i + 1;
    }
    return "";
  }

  getPositional(index: number): string {
    if (index < this.parsedPositionals.length) {
      // Return empty string if value is NULL/empty to avoid crashes
      if (this.parsedPositionals[index].length === 0) {
        return "";
      }
      return this.parsedPositionals[index];
    }
    return "";
  }
}
