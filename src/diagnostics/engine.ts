import { SourceLocation } from "../ast/types.js";

export const DIAG_ERROR = 0;
export const DIAG_WARNING = 1;
export const DIAG_NOTE = 2;

const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

export interface Diagnostic {
  severity: number;
  message: string;
  loc?: SourceLocation;
  suggestion?: string;
}

export class DiagnosticEngine {
  private diagnostics: Diagnostic[] = [];
  private sourceCode: string = "";
  private filename: string = "<input>";
  private colorEnabled: boolean = false;

  setSourceCode(code: string): void {
    this.sourceCode = code;
  }

  setFilename(name: string): void {
    this.filename = name;
  }

  setColor(enabled: boolean): void {
    this.colorEnabled = enabled;
  }

  error(message: string, loc?: SourceLocation, suggestion?: string): void {
    this.diagnostics.push({
      severity: DIAG_ERROR,
      message,
      loc,
      suggestion,
    });
  }

  warning(message: string, loc?: SourceLocation, suggestion?: string): void {
    this.diagnostics.push({
      severity: DIAG_WARNING,
      message,
      loc,
      suggestion,
    });
  }

  note(message: string, loc?: SourceLocation, suggestion?: string): void {
    this.diagnostics.push({
      severity: DIAG_NOTE,
      message,
      loc,
      suggestion,
    });
  }

  hasErrors(): boolean {
    for (let i = 0; i < this.diagnostics.length; i++) {
      if (this.diagnostics[i].severity === DIAG_ERROR) {
        return true;
      }
    }
    return false;
  }

  hasWarnings(): boolean {
    for (let i = 0; i < this.diagnostics.length; i++) {
      if (this.diagnostics[i].severity === DIAG_WARNING) {
        return true;
      }
    }
    return false;
  }

  getDiagnostics(): Diagnostic[] {
    return this.diagnostics;
  }

  getErrors(): Diagnostic[] {
    const result: Diagnostic[] = [];
    for (let i = 0; i < this.diagnostics.length; i++) {
      if (this.diagnostics[i].severity === DIAG_ERROR) {
        result.push(this.diagnostics[i]);
      }
    }
    return result;
  }

  getWarnings(): Diagnostic[] {
    const result: Diagnostic[] = [];
    for (let i = 0; i < this.diagnostics.length; i++) {
      if (this.diagnostics[i].severity === DIAG_WARNING) {
        result.push(this.diagnostics[i]);
      }
    }
    return result;
  }

  clear(): void {
    this.diagnostics = [];
  }

  private severityLabel(severity: number): string {
    if (severity === DIAG_ERROR) return "error";
    if (severity === DIAG_WARNING) return "warning";
    return "note";
  }

  private coloredSeverity(severity: number): string {
    const label = this.severityLabel(severity);
    if (!this.colorEnabled) return label;
    if (severity === DIAG_ERROR) return BOLD + RED + label + RESET;
    if (severity === DIAG_WARNING) return BOLD + YELLOW + label + RESET;
    return BOLD + CYAN + label + RESET;
  }

  private bold(text: string): string {
    if (!this.colorEnabled) return text;
    return BOLD + text + RESET;
  }

  private green(text: string): string {
    if (!this.colorEnabled) return text;
    return GREEN + text + RESET;
  }

  formatDiagnostic(diag: Diagnostic): string {
    let output = "";
    const label = this.coloredSeverity(diag.severity);

    if (diag.loc && this.sourceCode) {
      const lineNum = diag.loc.line;
      const col = diag.loc.column;
      const displayFile = diag.loc.file || this.filename;
      const allLines = this.sourceCode.split("\n");

      const lineNumStr = String(lineNum);
      const lineNumWidth = lineNumStr.length > 2 ? lineNumStr.length : 2;

      output +=
        this.bold(displayFile + ":" + lineNum + ":" + (col + 1) + ":") +
        " " +
        label +
        ": " +
        this.bold(diag.message) +
        "\n";
      output += " ".repeat(lineNumWidth) + " |" + "\n";

      const lineContent = allLines[lineNum - 1] || "";
      output += lineNumStr.padStart(lineNumWidth) + " | " + lineContent + "\n";
      output += " ".repeat(lineNumWidth) + " | " + " ".repeat(col) + this.green("^") + "\n";

      if (diag.suggestion) {
        output += " ".repeat(lineNumWidth) + " |" + "\n";
        output +=
          " ".repeat(lineNumWidth) + " = " + this.bold("help:") + " " + diag.suggestion + "\n";
      }
    } else if (diag.loc) {
      const displayFile = diag.loc.file || this.filename;
      output +=
        this.bold(displayFile + ":" + diag.loc.line + ":" + (diag.loc.column + 1) + ":") +
        " " +
        label +
        ": " +
        this.bold(diag.message) +
        "\n";
      if (diag.suggestion) {
        output += "  " + this.bold("help:") + " " + diag.suggestion + "\n";
      }
    } else {
      output += label + ": " + this.bold(diag.message) + "\n";
      if (diag.suggestion) {
        output += "  " + this.bold("help:") + " " + diag.suggestion + "\n";
      }
    }

    return output;
  }

  format(): string {
    let output = "";
    for (let i = 0; i < this.diagnostics.length; i++) {
      output += this.formatDiagnostic(this.diagnostics[i]);
    }
    return output;
  }
}
