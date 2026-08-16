// `node:path` lowering — same shape as node-fs.ts: named imports resolved BY SYMBOL against the
// ambient `declare module "node:path"`, so a user function named `join` stays a user function.
//
// Two of the entries are variadic in Node (`join`, `resolve`). The subset has no rest parameters,
// but the ambient declaration may still declare one: `.d.ts` files are excluded from the
// validator's walk (program.ts filters isDeclarationFile), and each call site has a fixed,
// statically-known argument list. Those calls lower to an array literal of the arguments plus one
// runtime call taking that array, which keeps arity out of the ABI.

import ts from "typescript";
import { ice } from "../diagnostics.js";
import type { HExpr } from "../hir/nodes.js";
import { VT } from "../hir/types.js";
import type { ValueType } from "../hir/types.js";
import { type LowerCtx, lowerExpr, symbolOf } from "./lower.js";

export const NODE_PATH_MODULE = "node:path";

// `variadic` entries take one CsArray of strings; the rest take their arguments positionally.
// This table and the ambient module declaration must list the same names — a name declared there
// but missing here reaches ice() instead of silently lowering to nothing.
export const PATH_ENTRIES: Record<string, { entry: string; type: ValueType; variadic?: boolean }> =
  {
    join: { entry: "cs_path_join", type: VT.string, variadic: true },
    resolve: { entry: "cs_path_resolve", type: VT.string, variadic: true },
    normalize: { entry: "cs_path_normalize", type: VT.string },
    dirname: { entry: "cs_path_dirname", type: VT.string },
    basename: { entry: "cs_path_basename", type: VT.string },
    extname: { entry: "cs_path_extname", type: VT.string },
    isAbsolute: { entry: "cs_path_is_absolute", type: VT.boolean },
  };

// Whether `decl` lives inside `declare module "node:path"`.
function isNodePathDeclaration(decl: ts.Declaration): boolean {
  for (let n: ts.Node | undefined = decl.parent; n; n = n.parent) {
    if (ts.isModuleDeclaration(n) && ts.isStringLiteral(n.name)) {
      return n.name.text === NODE_PATH_MODULE;
    }
  }
  return false;
}

// `join(a, b)` / `dirname(p)` → a direct runtime call. Returns null when the callee is not a
// `node:path` binding, so the caller falls through to normal function/closure lowering.
export function lowerNodePathCall(call: ts.CallExpression, ctx: LowerCtx): HExpr | null {
  if (!ts.isIdentifier(call.expression)) return null;
  const decl = symbolOf(call.expression, ctx)?.declarations?.[0];
  if (!decl || !isNodePathDeclaration(decl)) return null;

  const name = call.expression.text;
  const fn = PATH_ENTRIES[name];
  if (!fn) return ice(`lower: unsupported node:path export ${name}`);

  const args = call.arguments.map((a) => lowerExpr(a, ctx));
  if (!fn.variadic) return { kind: "runtimeCall", fn: fn.entry, args, type: fn.type };

  const parts: HExpr = {
    kind: "arrayLit",
    elements: args.map((value) => ({ spread: false, value })),
    type: VT.array(VT.string),
  };
  return { kind: "runtimeCall", fn: fn.entry, args: [parts], type: fn.type };
}
