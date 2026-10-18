// Parameter lists of functions, methods, constructors and closures: plain, destructured-object,
// optional (`y?: T`) and defaulted (`y = v`, `y: T = v`) parameters, and the call-site side that
// fills omitted trailing arguments.
//
// ABI (paramSlotType in type-translation.ts): an optional or defaulted parameter is PASSED as
// `T | undefined` (an optional pointer, or a Value word that can hold undefined), so a caller can
// always omit it by passing the undefined value of that slot. A defaulted parameter arrives under
// a synthetic name, and the callee's prologue binds the source name to `arg === undefined ?
// <default> : arg` at the in-body type. That is exactly JS's rule: the default runs at call time,
// in the callee's scope, left to right after earlier parameters are bound, only for `undefined`
// (not `null`). Because the default lives in the callee, virtual dispatch runs the override's
// default, as in JS.

import ts from "typescript";
import { ice } from "../diagnostics.js";
import type { HExpr, HParam, HStmt } from "../hir/nodes.js";
import { VT } from "../hir/types.js";
import type { ValueType } from "../hir/types.js";
import { type LowerCtx, coerceToTarget, lowerExpr, nameOf } from "./lower.js";
import { bindObjectPattern } from "./statements.js";
import { cellFlag } from "./cells.js";
import { paramSlotType, valueTypeOf } from "./type-translation.js";

export interface LoweredParams {
  params: HParam[];
  // Statements binding destructured fields and applying defaults, in parameter order. Deferred so
  // the caller can first set up the scope a default may read (`this` in a method).
  prologue: () => HStmt[];
}

export function lowerParams(
  decls: readonly ts.ParameterDeclaration[],
  ctx: LowerCtx,
  what: string,
): LoweredParams {
  const params: HParam[] = [];
  const steps: (() => HStmt[])[] = [];
  for (const p of decls) {
    if (ts.isObjectBindingPattern(p.name)) {
      if (p.questionToken || p.initializer) {
        ice(`lower: optional/default destructured ${what} parameter`);
      }
      // Received as one object under a synthetic name; the prologue binds its fields as locals.
      const ptype = valueTypeOf(p, ctx);
      const tempName = `__param.${ctx.counter.n++}`;
      const pattern = p.name;
      params.push({ name: tempName, type: ptype });
      steps.push(() =>
        bindObjectPattern(pattern, { kind: "varRef", name: tempName, type: ptype }, ctx),
      );
      continue;
    }
    if (!ts.isIdentifier(p.name)) ice(`lower: array-destructured ${what} parameter`);
    const ident = p.name;
    const init = p.initializer;
    if (!init || p.dotDotDotToken) {
      // A rest parameter `...xs: T[]` is received as one array (the call site packs it); an
      // optional `y?: T` is received as its `T | undefined` type, which is its slot.
      params.push({
        name: nameOf(ident, ctx),
        type: valueTypeOf(ident, ctx),
        ...cellFlag(ident, ctx.cells, ctx.checker),
      });
      continue;
    }
    const sym = ctx.checker.getSymbolAtLocation(ident) ?? ice("lower: parameter without symbol");
    const slot = paramSlotType(sym, p, ctx.checker);
    const argName = `__arg.${ctx.counter.n++}`;
    params.push({ name: argName, type: slot });
    // Registering the source name now lets a later default (or a closure in one) refer to it.
    const local = nameOf(ident, ctx);
    const bodyType = valueTypeOf(ident, ctx);
    const cell = cellFlag(ident, ctx.cells, ctx.checker);
    steps.push(() => [
      {
        kind: "varDecl",
        name: local,
        type: bodyType,
        init: defaulted({ kind: "varRef", name: argName, type: slot }, init, bodyType, ctx),
        ...cell,
      },
    ]);
  }
  return { params, prologue: () => steps.flatMap((s) => s()) };
}

// `arg === undefined ? <init> : arg`, in the in-body representation.
function defaulted(arg: HExpr, init: ts.Expression, bodyType: ValueType, ctx: LowerCtx): HExpr {
  return {
    kind: "conditional",
    cond: { kind: "nullCheck", value: arg, isEqual: true, sentinel: "undefined", type: VT.boolean },
    whenTrue: coerceToTarget(lowerExpr(init, ctx), bodyType),
    whenFalse: present(arg, bodyType),
    type: bodyType,
  };
}

// The passed argument, known not to be undefined, at the in-body type: an optional slot is
// unwrapped and a Value word unboxed when the body type excludes undefined; otherwise the slot
// already is that representation.
function present(arg: HExpr, bodyType: ValueType): HExpr {
  const slot = arg.type;
  if (slot.kind === bodyType.kind) return { ...arg, type: bodyType } as HExpr;
  if (slot.kind === "optional") return { kind: "unwrap", value: arg, type: bodyType };
  if (slot.kind === "value") return { kind: "unbox", value: arg, type: bodyType };
  return ice(`lower: defaulted parameter slot ${slot.kind} for body type ${bodyType.kind}`);
}

// The argument a caller passes for an omitted optional or defaulted parameter.
export function omittedArg(slot: ValueType): HExpr {
  if (slot.kind !== "optional" && slot.kind !== "value") {
    return ice(`lower: omitted argument for a ${slot.kind} parameter`);
  }
  return coerceToTarget({ kind: "undefinedLit", type: VT.undefined }, slot);
}
