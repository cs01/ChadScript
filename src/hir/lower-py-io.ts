import type { HIRType, HIRExpr } from "./types.js";
import { I64, I1, I8PTR, VOID } from "./types.js";
import type { LowerCtx } from "./lower-py-ctx.js";
import { coerceTo, coerceToF64 } from "./lower-py-types.js";

export function lowerJsonCall(jsonMethod: string, args: HIRExpr[]): HIRExpr | null {
  if (jsonMethod === "dumps") {
    const val = args[0];
    const t = val.type;
    if (t.kind === "i8ptr") return { kind: "runtime_call", func: "cs2_json_stringify_str", args: [val], returnType: I8PTR, type: I8PTR };
    if (t.kind === "f64") return { kind: "runtime_call", func: "cs2_json_stringify_f64", args: [val], returnType: I8PTR, type: I8PTR };
    if (t.kind === "i64") return { kind: "runtime_call", func: "cs2_json_stringify_f64", args: [coerceToF64(val)], returnType: I8PTR, type: I8PTR };
    if (t.kind === "i1") return { kind: "runtime_call", func: "cs2_json_stringify_bool", args: [val], returnType: I8PTR, type: I8PTR };
    if (t.kind === "array") {
      const elem = (t as { kind: "array"; element: HIRType }).element;
      const func = elem.kind === "i8ptr" ? "cs2_py_json_dumps_str_array" : "cs2_py_json_dumps_num_array";
      return { kind: "runtime_call", func, args: [val], returnType: I8PTR, type: I8PTR };
    }
    if (t.kind === "map") {
      const mt = t as { kind: "map"; key: HIRType; value: HIRType };
      const func = mt.value.kind === "i8ptr" ? "cs2_py_json_dumps_str_str_map" : "cs2_py_json_dumps_str_num_map";
      return { kind: "runtime_call", func, args: [val], returnType: I8PTR, type: I8PTR };
    }
    throw new Error(`json.dumps: unsupported type ${t.kind}`);
  }
  if (jsonMethod === "loads") {
    const s = args[0];
    const strStrMap: HIRType = { kind: "map", key: I8PTR, value: I8PTR };
    return { kind: "runtime_call", func: "cs2_py_json_loads_str_str_map", args: [s], returnType: strStrMap, type: strStrMap };
  }
  return null;
}

export function lowerReCall(reMethod: string, args: HIRExpr[]): HIRExpr | null {
  const reMatchType: HIRType = { kind: "ptr", pointee: "__re_match" };
  const strArrType: HIRType = { kind: "array", element: I8PTR };
  switch (reMethod) {
    case "match":
      return { kind: "runtime_call", func: "cs2_re_match", args: [args[0], args[1]], returnType: reMatchType, type: reMatchType };
    case "search":
      return { kind: "runtime_call", func: "cs2_re_search", args: [args[0], args[1]], returnType: reMatchType, type: reMatchType };
    case "findall":
      return { kind: "runtime_call", func: "cs2_re_findall", args: [args[0], args[1]], returnType: strArrType, type: strArrType };
    case "sub":
      return { kind: "runtime_call", func: "cs2_re_sub", args: [args[0], args[1], args[2]], returnType: I8PTR, type: I8PTR };
    case "split":
      return { kind: "runtime_call", func: "cs2_re_split", args: [args[0], args[1]], returnType: strArrType, type: strArrType };
    default:
      return null;
  }
}

export function lowerFileMethodCall(obj: HIRExpr, methodName: string, args: HIRExpr[], ctx: LowerCtx): HIRExpr | null {
  const strArrType: HIRType = { kind: "array", element: I8PTR };
  switch (methodName) {
    case "read":
      if (args.length > 0) return { kind: "runtime_call", func: "cs2_io_read_n", args: [obj, coerceTo(args[0], I64)], returnType: I8PTR, type: I8PTR };
      return { kind: "runtime_call", func: "cs2_io_read", args: [obj], returnType: I8PTR, type: I8PTR };
    case "readline":
      return { kind: "runtime_call", func: "cs2_io_readline", args: [obj], returnType: I8PTR, type: I8PTR };
    case "readlines":
      return { kind: "runtime_call", func: "cs2_io_readlines", args: [obj], returnType: strArrType, type: strArrType };
    case "write":
      return { kind: "runtime_call", func: "cs2_io_write", args: [obj, args[0]], returnType: VOID, type: VOID };
    case "writelines": {
      const lines = args[0];
      const iId = ctx.freshId();
      const iRef: HIRExpr = { kind: "local_get", id: iId, type: I64 };
      const lenE: HIRExpr = { kind: "runtime_call", func: "cs2_str_array_length", args: [lines], returnType: I64, type: I64 };
      ctx.pendingStmts.push(
        { kind: "let", id: iId, name: `__wl_${iId}`, type: I64, init: { kind: "literal_i64", value: 0, type: I64 }, mutable: true },
        { kind: "for",
          condition: { kind: "binary", op: "lt", left: iRef, right: lenE, type: I1 },
          update: { kind: "local_set", id: iId, value: { kind: "binary", op: "add", left: iRef, right: { kind: "literal_i64", value: 1, type: I64 }, type: I64 }, type: I64 },
          body: [{ kind: "expr", expr: { kind: "runtime_call", func: "cs2_io_write", args: [obj, { kind: "index_get", array: lines, index: iRef, type: I8PTR }], returnType: VOID, type: VOID } }] }
      );
      return { kind: "literal_null", type: VOID };
    }
    case "close":
      return { kind: "runtime_call", func: "cs2_io_close", args: [obj], returnType: VOID, type: VOID };
    case "flush":
      return { kind: "runtime_call", func: "cs2_io_flush", args: [obj], returnType: VOID, type: VOID };
    case "seek": {
      const offset = coerceTo(args[0], I64);
      const whence = args[1] ? { kind: "binary" as const, op: "bit_and" as const, left: coerceTo(args[1], I64), right: { kind: "literal_i64" as const, value: 3, type: I64 }, type: I64 } : { kind: "literal_i64" as const, value: 0, type: I64 };
      return { kind: "runtime_call", func: "cs2_io_seek", args: [obj, offset, whence], returnType: VOID, type: VOID };
    }
    case "tell":
      return { kind: "runtime_call", func: "cs2_io_tell", args: [obj], returnType: I64, type: I64 };
    default:
      return null;
  }
}

export function lowerReMatchMethodCall(obj: HIRExpr, methodName: string, args: HIRExpr[]): HIRExpr | null {
  switch (methodName) {
    case "group": {
      const n: HIRExpr = args.length > 0 ? coerceTo(args[0], I64) : { kind: "literal_i64", value: 0, type: I64 };
      return { kind: "runtime_call", func: "cs2_re_match_group", args: [obj, n], returnType: I8PTR, type: I8PTR };
    }
    case "start":
      return { kind: "runtime_call", func: "cs2_re_match_start", args: [obj], returnType: I64, type: I64 };
    case "end":
      return { kind: "runtime_call", func: "cs2_re_match_end", args: [obj], returnType: I64, type: I64 };
    default:
      return null;
  }
}
