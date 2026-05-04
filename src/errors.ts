import type { Span } from "@swc/core";

let currentSource: string | undefined;
let currentFile: string | undefined;

export function setSourceContext(source: string, file?: string): void {
  currentSource = source;
  currentFile = file;
}

function offsetToLineCol(source: string, offset: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

export class CompileError {
  message: string;
  span: Span | undefined;
  file: string | undefined;
  source: string | undefined;

  constructor(
    message: string,
    span?: Span,
    file?: string,
    source?: string,
  ) {
    this.message = message;
    this.span = span;
    this.file = file;
    this.source = source;
  }

  format(): string {
    let loc = "";
    if (this.span && this.source) {
      const { line, col } = offsetToLineCol(this.source, this.span.start);
      loc = `:${line}:${col}`;
    }
    const file = this.file || "";
    return `error: ${file}${loc}: ${this.message}`;
  }
}

export function compileError(message: string, span?: Span): never {
  throw new CompileError(message, span, currentFile, currentSource).format();
}
