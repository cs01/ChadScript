import { SourceLocation } from '../ast/types.js';

export const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Note: 2
} as const;

export interface Diagnostic {
  severity: number;
  message: string;
  loc?: SourceLocation;
  suggestion?: string;
}

export class DiagnosticEngine {
  private diagnostics: Diagnostic[] = [];
  private sourceCode: string = '';
  private filename: string = '<input>';

  setSourceCode(code: string): void {
    this.sourceCode = code;
  }

  setFilename(name: string): void {
    this.filename = name;
  }

  error(message: string, loc?: SourceLocation, suggestion?: string): void {
    this.diagnostics.push({
      severity: DiagnosticSeverity.Error,
      message,
      loc,
      suggestion
    });
  }

  warning(message: string, loc?: SourceLocation, suggestion?: string): void {
    this.diagnostics.push({
      severity: DiagnosticSeverity.Warning,
      message,
      loc,
      suggestion
    });
  }

  note(message: string, loc?: SourceLocation, suggestion?: string): void {
    this.diagnostics.push({
      severity: DiagnosticSeverity.Note,
      message,
      loc,
      suggestion
    });
  }

  hasErrors(): boolean {
    for (let i = 0; i < this.diagnostics.length; i++) {
      if (this.diagnostics[i].severity === DiagnosticSeverity.Error) {
        return true;
      }
    }
    return false;
  }

  hasWarnings(): boolean {
    for (let i = 0; i < this.diagnostics.length; i++) {
      if (this.diagnostics[i].severity === DiagnosticSeverity.Warning) {
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
      if (this.diagnostics[i].severity === DiagnosticSeverity.Error) {
        result.push(this.diagnostics[i]);
      }
    }
    return result;
  }

  getWarnings(): Diagnostic[] {
    const result: Diagnostic[] = [];
    for (let i = 0; i < this.diagnostics.length; i++) {
      if (this.diagnostics[i].severity === DiagnosticSeverity.Warning) {
        result.push(this.diagnostics[i]);
      }
    }
    return result;
  }

  clear(): void {
    this.diagnostics = [];
  }

  private severityLabel(severity: number): string {
    if (severity === DiagnosticSeverity.Error) return 'error';
    if (severity === DiagnosticSeverity.Warning) return 'warning';
    return 'note';
  }

  formatDiagnostic(diag: Diagnostic): string {
    let output = '';
    const label = this.severityLabel(diag.severity);

    if (diag.loc && this.sourceCode) {
      const lineNum = diag.loc.line;
      const col = diag.loc.column;
      const allLines = this.sourceCode.split('\n');

      const lineNumStr = String(lineNum);
      const lineNumWidth = lineNumStr.length > 2 ? lineNumStr.length : 2;

      output += this.filename + ':' + lineNum + ':' + (col + 1) + ': ' + label + ': ' + diag.message + '\n';
      output += ' '.repeat(lineNumWidth) + ' |' + '\n';

      const lineContent = allLines[lineNum - 1] || '';
      output += lineNumStr.padStart(lineNumWidth) + ' | ' + lineContent + '\n';
      output += ' '.repeat(lineNumWidth) + ' | ' + ' '.repeat(col) + '^' + '\n';

      if (diag.suggestion) {
        output += ' '.repeat(lineNumWidth) + ' |' + '\n';
        output += ' '.repeat(lineNumWidth) + ' = help: ' + diag.suggestion + '\n';
      }
    } else if (diag.loc) {
      output += this.filename + ':' + diag.loc.line + ':' + (diag.loc.column + 1) + ': ' + label + ': ' + diag.message + '\n';
      if (diag.suggestion) {
        output += '  help: ' + diag.suggestion + '\n';
      }
    } else {
      output += label + ': ' + diag.message + '\n';
      if (diag.suggestion) {
        output += '  help: ' + diag.suggestion + '\n';
      }
    }

    return output;
  }

  format(): string {
    let output = '';
    for (let i = 0; i < this.diagnostics.length; i++) {
      output += this.formatDiagnostic(this.diagnostics[i]);
    }
    return output;
  }
}
