import type { SyntaxNode } from "../parser-py.js";
import type { HIRType, HIRExpr } from "./types.js";
import { F64, I64, I1, I8PTR, VOID } from "./types.js";
import { coerceTo, coerceToF64 } from "./lower-py-types.js";

export function lowerSysCall(sysMethod: string, args: HIRExpr[]): HIRExpr | null {
  if (sysMethod === "exit") {
    const code = args[0] ? coerceTo(args[0], I64) : { kind: "literal_i64" as const, value: 0, type: I64 };
    return { kind: "runtime_call", func: "cs2_py_sys_exit", args: [code], returnType: VOID, type: VOID };
  }
  return null;
}

export function lowerOsCall(method: string, args: HIRExpr[]): HIRExpr | null {
  switch (method) {
    case "getcwd":
      return { kind: "runtime_call", func: "cs2_os_getcwd", args: [], returnType: I8PTR, type: I8PTR };
    case "listdir": {
      const strArrType: HIRType = { kind: "array", element: I8PTR };
      const path = args[0] ?? { kind: "runtime_call" as const, func: "cs2_os_getcwd", args: [], returnType: I8PTR, type: I8PTR };
      return { kind: "runtime_call", func: "cs2_os_listdir", args: [path], returnType: strArrType, type: strArrType };
    }
    case "getenv":
      return { kind: "runtime_call", func: "cs2_os_getenv", args: [args[0]], returnType: I8PTR, type: I8PTR };
    case "mkdir":
      return { kind: "runtime_call", func: "cs2_os_mkdir", args: [args[0]], returnType: VOID, type: VOID };
    case "remove":
      return { kind: "runtime_call", func: "cs2_os_remove", args: [args[0]], returnType: VOID, type: VOID };
    default:
      return null;
  }
}

export function lowerOsPathCall(method: string, args: HIRExpr[]): HIRExpr | null {
  switch (method) {
    case "exists":
      return { kind: "runtime_call", func: "cs2_os_path_exists", args: [args[0]], returnType: I1, type: I1 };
    case "isfile":
      return { kind: "runtime_call", func: "cs2_os_path_isfile", args: [args[0]], returnType: I1, type: I1 };
    case "isdir":
      return { kind: "runtime_call", func: "cs2_os_path_isdir", args: [args[0]], returnType: I1, type: I1 };
    case "join":
      return args.slice(1).reduce((acc, seg) =>
        ({ kind: "runtime_call" as const, func: "cs2_os_path_join", args: [acc, seg], returnType: I8PTR, type: I8PTR }),
        args[0]);
    case "basename":
      return { kind: "runtime_call", func: "cs2_os_path_basename", args: [args[0]], returnType: I8PTR, type: I8PTR };
    case "dirname":
      return { kind: "runtime_call", func: "cs2_os_path_dirname", args: [args[0]], returnType: I8PTR, type: I8PTR };
    case "abspath":
      return { kind: "runtime_call", func: "cs2_os_path_abspath", args: [args[0]], returnType: I8PTR, type: I8PTR };
    case "splitext": {
      const nameE: HIRExpr = { kind: "runtime_call", func: "cs2_os_path_splitext_name", args: [args[0]], returnType: I8PTR, type: I8PTR };
      const extE: HIRExpr = { kind: "runtime_call", func: "cs2_os_path_splitext_ext", args: [args[0]], returnType: I8PTR, type: I8PTR };
      return { kind: "tuple", elements: [nameE, extE], type: { kind: "tuple", elements: [I8PTR, I8PTR] } as HIRType };
    }
    default:
      return null;
  }
}

export function lowerRandomCall(randMethod: string, args: HIRExpr[]): HIRExpr | null {
  switch (randMethod) {
    case "random":
      return { kind: "runtime_call", func: "cs2_random_random", args: [], returnType: F64, type: F64 };
    case "seed": {
      const s = args[0] ? coerceTo(args[0], I64) : { kind: "literal_i64" as const, value: 0, type: I64 };
      return { kind: "runtime_call", func: "cs2_random_seed", args: [s], returnType: VOID, type: VOID };
    }
    case "randint": {
      const a = coerceTo(args[0], I64);
      const b = coerceTo(args[1], I64);
      return { kind: "runtime_call", func: "cs2_random_randint", args: [a, b], returnType: I64, type: I64 };
    }
    case "uniform": {
      const a = coerceToF64(args[0]);
      const b = coerceToF64(args[1]);
      return { kind: "runtime_call", func: "cs2_random_uniform", args: [a, b], returnType: F64, type: F64 };
    }
    case "choice": {
      const lst = args[0];
      if (lst.type.kind === "array") {
        if (lst.type.element.kind === "i8ptr") {
          return { kind: "runtime_call", func: "cs2_random_choice_str", args: [lst], returnType: I8PTR, type: I8PTR };
        }
        return { kind: "runtime_call", func: "cs2_random_choice_num", args: [lst], returnType: F64, type: F64 };
      }
      throw new Error("random.choice requires a list");
    }
    case "shuffle": {
      const lst = args[0];
      return { kind: "runtime_call", func: "cs2_random_shuffle_num", args: [lst], returnType: VOID, type: VOID };
    }
    default:
      return null;
  }
}

export function lowerMathCall(mathMethod: string, args: HIRExpr[]): HIRExpr | null {
  const mathMap: Record<string, string> = {
    sqrt: "cs_math_sqrt",
    floor: "cs_math_floor",
    ceil: "cs_math_ceil",
    abs: "cs_math_abs",
    sin: "cs_math_sin",
    cos: "cs_math_cos",
    tan: "cs_math_tan",
    log: "cs_math_log",
    log2: "cs_math_log2",
    exp: "cs_math_exp",
    pow: "cs_math_pow",
    fabs: "cs_math_abs",
  };
  const mathFn = mathMap[mathMethod];
  if (!mathFn) return null;
  const isIntResult = mathMethod === "floor" || mathMethod === "ceil";
  const result: HIRExpr = {
    kind: "runtime_call",
    func: mathFn,
    args: args.map(coerceToF64),
    returnType: F64, type: F64,
  };
  if (isIntResult) return { kind: "narrow_i64", value: result, type: I64 };
  return result;
}

export function isOsPathCall(funcNode: SyntaxNode): boolean {
  const objNode0 = funcNode.namedChild(0)!;
  return objNode0.type === "attribute" &&
    objNode0.namedChild(0)!.text === "os" &&
    objNode0.namedChild(1)!.text === "path";
}
