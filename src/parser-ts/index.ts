import * as ts from "typescript";
import { AST } from "../ast/types.js";
import { transformSourceFile } from "./transformer.js";

interface ParseOptions {
  filename?: string;
}

export function parseWithTSAPI(code: string, options: ParseOptions = {}): AST {
  const filename = options.filename || "input.ts";

  const sourceFile = ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  return transformSourceFile(sourceFile, undefined);
}
