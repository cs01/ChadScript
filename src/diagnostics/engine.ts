import { SourceLocation } from "../ast/types.js";

export const DIAG_ERROR = 0;
export const DIAG_WARNING = 1;
export const DIAG_NOTE = 2;

const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BLUE = "\x1b[34m";
const RESET = "\x1b[0m";

export interface Diagnostic {
  severity: number;
  message: string;
  loc?: SourceLocation;
  suggestion?: string;
  notes?: string[];
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
    this.diagnostics.push({ severity: DIAG_ERROR, message, loc, suggestion });
  }

  warning(message: string, loc?: SourceLocation, suggestion?: string): void {
    this.diagnostics.push({ severity: DIAG_WARNING, message, loc, suggestion });
  }

  note(message: string, loc?: SourceLocation, suggestion?: string): void {
    this.diagnostics.push({ severity: DIAG_NOTE, message, loc, suggestion });
  }

  hasErrors(): boolean {
    for (let i = 0; i < this.diagnostics.length; i++) {
      if (this.diagnostics[i].severity === DIAG_ERROR) return true;
    }
    return false;
  }

  hasWarnings(): boolean {
    for (let i = 0; i < this.diagnostics.length; i++) {
      if (this.diagnostics[i].severity === DIAG_WARNING) return true;
    }
    return false;
  }

  getDiagnostics(): Diagnostic[] {
    return this.diagnostics;
  }

  getErrors(): Diagnostic[] {
    const result: Diagnostic[] = [];
    for (let i = 0; i < this.diagnostics.length; i++) {
      if (this.diagnostics[i].severity === DIAG_ERROR) result.push(this.diagnostics[i]);
    }
    return result;
  }

  getWarnings(): Diagnostic[] {
    const result: Diagnostic[] = [];
    for (let i = 0; i < this.diagnostics.length; i++) {
      if (this.diagnostics[i].severity === DIAG_WARNING) result.push(this.diagnostics[i]);
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

  private blue(text: string): string {
    if (!this.colorEnabled) return text;
    return BLUE + text + RESET;
  }

  private red(text: string): string {
    if (!this.colorEnabled) return text;
    return RED + text + RESET;
  }

  private redBold(text: string): string {
    if (!this.colorEnabled) return text;
    return BOLD + RED + text + RESET;
  }

  private yellowBold(text: string): string {
    if (!this.colorEnabled) return text;
    return BOLD + YELLOW + text + RESET;
  }

  private cyanBold(text: string): string {
    if (!this.colorEnabled) return text;
    return BOLD + CYAN + text + RESET;
  }

  private applyUnderlineColor(severity: number, text: string): string {
    if (severity === DIAG_ERROR) return this.redBold(text);
    if (severity === DIAG_WARNING) return this.yellowBold(text);
    return this.cyanBold(text);
  }

  private guessTokenLength(line: string, col: number): number {
    if (col >= line.length) return 1;
    const ch = line[col];
    if (/[a-zA-Z_$]/.test(ch)) {
      let end = col + 1;
      while (end < line.length && /[a-zA-Z0-9_$]/.test(line[end])) end++;
      return end - col;
    }
    if (/[0-9]/.test(ch)) {
      let end = col + 1;
      while (end < line.length && /[0-9.]/.test(line[end])) end++;
      return end - col;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      let end = col + 1;
      while (end < line.length && line[end] !== ch) end++;
      return end - col + 1;
    }
    return 1;
  }

  formatDiagnostic(diag: Diagnostic): string {
    let output = "";
    const label = this.coloredSeverity(diag.severity);

    output += label + this.bold(": " + diag.message) + "\n";

    if (diag.loc) {
      const lineNum = diag.loc.line;
      const col = diag.loc.column;
      const displayFile = diag.loc.file || this.filename;

      const lineNumStr = String(lineNum);
      const lineNumWidth = lineNumStr.length < 2 ? 2 : lineNumStr.length;
      const pad = " ".repeat(lineNumWidth);

      output += pad + " " + this.blue("-->") + " " + displayFile + ":" + lineNum + ":" + col + "\n";

      if (this.sourceCode) {
        const allLines = this.sourceCode.split("\n");
        const lineContent = allLines[lineNum - 1];

        if (lineContent !== undefined) {
          const tokenLen = this.guessTokenLength(lineContent, col - 1);
          const underline = "^" + "~".repeat(tokenLen > 1 ? tokenLen - 1 : 0);

          output += pad + " " + this.blue("|") + "\n";
          output += this.blue(lineNumStr.padStart(lineNumWidth) + " |") + " " + lineContent + "\n";
          output +=
            pad +
            " " +
            this.blue("|") +
            " " +
            " ".repeat(col - 1) +
            this.applyUnderlineColor(diag.severity, underline) +
            "\n";
        }
      } else {
        output += pad + " " + this.blue("|") + "\n";
      }

      if (diag.suggestion) {
        output += pad + " " + this.blue("|") + "\n";
        output +=
          pad + " " + this.blue("=") + " " + this.bold("help:") + " " + diag.suggestion + "\n";
      }
      if (diag.notes) {
        for (let i = 0; i < diag.notes.length; i++) {
          output +=
            pad + " " + this.blue("=") + " " + this.bold("note:") + " " + diag.notes[i] + "\n";
        }
      }
    } else {
      if (diag.suggestion) {
        output += "  " + this.blue("=") + " " + this.bold("help:") + " " + diag.suggestion + "\n";
      }
      if (diag.notes) {
        for (let i = 0; i < diag.notes.length; i++) {
          output += "  " + this.blue("=") + " " + this.bold("note:") + " " + diag.notes[i] + "\n";
        }
      }
    }

    output += "\n";
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

let globalColorEnabled = false;

export function setGlobalDiagnosticColor(enabled: boolean): void {
  globalColorEnabled = enabled;
}

export const INTERPRET_PRAGMA_HINT =
  "If this file needs full JS semantics, add '// @chadscript: interpret' to the top to run it under V8 (slower, full JS).";

export function formatCompileError(
  sourceCode: string,
  message: string,
  loc?: SourceLocation,
  suggestion?: string,
  notes?: string[],
  color?: boolean,
): string {
  const engine = new DiagnosticEngine();
  engine.setSourceCode(sourceCode);
  engine.setColor(color !== undefined ? color : globalColorEnabled);
  engine.error(message, loc, suggestion);
  const diag = engine.getErrors()[0];
  if (notes) diag.notes = notes;
  return engine.formatDiagnostic(diag);
}
