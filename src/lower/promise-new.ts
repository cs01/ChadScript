// `new Promise<T>((resolve: (value: T) => void, reject: (reason: Error) => void) => { ... })`.
// The validator (validate/promise-rules.ts) admits only an inline executor whose parameters are
// annotated that way (resolve as `() => void` for Promise<void>), so the closure's parameter types
// are exactly the ones codegen/promise-new.ts builds.

import ts from "typescript";
import { ice } from "../diagnostics.js";
import type { HExpr } from "../hir/nodes.js";
import type { ValueType } from "../hir/types.js";
import { type LowerCtx, lowerExpr } from "./lower.js";

export function lowerPromiseNew(ne: ts.NewExpression, type: ValueType, ctx: LowerCtx): HExpr {
  const arg = ne.arguments?.[0];
  if (!arg) return ice("lower: `new Promise` without an executor");
  const executor = lowerExpr(arg, ctx);
  if (executor.type.kind !== "function") return ice("lower: Promise executor is not a function");
  const resolve = executor.type.params[0];
  const resolveArity =
    resolve === undefined ? 0 : resolve.kind === "function" ? resolve.params.length : -1;
  if (resolveArity < 0) return ice("lower: Promise resolve parameter is not a function");
  return {
    kind: "promiseNew",
    executor,
    executorArity: executor.type.params.length,
    resolveArity,
    type,
  };
}
