// `node:fs` lowering. The supported filesystem calls are imported exactly as Node resolves them
// (`import { readFileSync } from "node:fs"`) rather than exposed as a global, because the oracle
// runs the same source under Node — where `fs` is not a global. Each name maps to one runtime
// entry in runtime/fs.c.
//
// Dispatch is by SYMBOL, not by name: the imported binding's declaration must be inside the
// ambient `declare module "node:fs"` in stdlib/globals.d.ts. A user function that happens to be
// called `readFileSync` therefore stays a user function.

import ts from "typescript";
import { ice } from "../diagnostics.js";
import type { HExpr } from "../hir/nodes.js";
import { VT } from "../hir/types.js";
import type { ValueType } from "../hir/types.js";
import { type LowerCtx, lowerExpr, symbolOf } from "./lower.js";

export const NODE_FS_MODULE = "node:fs";

// The runtime entry and result type per supported name. This table and the ambient module
// declaration must list the same names — anything declared but not here reaches `ice()` rather
// than silently lowering to nothing.
const FS_ENTRIES: Record<string, { entry: string; type: ValueType }> = {
  readFileSync: { entry: "cs_fs_read_file", type: VT.string },
  writeFileSync: { entry: "cs_fs_write_file", type: VT.undefined },
  appendFileSync: { entry: "cs_fs_append_file", type: VT.undefined },
  existsSync: { entry: "cs_fs_exists", type: VT.boolean },
  unlinkSync: { entry: "cs_fs_unlink", type: VT.undefined },
};

// Whether `decl` lives inside `declare module "node:fs"`.
function isNodeFsDeclaration(decl: ts.Declaration): boolean {
  for (let n: ts.Node | undefined = decl.parent; n; n = n.parent) {
    if (ts.isModuleDeclaration(n) && ts.isStringLiteral(n.name)) {
      return n.name.text === NODE_FS_MODULE;
    }
  }
  return false;
}

// `readFileSync(path, "utf8")` and friends → a direct runtime call. Returns null when the callee
// is not a `node:fs` binding, so the caller falls through to normal function/closure lowering.
export function lowerNodeFsCall(call: ts.CallExpression, ctx: LowerCtx): HExpr | null {
  if (!ts.isIdentifier(call.expression)) return null;
  const decl = symbolOf(call.expression, ctx)?.declarations?.[0];
  if (!decl || !isNodeFsDeclaration(decl)) return null;

  const name = call.expression.text;
  const fn = FS_ENTRIES[name];
  if (!fn) return ice(`lower: unsupported node:fs export ${name}`);
  // readFileSync's encoding argument is dropped: the ambient signature admits only the literal
  // "utf8", and the runtime already hands back the file's bytes as a UTF-8 string.
  const args = call.arguments
    .filter((a) => !(ts.isStringLiteral(a) && a.text === "utf8"))
    .map((a) => lowerExpr(a, ctx));
  return { kind: "runtimeCall", fn: fn.entry, args, type: fn.type };
}
