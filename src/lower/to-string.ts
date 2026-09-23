// String conversion of an object (`String(x)`, `${x}`, `"" + x`): JS calls the object's own
// `toString()` when it has one. lower turns such an operand into that method call; every other object
// converts to "[object Object]" in codegen. The validator (validate/string-rules.ts) rejects the sites
// where the static type does not say which it is (a subclass or a literal adds a toString the
// static type lacks, or a valueOf changes `+`).

import ts from "typescript";
import type { HExpr } from "../hir/nodes.js";
import { VT } from "../hir/types.js";
import type { LowerCtx } from "./lower.js";
import { methodDispatchAt } from "./member-access.js";

// The program's own declaration of `name` on `t` (a method or field the source declares, not the
// lib's Object.prototype one), or undefined.
export function ownMember(
  t: ts.Type,
  name: string,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  const prop = checker.getPropertyOfType(t, name);
  if (!prop) return undefined;
  const decls = prop.declarations ?? [];
  return decls.length > 0 && decls.every((d) => !d.getSourceFile().isDeclarationFile)
    ? prop
    : undefined;
}

// `h` (lowered from `e`) as the operand of a string conversion. `resultType` is the conversion's
// result: for `+` / `+=` only a string result converts its operands (else it is arithmetic).
export function stringOperand(
  e: ts.Expression,
  h: HExpr,
  ctx: LowerCtx,
  resultType: HExpr["type"] = VT.string,
): HExpr {
  if (h.type.kind !== "object" || resultType.kind !== "string") return h;
  if (!ownMember(ctx.checker.getTypeAtLocation(e), "toString", ctx.checker)) return h;
  return {
    kind: "virtualCall",
    receiver: h,
    dispatch: methodDispatchAt(e, h.type, "toString", ctx),
    args: [],
    type: VT.string,
  };
}
