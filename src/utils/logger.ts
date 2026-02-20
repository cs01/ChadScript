// ============================================
// LOGGING SYSTEM
// ============================================
// Inspired by clang's verbose output system.
// Use --verbose, --debug, or --trace flags to control output.

export enum LogLevel {
  Silent = 0, // Only errors (for user-facing errors)
  Normal = 1, // Errors + warnings (default)
  Verbose = 2, // + Compilation stages and commands
  Debug = 3, // + Internal debugging info
  Trace = 4, // + Everything (AST dumps, IR, etc.)
}

export class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = LogLevel.Normal) {
    this.level = level;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  // Always shown (user-facing errors)
  error(message: string): void {
    console.error(message);
  }

  // Show at Normal level and above (warnings)
  warn(message: string): void {
    if (this.level >= LogLevel.Normal) {
      console.warn(message);
    }
  }

  // Show at Verbose level and above (compilation steps)
  info(message: string): void {
    if (this.level >= LogLevel.Verbose) {
      console.log(message);
    }
  }

  // Show at Debug level and above (internal debugging)
  debug(message: string): void {
    if (this.level >= LogLevel.Debug) {
      console.log(`dbg: ${message}`);
    }
  }

  // Show at Trace level only (everything)
  trace(message: string): void {
    if (this.level >= LogLevel.Trace) {
      console.log(`trc: ${message}`);
    }
  }
}

// Global logger instance
export const logger = new Logger();
