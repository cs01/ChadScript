import * as ts from "typescript";
import { AST } from "../ast/types.js";
import { transformSourceFile } from "./transformer.js";

interface ParseOptions {
  filename?: string;
}

export function parseWithTSAPI(code: string, options: ParseOptions = {}): AST {
  const filename = options.filename || "input.ts";

  // Use TSX mode for .tsx files so <Tag> is parsed as JSX, not a type assertion
  const scriptKind = filename.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

  const sourceFile = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, scriptKind);

  return transformSourceFile(sourceFile, undefined);
}
