// `node:fs/promises` lowering — the async mirror of node-fs.ts, with the same symbol-keyed
// dispatch (a user function named `readFile` stays a user function).
//
// Each entry's result type is `Promise<T>`, so `await` unwraps it through the ordinary async
// machinery; nothing here is special-cased in the await path.

import ts from "typescript";
import { ice } from "../diagnostics.js";
import type { HExpr } from "../hir/nodes.js";
import { VT } from "../hir/types.js";
import type { ValueType } from "../hir/types.js";
import { type LowerCtx, lowerExpr, symbolOf } from "./lower.js";

export const NODE_FS_PROMISES_MODULE = "node:fs/promises";

// The runtime entry and RESOLVED type per supported name (the promise wrapper is added below).
// This table and the ambient module declaration must list the same names.
export const FS_PROMISES_ENTRIES: Record<string, { entry: string; resolved: ValueType }> = {
  readFile: { entry: "cs_fsp_read_file", resolved: VT.string },
  writeFile: { entry: "cs_fsp_write_file", resolved: VT.undefined },
  appendFile: { entry: "cs_fsp_append_file", resolved: VT.undefined },
  unlink: { entry: "cs_fsp_unlink", resolved: VT.undefined },
};

function isNodeFsPromisesDeclaration(decl: ts.Declaration): boolean {
  for (let n: ts.Node | undefined = decl.parent; n; n = n.parent) {
    if (ts.isModuleDeclaration(n) && ts.isStringLiteral(n.name)) {
      return n.name.text === NODE_FS_PROMISES_MODULE;
    }
  }
  return false;
}

export function lowerNodeFsPromisesCall(call: ts.CallExpression, ctx: LowerCtx): HExpr | null {
  if (!ts.isIdentifier(call.expression)) return null;
  const decl = symbolOf(call.expression, ctx)?.declarations?.[0];
  if (!decl || !isNodeFsPromisesDeclaration(decl)) return null;

  const name = call.expression.text;
  const fn = FS_PROMISES_ENTRIES[name];
  if (!fn) return ice(`lower: unsupported node:fs/promises export ${name}`);
  // readFile's encoding argument is dropped for the same reason as the sync version: the ambient
  // signature admits only "utf8", and the runtime already returns the bytes as a UTF-8 string.
  const args = call.arguments
    .filter((a) => !(ts.isStringLiteral(a) && a.text === "utf8"))
    .map((a) => lowerExpr(a, ctx));
  return {
    kind: "runtimeCall",
    fn: fn.entry,
    args,
    type: { kind: "promise", inner: fn.resolved },
  };
}
