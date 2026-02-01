/**
 * Compiler Error System
 *
 * Provides standardized error handling across all compilation phases with:
 * - Consistent formatting (clang-style with ANSI colors)
 * - Source location tracking
 * - Helpful suggestions and context
 * - Support for both single and batch error reporting
 */

export enum ErrorType {
  Syntax = 'syntax',
  Semantic = 'semantic',
  Type = 'type',
  Codegen = 'codegen',
  Internal = 'internal'
}

export interface ErrorLocation {
  line: number;
  column: number;
  position: number;
}

export interface ErrorOptions {
  help?: string;
  note?: string;
  suggestion?: string;
  contextLines?: number;
}

/**
 * Represents a single compiler error with rich context and formatting.
 *
 * @example
 * const error = new CompilerError(
 *   ErrorType.Syntax,
 *   "Expected ';' after statement",
 *   code,
 *   position,
 *   'input.js',
 *   { suggestion: "Add ';' at the end of the line" }
 * );
 * console.error(error.format());
 */
export class CompilerError extends Error {
  public readonly type: ErrorType;
  public readonly sourceCode: string;
  public readonly filename: string;
  public readonly location: ErrorLocation;
  public readonly options: ErrorOptions;

  constructor(
    type: ErrorType,
    message: string,
    sourceCode: string,
    position: number,
    filename: string = '<input>',
    options: ErrorOptions = {}
  ) {
    super(message);
    this.name = 'CompilerError';
    this.type = type;
    this.sourceCode = sourceCode;
    this.filename = filename;
    this.options = options;
    this.location = this.calculateLocation(position);
  }

  /**
   * Calculate line and column from position in source code
   */
  private calculateLocation(position: number): ErrorLocation {
    const lines = this.sourceCode.substring(0, position).split('\n');
    const line = lines.length;
    const column = lines[lines.length - 1].length;
    return { line, column, position };
  }

  /**
   * Format error in clang-style with ANSI colors and context.
   *
   * @example Output:
   * input.js:5:12: syntax error: Expected ';' after statement
   *      |
   *    5 | const x = 5
   *      |            ^ here
   *      |
   * Fix: Add ';' at the end of the line
   */
  format(): string {
    const { line, column } = this.location;
    const allLines = this.sourceCode.split('\n');

    // Format like clang: filename:line:col: error: message
    const lineNumStr = String(line);
    const lineNumWidth = Math.max(2, lineNumStr.length);

    // Color codes
    const red = '\x1b[31m\x1b[1m';
    const cyan = '\x1b[36m\x1b[1m';
    const reset = '\x1b[0m';
    const dim = '\x1b[2m';

    // Error type label
    const errorLabel = this.type === ErrorType.Internal
      ? `${red}internal compiler error:${reset}`
      : `${red}${this.type} error:${reset}`;

    // First line: filename:line:col: error: message
    let output = `${this.filename}:${line}:${column + 1}: ${errorLabel} ${this.message}\n`;
    output += `${cyan}${' '.repeat(lineNumWidth)} |${reset}\n`;

    // Context lines
    const contextLines = this.options.contextLines || 1;
    const startLine = Math.max(1, line - contextLines);
    const endLine = Math.min(allLines.length, line + contextLines);

    for (let i = startLine; i <= endLine; i++) {
      const currentLineContent = allLines[i - 1] || '';
      const currentLineNumStr = String(i);
      output += `${cyan}${currentLineNumStr.padStart(lineNumWidth)} |${reset} ${currentLineContent}\n`;

      // Add caret on the error line
      if (i === line) {
        output += `${cyan}${' '.repeat(lineNumWidth)} |${reset} ${' '.repeat(column)}${red}^ here${reset}\n`;
      }
    }

    // Add suggestion
    if (this.options.suggestion) {
      output += `${cyan}${' '.repeat(lineNumWidth)} |${reset}\n`;
      output += `${cyan}Fix:${reset} ${this.options.suggestion}\n`;
    }

    // Add help
    if (this.options.help) {
      output += `${cyan}Help:${reset} ${this.options.help}\n`;
    }

    // Add note
    if (this.options.note) {
      output += `${cyan}Note:${reset} ${this.options.note}\n`;
    }

    return output;
  }

  /**
   * Format error without ANSI colors for logs or non-terminal output
   */
  formatPlain(): string {
    const { line, column } = this.location;
    let output = `${this.filename}:${line}:${column + 1}: ${this.type} error: ${this.message}\n`;

    if (this.options.suggestion) {
      output += `  Fix: ${this.options.suggestion}\n`;
    }
    if (this.options.help) {
      output += `  Help: ${this.options.help}\n`;
    }
    if (this.options.note) {
      output += `  Note: ${this.options.note}\n`;
    }

    return output;
  }
}

/**
 * Collection of compiler errors for batch reporting.
 * Used by semantic analyzer and type checker to collect multiple errors.
 *
 * @example
 * const errors = new CompilerErrors();
 * errors.add(ErrorType.Semantic, "Undefined variable 'x'", code, pos, 'input.js');
 * errors.add(ErrorType.Type, "Type mismatch", code, pos2, 'input.js');
 * if (errors.hasErrors()) {
 *   console.error(errors.format());
 *   process.exit(1);
 * }
 */
export class CompilerErrors {
  private errors: CompilerError[] = [];

  /**
   * Add an error to the collection
   */
  add(
    type: ErrorType,
    message: string,
    sourceCode: string,
    position: number,
    filename: string = '<input>',
    options: ErrorOptions = {}
  ): void {
    this.errors.push(new CompilerError(type, message, sourceCode, position, filename, options));
  }

  /**
   * Add an existing CompilerError
   */
  addError(error: CompilerError): void {
    this.errors.push(error);
  }

  /**
   * Check if any errors exist
   */
  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  /**
   * Get error count
   */
  count(): number {
    return this.errors.length;
  }

  /**
   * Get all errors
   */
  getErrors(): CompilerError[] {
    return this.errors.slice();
  }

  /**
   * Clear all errors
   */
  clear(): void {
    this.errors = [];
  }

  /**
   * Format all errors for display.
   * Groups errors by type and shows summary.
   *
   * @example Output:
   * ✗ Compilation failed with 3 errors:
   *
   * input.js:5:12: syntax error: Expected ';'
   *   ...
   * input.js:10:5: type error: Type mismatch
   *   ...
   */
  format(): string {
    if (this.errors.length === 0) {
      return '';
    }

    const red = '\x1b[31m\x1b[1m';
    const reset = '\x1b[0m';

    let output = `${red}✗ Compilation failed with ${this.errors.length} error${this.errors.length > 1 ? 's' : ''}:${reset}\n\n`;

    // Sort errors by location
    const sorted = this.errors.slice().sort((a, b) => {
      if (a.filename !== b.filename) {
        return a.filename.localeCompare(b.filename);
      }
      return a.location.position - b.location.position;
    });

    // Format each error
    for (const error of sorted) {
      output += error.format();
      output += '\n';
    }

    return output;
  }

  /**
   * Format all errors without ANSI colors
   */
  formatPlain(): string {
    if (this.errors.length === 0) {
      return '';
    }

    let output = `Compilation failed with ${this.errors.length} error${this.errors.length > 1 ? 's' : ''}:\n\n`;

    for (const error of this.errors) {
      output += error.formatPlain();
      output += '\n';
    }

    return output;
  }
}

/**
 * Helper functions for common error scenarios
 */

/**
 * Create a syntax error with helpful suggestions
 */
export function syntaxError(
  message: string,
  sourceCode: string,
  position: number,
  filename?: string,
  options?: ErrorOptions
): CompilerError {
  return new CompilerError(ErrorType.Syntax, message, sourceCode, position, filename, options);
}

/**
 * Create a semantic error (undefined variables, etc.)
 */
export function semanticError(
  message: string,
  sourceCode: string,
  position: number,
  filename?: string,
  options?: ErrorOptions
): CompilerError {
  return new CompilerError(ErrorType.Semantic, message, sourceCode, position, filename, options);
}

/**
 * Create a type error (type mismatches, etc.)
 */
export function typeError(
  message: string,
  sourceCode: string,
  position: number,
  filename?: string,
  options?: ErrorOptions
): CompilerError {
  return new CompilerError(ErrorType.Type, message, sourceCode, position, filename, options);
}

/**
 * Create a codegen error (LLVM IR generation issues)
 */
export function codegenError(
  message: string,
  sourceCode: string,
  position: number,
  filename?: string,
  options?: ErrorOptions
): CompilerError {
  return new CompilerError(ErrorType.Codegen, message, sourceCode, position, filename, options);
}

/**
 * Create an internal compiler error (shouldn't happen in production)
 */
export function internalError(
  message: string,
  sourceCode: string,
  position: number,
  filename?: string,
  options?: ErrorOptions
): CompilerError {
  options = {
    ...options,
    note: 'This is a bug in the compiler. Please report it at https://github.com/cssmith/ChadScript/issues'
  };
  return new CompilerError(ErrorType.Internal, message, sourceCode, position, filename, options);
}
