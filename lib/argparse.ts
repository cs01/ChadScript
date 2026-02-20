// ChadScript-native ArgumentParser
// Simplified argparse-style CLI argument parsing for native binaries

interface ArgDef {
  name: string;
  shortFlag: string;
  longFlag: string;
  help: string;
  isFlag: boolean;
  defaultValue: string;
  isPositional: boolean;
  subcommands: string;
}

interface SubcommandDef {
  name: string;
  description: string;
}

interface ParsedFlag {
  name: string;
  value: boolean;
}

interface ParsedOption {
  name: string;
  value: string;
}

export class ArgumentParser {
  programName: string;
  description: string;

  args: ArgDef[];
  subcommands: SubcommandDef[];
  parsedSubcommand: string;

  // Rest args (after --)
  restArgs: string[];

  parsedPositionals: string[];
  parsedFlags: ParsedFlag[];
  parsedOptions: ParsedOption[];

  constructor(name: string, desc: string) {
    this.programName = name;
    this.description = desc;
    this.args = [];
    this.subcommands = [];
    this.parsedSubcommand = "";
    this.restArgs = [];
    this.parsedPositionals = [];
    this.parsedFlags = [];
    this.parsedOptions = [];
  }

  addSubcommand(name: string, desc: string): void {
    this.subcommands.push({ name: name, description: desc });
  }

  // Add a boolean flag (e.g., -v, --verbose)
  addFlag(name: string, shortFlag: string, help: string): void {
    this.args.push({ name: name, shortFlag: shortFlag, longFlag: name, help: help, isFlag: true, defaultValue: "", isPositional: false, subcommands: "" });
  }

  addScopedFlag(name: string, shortFlag: string, help: string, subcommands: string): void {
    this.args.push({ name: name, shortFlag: shortFlag, longFlag: name, help: help, isFlag: true, defaultValue: "", isPositional: false, subcommands: subcommands });
  }

  // Add an option that takes a value (e.g., -o file.txt, --output file.txt)
  addOption(name: string, shortFlag: string, help: string, defaultVal: string): void {
    this.args.push({ name: name, shortFlag: shortFlag, longFlag: name, help: help, isFlag: false, defaultValue: defaultVal, isPositional: false, subcommands: "" });
  }

  addScopedOption(name: string, shortFlag: string, help: string, defaultVal: string, subcommands: string): void {
    this.args.push({ name: name, shortFlag: shortFlag, longFlag: name, help: help, isFlag: false, defaultValue: defaultVal, isPositional: false, subcommands: subcommands });
  }

  // Add a positional argument (e.g., filename)
  addPositional(name: string, help: string): void {
    this.args.push({ name: name, shortFlag: "", longFlag: "", help: help, isFlag: false, defaultValue: "", isPositional: true, subcommands: "" });
  }

  isArgInScope(argIndex: number, subcommand: string): boolean {
    if (this.args[argIndex].subcommands.length === 0) {
      return true;
    }
    if (subcommand.length === 0) {
      return false;
    }
    const scopes = this.args[argIndex].subcommands;
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
    while (i < this.subcommands.length) {
      if (this.subcommands[i].name.length > 0 && this.subcommands[i].name === name) {
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
    let flagIdx = 0;
    while (flagIdx < this.parsedFlags.length) {
      if (this.parsedFlags[flagIdx].name.length > 0 && this.args[argIndex].name.length > 0 &&
          this.parsedFlags[flagIdx].name === this.args[argIndex].name) {
        this.parsedFlags[flagIdx].value = true;
      }
      flagIdx = flagIdx + 1;
    }
  }

  setOptionValue(argIndex: number, value: string): void {
    let optIdx = 0;
    while (optIdx < this.parsedOptions.length) {
      if (this.parsedOptions[optIdx].name.length > 0 && this.args[argIndex].name.length > 0 &&
          this.parsedOptions[optIdx].name === this.args[argIndex].name) {
        this.parsedOptions[optIdx].value = value;
      }
      optIdx = optIdx + 1;
    }
  }

  initDefaults(): void {
    this.parsedPositionals = [];
    this.parsedFlags = [];
    this.parsedOptions = [];
    this.parsedSubcommand = "";
    this.restArgs = [];

    let i = 0;
    while (i < this.args.length) {
      if (this.args[i].name.length > 0) {
        if (this.args[i].isFlag) {
          this.parsedFlags.push({ name: this.args[i].name, value: false });
        } else if (!this.args[i].isPositional) {
          if (this.args[i].defaultValue.length > 0) {
            this.parsedOptions.push({ name: this.args[i].name, value: this.args[i].defaultValue });
          } else {
            this.parsedOptions.push({ name: this.args[i].name, value: "" });
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

    if (this.args[argIndex].isFlag) {
      this.setFlagValue(argIndex);
      return argIdx + 1;
    } else {
      if (gotEquals) {
        this.setOptionValue(argIndex, valuePart);
        return argIdx + 1;
      } else {
        const nextIdx = argIdx + 1;
        if (nextIdx >= argv.length) {
          console.error("Error: Option --" + this.args[argIndex].name + " requires a value");
          process.exit(1);
        }
        this.setOptionValue(argIndex, argv[nextIdx]);
        return nextIdx + 1;
      }
    }
  }

  parse(argv: string[]): number {
    this.initDefaults();

    if (this.subcommands.length === 0) {
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
    while (i < this.args.length) {
      // Check length > 0 to avoid strcmp on NULL/empty strings
      if ((this.args[i].shortFlag.length > 0 && this.args[i].shortFlag === cleanFlag) ||
          (this.args[i].longFlag.length > 0 && this.args[i].longFlag === cleanFlag)) {
        return i;
      }
      i = i + 1;
    }
    return -1;
  }

  printHelp(): void {
    if (this.subcommands.length > 0) {
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
    while (i < this.args.length) {
      if (!this.args[i].isPositional) {
        if (this.args[i].shortFlag.length > 0) {
          if (!this.args[i].isFlag) {
            usage = usage + " [-" + this.args[i].shortFlag + " <" + this.args[i].name + ">]";
          } else {
            usage = usage + " [-" + this.args[i].shortFlag + "]";
          }
        } else {
          if (!this.args[i].isFlag) {
            usage = usage + " [--" + this.args[i].longFlag + " <" + this.args[i].name + ">]";
          } else {
            usage = usage + " [--" + this.args[i].longFlag + "]";
          }
        }
      }
      i = i + 1;
    }

    i = 0;
    while (i < this.args.length) {
      if (this.args[i].isPositional) {
        usage = usage + " <" + this.args[i].name + ">";
      }
      i = i + 1;
    }

    console.log(usage);
    console.log("");

    // Print options
    console.log("Options:");
    i = 0;
    while (i < this.args.length) {
      if (!this.args[i].isPositional) {
        if (this.args[i].shortFlag.length > 0) {
          if (!this.args[i].isFlag && this.args[i].defaultValue.length > 0) {
            console.log("  -" + this.args[i].shortFlag + ", --" + this.args[i].longFlag + " (default: " + this.args[i].defaultValue + ")");
          } else {
            console.log("  -" + this.args[i].shortFlag + ", --" + this.args[i].longFlag);
          }
        } else {
          if (!this.args[i].isFlag && this.args[i].defaultValue.length > 0) {
            console.log("  --" + this.args[i].longFlag + " (default: " + this.args[i].defaultValue + ")");
          } else {
            console.log("  --" + this.args[i].longFlag);
          }
        }
        console.log("      " + this.args[i].help);
      }
      i = i + 1;
    }

    // Print positional arguments
    let hasPositionals = false;
    i = 0;
    while (i < this.args.length) {
      if (this.args[i].isPositional) {
        hasPositionals = true;
      }
      i = i + 1;
    }

    if (hasPositionals) {
      console.log("");
      console.log("Arguments:");
      i = 0;
      while (i < this.args.length) {
        if (this.args[i].isPositional) {
          console.log("  " + this.args[i].name);
          console.log("      " + this.args[i].help);
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
    while (i < this.subcommands.length) {
      let line = "  " + this.subcommands[i].name;
      let padLen = 16 - this.subcommands[i].name.length;
      if (padLen < 2) {
        padLen = 2;
      }
      let pad = 0;
      while (pad < padLen) {
        line = line + " ";
        pad = pad + 1;
      }
      line = line + this.subcommands[i].description;
      console.log(line);
      i = i + 1;
    }

    let hasGlobalArgs = false;
    i = 0;
    while (i < this.args.length) {
      if (!this.args[i].isPositional && this.args[i].subcommands.length === 0) {
        hasGlobalArgs = true;
      }
      i = i + 1;
    }

    if (hasGlobalArgs) {
      console.log("");
      console.log("Global options:");
      i = 0;
      while (i < this.args.length) {
        if (!this.args[i].isPositional && this.args[i].subcommands.length === 0) {
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
    while (i < this.subcommands.length) {
      if (this.subcommands[i].name === subcmd) {
        subcmdDesc = this.subcommands[i].description;
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
    while (i < this.args.length) {
      if (!this.args[i].isPositional && this.isArgInScope(i, subcmd)) {
        if (this.args[i].shortFlag.length > 0) {
          if (!this.args[i].isFlag) {
            usage = usage + " [-" + this.args[i].shortFlag + " <" + this.args[i].name + ">]";
          } else {
            usage = usage + " [-" + this.args[i].shortFlag + "]";
          }
        } else {
          if (!this.args[i].isFlag) {
            usage = usage + " [--" + this.args[i].longFlag + " <" + this.args[i].name + ">]";
          } else {
            usage = usage + " [--" + this.args[i].longFlag + "]";
          }
        }
      }
      i = i + 1;
    }
    i = 0;
    while (i < this.args.length) {
      if (this.args[i].isPositional) {
        usage = usage + " <" + this.args[i].name + ">";
      }
      i = i + 1;
    }
    console.log(usage);
    console.log("");

    let hasOptions = false;
    i = 0;
    while (i < this.args.length) {
      if (!this.args[i].isPositional && this.isArgInScope(i, subcmd)) {
        hasOptions = true;
      }
      i = i + 1;
    }

    if (hasOptions) {
      console.log("Options:");
      i = 0;
      while (i < this.args.length) {
        if (!this.args[i].isPositional && this.isArgInScope(i, subcmd)) {
          this.printArgLine(i);
        }
        i = i + 1;
      }
    }

    let hasPositionals = false;
    i = 0;
    while (i < this.args.length) {
      if (this.args[i].isPositional) {
        hasPositionals = true;
      }
      i = i + 1;
    }

    if (hasPositionals) {
      console.log("");
      console.log("Arguments:");
      i = 0;
      while (i < this.args.length) {
        if (this.args[i].isPositional) {
          console.log("  " + this.args[i].name);
          console.log("      " + this.args[i].help);
        }
        i = i + 1;
      }
    }

    console.log("");
    console.log("  -h, --help");
    console.log("      Show this help message and exit");
  }

  printArgLine(i: number): void {
    if (this.args[i].shortFlag.length > 0) {
      if (!this.args[i].isFlag && this.args[i].defaultValue.length > 0) {
        console.log("  -" + this.args[i].shortFlag + ", --" + this.args[i].longFlag + " (default: " + this.args[i].defaultValue + ")");
      } else {
        console.log("  -" + this.args[i].shortFlag + ", --" + this.args[i].longFlag);
      }
    } else {
      if (!this.args[i].isFlag && this.args[i].defaultValue.length > 0) {
        console.log("  --" + this.args[i].longFlag + " (default: " + this.args[i].defaultValue + ")");
      } else {
        console.log("  --" + this.args[i].longFlag);
      }
    }
    console.log("      " + this.args[i].help);
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
    while (i < this.parsedFlags.length) {
      // Check length > 0 to avoid strcmp on NULL/empty strings
      if (this.parsedFlags[i].name.length > 0 && this.parsedFlags[i].name === name) {
        return this.parsedFlags[i].value;
      }
      i = i + 1;
    }
    return false;
  }

  getOption(name: string): string {
    let i = 0;
    while (i < this.parsedOptions.length) {
      // Check length > 0 to avoid strcmp on NULL/empty strings and only compare if valid
      if (this.parsedOptions[i].name.length > 0 && this.parsedOptions[i].name === name) {
        // Return the value, checking if it's empty first
        if (this.parsedOptions[i].value.length === 0) {
          return "";
        }
        return this.parsedOptions[i].value;
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
