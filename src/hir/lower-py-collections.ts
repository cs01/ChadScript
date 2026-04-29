import type { HIRType, HIRExpr } from "./types.js";
import { F64, I64, I1, I8PTR, VOID } from "./types.js";
import type { LowerCtx } from "./lower-py-ctx.js";
import { coerceToF64 } from "./lower-py-types.js";

export function lowerCounterCall(args: HIRExpr[], ctx: LowerCtx): HIRExpr | null {
  const a = args[0];
  const counterNumType: HIRType = { kind: "ptr", pointee: "__counter_num" };
  const counterStrType: HIRType = { kind: "ptr", pointee: "__counter_str" };
  if (a.type.kind === "array") {
    const elem = (a.type as { kind: "array"; element: HIRType }).element;
    if (elem.kind === "f64" || elem.kind === "i64")
      return { kind: "runtime_call", func: "cs2_counter_num_new", args: [a], returnType: counterNumType, type: counterNumType };
    return { kind: "runtime_call", func: "cs2_counter_str_new", args: [a], returnType: counterStrType, type: counterStrType };
  }
  if (a.type.kind === "i8ptr")
    return { kind: "runtime_call", func: "cs2_counter_str_from_string", args: [a], returnType: counterStrType, type: counterStrType };
  return { kind: "runtime_call", func: "cs2_counter_num_new", args: [a], returnType: counterNumType, type: counterNumType };
}

export function lowerDequeCall(args: HIRExpr[], _ctx: LowerCtx): HIRExpr {
  const dequeNumType: HIRType = { kind: "ptr", pointee: "__deque_num" };
  const a = args.length > 0 ? args[0] : { kind: "literal_null" as const, type: { kind: "ptr", pointee: "__null" } as HIRType };
  return { kind: "runtime_call", func: "cs2_deque_num_new", args: [a], returnType: dequeNumType, type: dequeNumType };
}

export function lowerDequeMethodCall(obj: HIRExpr, methodName: string, args: HIRExpr[], ctx: LowerCtx): HIRExpr | null {
  switch (methodName) {
    case "append": return { kind: "runtime_call", func: "cs2_deque_num_append", args: [obj, coerceToF64(args[0])], returnType: VOID, type: VOID };
    case "appendleft": return { kind: "runtime_call", func: "cs2_deque_num_appendleft", args: [obj, coerceToF64(args[0])], returnType: VOID, type: VOID };
    case "pop": return { kind: "runtime_call", func: "cs2_deque_num_pop", args: [obj], returnType: F64, type: F64 };
    case "popleft": return { kind: "runtime_call", func: "cs2_deque_num_popleft", args: [obj], returnType: F64, type: F64 };
    case "extend": {
      const arr = args[0];
      const iId = ctx.freshId();
      const iRef: HIRExpr = { kind: "local_get", id: iId, type: I64 };
      const lenE: HIRExpr = { kind: "runtime_call", func: "cs2_num_array_length", args: [arr], returnType: I64, type: I64 };
      ctx.pendingStmts.push(
        { kind: "let", id: iId, name: `__dext_${iId}`, type: I64, init: { kind: "literal_i64", value: 0, type: I64 }, mutable: true },
        { kind: "for",
          condition: { kind: "binary", op: "lt", left: iRef, right: lenE, type: I1 },
          update: { kind: "local_set", id: iId, value: { kind: "binary", op: "add", left: iRef, right: { kind: "literal_i64", value: 1, type: I64 }, type: I64 }, type: I64 },
          body: [{ kind: "expr", expr: { kind: "runtime_call", func: "cs2_deque_num_append", args: [obj, { kind: "index_get", array: arr, index: iRef, type: F64 }], returnType: VOID, type: VOID } }] }
      );
      return { kind: "literal_null", type: VOID };
    }
    default: return null;
  }
}
