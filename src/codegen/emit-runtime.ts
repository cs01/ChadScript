import type { HIRExpr } from "../hir/types.js";
import { LLVMIntNE, LLVMRealOGT, LLVMRealOLT } from "./llvm.js";
import { EmitContext } from "./emit-context.js";
import { emitExpr } from "./emit-expr.js";

export function emitRuntimeCall(ctx: EmitContext, expr: HIRExpr & { kind: "runtime_call" }): any {
  const m = ctx.m;

  if (expr.func.startsWith("cs_math_")) {
    return emitMathCall(ctx, expr);
  }

  if (expr.func === "cs_string_concat") {
    return emitStringConcat(ctx, expr);
  }

  if (expr.func === "cs2_string_builder_append") {
    return emitBuilderAppend(ctx, expr);
  }

  if (
    expr.func === "cs_console_log" ||
    expr.func === "cs_console_error" ||
    expr.func === "cs_console_warn"
  ) {
    const toStderr = expr.func !== "cs_console_log";
    for (let i = 0; i < expr.args.length; i++) {
      if (i > 0) {
        if (toStderr) {
          const spaceFn = ctx.getDeclaredFunction("cs2_stderr_space")!;
          m.buildCall(spaceFn.fnType, spaceFn.fn, [], "");
        } else {
          const spaceStr = m.buildGlobalStringPtr(" ", "space");
          const printf = ctx.getDeclaredFunction("printf")!;
          m.buildCall(printf.fnType, printf.fn, [spaceStr], "");
        }
      }
      const arg = expr.args[i];
      const val = emitExpr(ctx, arg);
      if (toStderr) {
        emitPrintValueStderr(ctx, arg, val, i === expr.args.length - 1);
      } else {
        emitPrintValue(ctx, arg, val, i === expr.args.length - 1);
      }
    }
    if (expr.args.length === 0) {
      if (toStderr) {
        const nlFn = ctx.getDeclaredFunction("cs2_stderr_nl")!;
        m.buildCall(nlFn.fnType, nlFn.fn, [], "");
      } else {
        const nlStr = m.buildGlobalStringPtr("\n", "nl");
        const printf = ctx.getDeclaredFunction("printf")!;
        m.buildCall(printf.fnType, printf.fn, [nlStr], "");
      }
    }
    return m.constInt(m.i32, 0);
  }

  const bridgeFn = ctx.getDeclaredFunction(expr.func);
  if (bridgeFn) {
    const args = expr.args.map((a) => {
      let val = emitExpr(ctx, a);
      if (a.type.kind === "i64") {
        val = m.buildTrunc(val, m.i32, "");
      } else if (a.type.kind === "i1" && expr.func.includes("num_array")) {
        const ext = m.buildZExt(val, m.i64, "");
        val = m.buildSIToFP(ext, m.f64, "");
      }
      return val;
    });
    let result = m.buildCall(bridgeFn.fnType, bridgeFn.fn, args, "");
    if (expr.returnType.kind === "i64") {
      result = m.buildSExt(result, m.i64, "");
    } else if (expr.returnType.kind === "i1") {
      result = m.buildICmp(LLVMIntNE, result, m.constInt(m.i32, 0), "");
    }
    return result;
  }

  return m.constInt(m.i64, 0);
}

function emitPrintValue(ctx: EmitContext, arg: HIRExpr, val: any, isLast: boolean): void {
  const m = ctx.m;
  const nl = isLast ? "\n" : "";

  if (arg.type.kind === "i8ptr") {
    if (isLast) {
      const puts = ctx.getDeclaredFunction("puts")!;
      m.buildCall(puts.fnType, puts.fn, [val], "");
    } else {
      const fmt = m.buildGlobalStringPtr("%s", "fmt");
      const printf = ctx.getDeclaredFunction("printf")!;
      m.buildCall(printf.fnType, printf.fn, [fmt, val], "");
    }
  } else if (arg.type.kind === "f64") {
    const printNum = ctx.getDeclaredFunction("cs2_print_number")!;
    m.buildCall(printNum.fnType, printNum.fn, [val], "");
    if (nl) {
      const nlStr = m.buildGlobalStringPtr("\n", "nl");
      const printf = ctx.getDeclaredFunction("printf")!;
      m.buildCall(printf.fnType, printf.fn, [nlStr], "");
    }
  } else if (arg.type.kind === "i64") {
    const fmt = m.buildGlobalStringPtr(`%ld${nl}`, "fmt");
    const printf = ctx.getDeclaredFunction("printf")!;
    m.buildCall(printf.fnType, printf.fn, [fmt, val], "");
  } else if (arg.type.kind === "i1") {
    const trueStr = m.buildGlobalStringPtr("true", "true");
    const falseStr = m.buildGlobalStringPtr("false", "false");
    const selected = m.buildSelect(val, trueStr, falseStr, "");
    if (isLast) {
      const puts = ctx.getDeclaredFunction("puts")!;
      m.buildCall(puts.fnType, puts.fn, [selected], "");
    } else {
      const fmt = m.buildGlobalStringPtr("%s", "fmt");
      const printf = ctx.getDeclaredFunction("printf")!;
      m.buildCall(printf.fnType, printf.fn, [fmt, selected], "");
    }
  } else if (arg.type.kind === "array") {
    const elemKind = (arg.type as { kind: "array"; element: { kind: string } }).element.kind;
    const printFn =
      elemKind === "i8ptr"
        ? ctx.getDeclaredFunction("cs2_print_str_array")!
        : ctx.getDeclaredFunction("cs2_print_num_array")!;
    m.buildCall(printFn.fnType, printFn.fn, [val], "");
    if (nl) {
      const nlStr = m.buildGlobalStringPtr("\n", "nl");
      const printf = ctx.getDeclaredFunction("printf")!;
      m.buildCall(printf.fnType, printf.fn, [nlStr], "");
    }
  } else if (arg.type.kind === "boxed") {
    if (isLast) {
      const printFn = ctx.getDeclaredFunction("nanbox_print")!;
      m.buildCall(printFn.fnType, printFn.fn, [val], "");
    } else {
      const toStr = ctx.getDeclaredFunction("nanbox_to_string_val")!;
      const boxedStr = m.buildCall(toStr.fnType, toStr.fn, [val], "");
      const unbox = ctx.getDeclaredFunction("nanbox_to_string")!;
      const rawStr = m.buildCall(unbox.fnType, unbox.fn, [boxedStr], "");
      const fmt = m.buildGlobalStringPtr("%s", "fmt");
      const printf = ctx.getDeclaredFunction("printf")!;
      m.buildCall(printf.fnType, printf.fn, [fmt, rawStr], "");
    }
  }
}

function emitPrintValueStderr(ctx: EmitContext, arg: HIRExpr, val: any, isLast: boolean): void {
  const m = ctx.m;
  if (arg.type.kind === "i8ptr") {
    const fn = ctx.getDeclaredFunction(isLast ? "cs2_stderr_str_nl" : "cs2_stderr_str")!;
    m.buildCall(fn.fnType, fn.fn, [val], "");
  } else if (arg.type.kind === "f64") {
    const fn = ctx.getDeclaredFunction("cs2_stderr_number")!;
    m.buildCall(fn.fnType, fn.fn, [val], "");
    if (isLast) {
      const nlFn = ctx.getDeclaredFunction("cs2_stderr_nl")!;
      m.buildCall(nlFn.fnType, nlFn.fn, [], "");
    }
  } else if (arg.type.kind === "i64") {
    const fn = ctx.getDeclaredFunction("cs2_stderr_i64")!;
    m.buildCall(fn.fnType, fn.fn, [val], "");
    if (isLast) {
      const nlFn = ctx.getDeclaredFunction("cs2_stderr_nl")!;
      m.buildCall(nlFn.fnType, nlFn.fn, [], "");
    }
  } else if (arg.type.kind === "i1") {
    const fn = ctx.getDeclaredFunction("cs2_stderr_bool")!;
    m.buildCall(fn.fnType, fn.fn, [val], "");
    if (isLast) {
      const nlFn = ctx.getDeclaredFunction("cs2_stderr_nl")!;
      m.buildCall(nlFn.fnType, nlFn.fn, [], "");
    }
  } else if (arg.type.kind === "boxed") {
    const fn = ctx.getDeclaredFunction("cs2_stderr_boxed")!;
    m.buildCall(fn.fnType, fn.fn, [val], "");
    if (isLast) {
      const nlFn = ctx.getDeclaredFunction("cs2_stderr_nl")!;
      m.buildCall(nlFn.fnType, nlFn.fn, [], "");
    }
  }
}

function emitToString(ctx: EmitContext, arg: HIRExpr, val: any): any {
  const m = ctx.m;
  if (arg.type.kind === "i8ptr") return val;

  if (arg.type.kind === "boxed") {
    const toStr = ctx.getDeclaredFunction("nanbox_to_string_val")!;
    const boxedStr = m.buildCall(toStr.fnType, toStr.fn, [val], "");
    const unbox = ctx.getDeclaredFunction("nanbox_to_string")!;
    return m.buildCall(unbox.fnType, unbox.fn, [boxedStr], "");
  }

  const arena = ctx.getDeclaredFunction("cs2_arena_alloc")!;
  const buf = m.buildCall(arena.fnType, arena.fn, [m.constInt(m.i64, 32)], "buf");

  if (arg.type.kind === "f64") {
    const fmtNum = ctx.getDeclaredFunction("cs2_format_number")!;
    m.buildCall(fmtNum.fnType, fmtNum.fn, [buf, val], "");
  } else if (arg.type.kind === "i64") {
    const fmt = m.buildGlobalStringPtr("%ld", "fmt");
    const sprintf = ctx.getDeclaredFunction("sprintf")!;
    m.buildCall(sprintf.fnType, sprintf.fn, [buf, fmt, val], "");
  } else if (arg.type.kind === "i1") {
    const trueStr = m.buildGlobalStringPtr("true", "true");
    const falseStr = m.buildGlobalStringPtr("false", "false");
    return m.buildSelect(val, trueStr, falseStr, "");
  }

  return buf;
}

function emitBuilderAppend(ctx: EmitContext, expr: HIRExpr & { kind: "runtime_call" }): any {
  const m = ctx.m;
  const leftArg = expr.args[0];
  const rightArg = expr.args[1];
  const leftVal = emitExpr(ctx, leftArg);
  const rightVal = emitExpr(ctx, rightArg);
  const rightStr = emitToString(ctx, rightArg, rightVal);
  const fn = ctx.getDeclaredFunction("cs2_string_builder_append")!;
  return m.buildCall(fn.fnType, fn.fn, [leftVal, rightStr], "");
}

function emitStringConcat(ctx: EmitContext, expr: HIRExpr & { kind: "runtime_call" }): any {
  const m = ctx.m;
  const leftArg = expr.args[0];
  const rightArg = expr.args[1];
  const leftVal = emitExpr(ctx, leftArg);
  const rightVal = emitExpr(ctx, rightArg);

  const leftStr = emitToString(ctx, leftArg, leftVal);
  const rightStr = emitToString(ctx, rightArg, rightVal);

  const strlen = ctx.getDeclaredFunction("strlen")!;
  const arena = ctx.getDeclaredFunction("cs2_arena_alloc")!;
  const strcpy = ctx.getDeclaredFunction("strcpy")!;
  const strcat = ctx.getDeclaredFunction("strcat")!;

  const lenL = m.buildCall(strlen.fnType, strlen.fn, [leftStr], "");
  const lenR = m.buildCall(strlen.fnType, strlen.fn, [rightStr], "");
  const totalLen = m.buildAdd(lenL, lenR, "");
  const totalLen1 = m.buildAdd(totalLen, m.constInt(m.i64, 1), "");
  const buf = m.buildCall(arena.fnType, arena.fn, [totalLen1], "");
  m.buildCall(strcpy.fnType, strcpy.fn, [buf, leftStr], "");
  m.buildCall(strcat.fnType, strcat.fn, [buf, rightStr], "");
  return buf;
}

function emitMathCall(ctx: EmitContext, expr: HIRExpr & { kind: "runtime_call" }): any {
  const m = ctx.m;

  const args = expr.args.map((a) => {
    const val = emitExpr(ctx, a);
    if (a.type.kind === "i64") return m.buildSIToFP(val, m.f64, "");
    if (a.type.kind === "i1") {
      const ext = m.buildZExt(val, m.i64, "");
      return m.buildSIToFP(ext, m.f64, "");
    }
    if (a.type.kind === "boxed") {
      const fn = ctx.getDeclaredFunction("nanbox_to_f64")!;
      return m.buildCall(fn.fnType, fn.fn, [val], "");
    }
    if (a.type.kind !== "f64") return m.constReal(m.f64, 0.0);
    return val;
  });

  if (expr.func === "cs_math_sign") {
    const val = args[0];
    const zero = m.constReal(m.f64, 0);
    const isPos = m.buildFCmp(LLVMRealOGT, val, zero, "");
    const isNeg = m.buildFCmp(LLVMRealOLT, val, zero, "");
    const posOne = m.constReal(m.f64, 1);
    const negOne = m.constReal(m.f64, -1);
    const step1 = m.buildSelect(isNeg, negOne, zero, "");
    return m.buildSelect(isPos, posOne, step1, "");
  }

  if (expr.func === "cs_math_clz32") {
    const val = args[0];
    const i32Val = m.buildFPToSI(val, m.i32, "");
    const ctlz = ctx.getMathIntrinsic("cs_math_clz32_intrinsic")!;
    const result = m.buildCall(ctlz.fnType, ctlz.fn, [i32Val, m.constInt(m.i1, 0)], "");
    return m.buildSIToFP(result, m.f64, "");
  }

  const intrinsic = ctx.getMathIntrinsic(expr.func);
  if (!intrinsic) throw new Error(`unsupported math function: ${expr.func}`);

  return m.buildCall(intrinsic.fnType, intrinsic.fn, args, "");
}
