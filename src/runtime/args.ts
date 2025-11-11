// CLI Argument Parser for ChadScript
// Provides argparse-style functionality for building robust CLI tools

export interface ArgConfig {
  name: string;
  shortFlag?: string;      // e.g., '-v'
  longFlag?: string;       // e.g., '--verbose'
  description?: string;
  required?: boolean;
  defaultValue?: string;
  type?: 'string' | 'number' | 'boolean';
}

export interface ParsedArgs {
  [key: string]: string | number | boolean | undefined;
}

export class ArgumentParser {
  private programName: string;
  private description: string;
  private args: ArgConfig[];

  constructor(programName: string, description: string = '') {
    this.programName = programName;
    this.description = description;
    this.args = [];
  }

  addArgument(config: ArgConfig): void {
    this.args.push(config);
  }

  parse(argv: string[]): ParsedArgs {
    const result: ParsedArgs = {};
    let i = 0;

    // Process each arg in argv
    while (i < argv.length) {
      const arg = argv[i];

      // Check if it's a flag
      if (arg.startsWith('-')) {
        const argConfig = this.findArgByFlag(arg);

        if (!argConfig) {
          console.log(`Unknown option: ${arg}`);
          console.log(`Try '${this.programName} --help' for more information.`);
          process.exit(1);
        }

        // Boolean flags don't need values
        if (argConfig.type === 'boolean') {
          result[argConfig.name] = true;
          i++;
          continue;
        }

        // Get the value
        i++;
        if (i >= argv.length) {
          console.log(`Option ${arg} requires a value`);
          process.exit(1);
        }

        const value = argv[i];

        // Type conversion
        if (argConfig.type === 'number') {
          const num = parseInt(value, 10);
          if (isNaN(num)) {
            console.log(`Option ${arg} requires a number, got: ${value}`);
            process.exit(1);
          }
          result[argConfig.name] = num;
        } else {
          result[argConfig.name] = value;
        }

        i++;
      } else {
        // Positional argument
        const positional = this.findPositionalArg();
        if (positional) {
          result[positional.name] = arg;
        }
        i++;
      }
    }

    // Check required args
    for (const argConfig of this.args) {
      if (argConfig.required && result[argConfig.name] === undefined) {
        console.log(`Missing required argument: ${argConfig.name}`);
        this.printHelp();
        process.exit(1);
      }

      // Set defaults
      if (result[argConfig.name] === undefined && argConfig.defaultValue !== undefined) {
        result[argConfig.name] = argConfig.defaultValue;
      }
    }

    return result;
  }

  private findArgByFlag(flag: string): ArgConfig | null {
    for (const arg of this.args) {
      if (arg.shortFlag === flag || arg.longFlag === flag) {
        return arg;
      }
    }
    return null;
  }

  private findPositionalArg(): ArgConfig | null {
    for (const arg of this.args) {
      if (!arg.shortFlag && !arg.longFlag) {
        return arg;
      }
    }
    return null;
  }

  printHelp(): void {
    console.log(`${this.programName}`);
    if (this.description) {
      console.log(`  ${this.description}`);
    }
    console.log('');
    console.log('Usage:');

    // Build usage line
    let usage = `  ${this.programName}`;
    for (const arg of this.args) {
      if (arg.shortFlag || arg.longFlag) {
        const flag = arg.shortFlag || arg.longFlag;
        if (arg.type === 'boolean') {
          usage += ` [${flag}]`;
        } else {
          usage += ` [${flag} <${arg.name}>]`;
        }
      } else {
        usage += ` <${arg.name}>`;
      }
    }
    console.log(usage);
    console.log('');

    // Print arguments
    if (this.args.length > 0) {
      console.log('Arguments:');
      for (const arg of this.args) {
        let line = '  ';
        if (arg.shortFlag && arg.longFlag) {
          line += `${arg.shortFlag}, ${arg.longFlag}`;
        } else if (arg.shortFlag) {
          line += arg.shortFlag;
        } else if (arg.longFlag) {
          line += arg.longFlag;
        } else {
          line += `<${arg.name}>`;
        }

        if (arg.description) {
          line += `\t${arg.description}`;
        }

        if (arg.required) {
          line += ' (required)';
        }

        if (arg.defaultValue !== undefined) {
          line += ` (default: ${arg.defaultValue})`;
        }

        console.log(line);
      }
    }
  }
}
