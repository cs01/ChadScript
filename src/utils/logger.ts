export const LogLevel_Silent = 0;
export const LogLevel_Normal = 1;
export const LogLevel_Verbose = 2;
export const LogLevel_Debug = 3;
export const LogLevel_Trace = 4;
export type LogLevel = number;

export class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = LogLevel_Normal) {
    this.level = level;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  error(message: string): void {
    console.error(message);
  }

  warn(message: string): void {
    if (this.level >= LogLevel_Normal) {
      console.warn(message);
    }
  }

  info(message: string): void {
    if (this.level >= LogLevel_Verbose) {
      console.log(message);
    }
  }

  debug(message: string): void {
    if (this.level >= LogLevel_Debug) {
      console.log(`dbg: ${message}`);
    }
  }

  trace(message: string): void {
    if (this.level >= LogLevel_Trace) {
      console.log(`trc: ${message}`);
    }
  }
}

export const logger = new Logger();
