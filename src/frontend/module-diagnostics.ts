// tsc diagnostics that are really module-FORM rejections. tsc is right to reject these programs,
// but its message points at the wrong fix ("install @types/node", "add a .d.ts"): following it
// would get the program past tsc and then into constructs we still cannot compile. These are
// re-coded as CS1226 with the rewrite that actually works. Everything else stays CS0001.

import ts from "typescript";
import type { Diagnostic, Span } from "../diagnostics.js";
import { CODE } from "../validate/codes.js";

const ESM_REWRITE =
  'use ES module syntax: `import { x } from "./m"` to import, `export function f() {}` or ' +
  "`export default ...` to export";

// TS2580 / TS2591: "Cannot find name 'require'. Do you need to install type definitions for node?"
const CANNOT_FIND_NODE_NAME = new Set([2580, 2591]);
const COMMONJS_NAMES = new Set(["require", "module", "exports"]);
const IMPORT_ASSIGNMENT = 1202; // `import x = require("m")`
const EXPORT_ASSIGNMENT = 1203; // `export = x`
const UNTYPED_MODULE = 7016; // a module that resolves to JavaScript with no declarations

export function moduleFormDiagnostic(d: ts.Diagnostic, span: Span | null): Diagnostic | null {
  const text =
    d.file && d.start !== undefined && d.length !== undefined
      ? d.file.text.slice(d.start, d.start + d.length)
      : "";
  if (CANNOT_FIND_NODE_NAME.has(d.code) && COMMONJS_NAMES.has(text)) {
    return {
      code: CODE.MODULE_FORM,
      message: `CommonJS \`${text}\` is not supported`,
      span,
      suggestion: ESM_REWRITE,
    };
  }
  if (d.code === IMPORT_ASSIGNMENT || d.code === EXPORT_ASSIGNMENT) {
    return {
      code: CODE.MODULE_FORM,
      message: "`import x = require(...)` / `export =` (CommonJS forms) are not supported",
      span,
      suggestion: ESM_REWRITE,
    };
  }
  if (d.code === UNTYPED_MODULE) {
    return {
      code: CODE.MODULE_FORM,
      message: `module ${text} has no TypeScript source (it resolves to JavaScript only)`,
      span,
      suggestion: PACKAGE_WITHOUT_SOURCE_HINT,
    };
  }
  return null;
}

export const PACKAGE_WITHOUT_SOURCE_HINT =
  "ChadScript compiles a package only from its TypeScript source; this one ships JavaScript, " +
  "so run the program on Node instead, or vendor the package's .ts source into the project";
