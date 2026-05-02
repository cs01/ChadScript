import type { HIRExpr, HIRType } from "../hir/types.js";
import { LLVMRealONE } from "./llvm.js";
import { EmitContext } from "./emit-context.js";
import { emitExpr } from "./emit-expr.js";

export function emitArrayHof(
  ctx: EmitContext,
  expr: HIRExpr & { kind: "array_hof" },
): any {
  const m = ctx.m;
  const arrVal = emitExpr(ctx, expr.array);
  const closurePtr = emitExpr(ctx, expr.callback);

  const fnSlot = m.buildGEP(m.i8, closurePtr, [m.constInt(m.i64, 0)], "hof_fn_slot");
  const fnPtr = m.buildLoad(m.ptr, fnSlot, "hof_fn_ptr");
  const envSlot = m.buildGEP(m.i8, closurePtr, [m.constInt(m.i64, 8)], "hof_env_slot");
  const envPtr = m.buildLoad(m.ptr, envSlot, "hof_env_ptr");

  const decl = ctx.getDeclaredFunction(expr.bridgeFunc);
  if (!decl) throw new Error(`undeclared bridge function: ${expr.bridgeFunc}`);

  const resultName = expr.method === "forEach" ? "" : "hof_result";
  let result;
  if (expr.method === "reduce" && expr.initialValue) {
    let initVal = emitExpr(ctx, expr.initialValue);
    if (expr.initialValue.type.kind === "i64") {
      initVal = m.buildSIToFP(initVal, m.f64, "reduce_init_f64");
    }
    result = m.buildCall(decl.fnType, decl.fn, [arrVal, fnPtr, envPtr, initVal], resultName);
  } else {
    result = m.buildCall(decl.fnType, decl.fn, [arrVal, fnPtr, envPtr], resultName);
  }
  if (expr.method === "every" || expr.method === "some") {
    result = m.buildFCmp(LLVMRealONE, result, m.constReal(m.f64, 0.0), "hof_bool");
  }
  return result;
}

export function emitPromiseStatic(
  ctx: EmitContext,
  expr: HIRExpr & {
    kind: "promise_static";
    method: "all" | "race" | "allSettled";
    promises: HIRExpr[];
    innerType: HIRType;
  },
): any {
  const m = ctx.m;
  const suffix = expr.innerType.kind === "i8ptr" ? "str" : "num";

  const objNewDecl = ctx.getDeclaredFunction("cs2_obj_array_new")!;
  const objPushDecl = ctx.getDeclaredFunction("cs2_obj_array_push")!;
  const arr = m.buildCall(
    objNewDecl.fnType,
    objNewDecl.fn,
    [m.constInt(m.i32, Math.max(expr.promises.length, 4))],
    "promises_arr",
  );

  for (const p of expr.promises) {
    const val = emitExpr(ctx, p);
    m.buildCall(objPushDecl.fnType, objPushDecl.fn, [arr, val], "");
  }

  switch (expr.method) {
    case "all": {
      const fnName = `cs2_promise_all_${suffix}`;
      const decl = ctx.getDeclaredFunction(fnName)!;
      return m.buildCall(decl.fnType, decl.fn, [arr], "promise_all");
    }
    case "race": {
      const fnName = `cs2_promise_race_${suffix}`;
      const decl = ctx.getDeclaredFunction(fnName)!;
      return m.buildCall(decl.fnType, decl.fn, [arr], "promise_race");
    }
    case "allSettled": {
      return emitPromiseAllSettled(ctx, arr, expr);
    }
    default:
      throw new Error(`unsupported promise static method: ${expr.method}`);
  }
}

function emitPromiseAllSettled(
  ctx: EmitContext,
  promisesArr: any,
  expr: HIRExpr & {
    kind: "promise_static";
    promises: HIRExpr[];
    innerType: HIRType;
  },
): any {
  const m = ctx.m;

  const structInfo = ctx.getStructType("__PromiseSettledResult");
  if (!structInfo) throw new Error("__PromiseSettledResult struct not registered");
  const resultArrNew = ctx.getDeclaredFunction("cs2_obj_array_new")!;
  const resultArrPush = ctx.getDeclaredFunction("cs2_obj_array_push")!;

  const resultArr = m.buildCall(
    resultArrNew.fnType,
    resultArrNew.fn,
    [m.constInt(m.i32, Math.max(expr.promises.length, 4))],
    "settled_arr",
  );

  const getFn = expr.innerType.kind === "i8ptr" ? "cs2_promise_get_str" : "cs2_promise_get_f64";
  const getDecl = ctx.getDeclaredFunction(getFn)!;
  const objGetDecl = ctx.getDeclaredFunction("cs2_obj_array_get")!;
  const fulfilledStr = m.buildGlobalStringPtr("fulfilled", "settled_status");
  const mallocDecl = ctx.getDeclaredFunction("malloc")!;

  for (let i = 0; i < expr.promises.length; i++) {
    const promisePtr = m.buildCall(
      objGetDecl.fnType,
      objGetDecl.fn,
      [promisesArr, m.constInt(m.i32, i)],
      "p",
    );
    const resolvedVal = m.buildCall(getDecl.fnType, getDecl.fn, [promisePtr], "resolved");

    const size = m.sizeOf(structInfo.llvmType);
    const obj = m.buildCall(mallocDecl.fnType, mallocDecl.fn, [size], "settled_obj");
    const statusPtr = m.buildGEP(
      structInfo.llvmType,
      obj,
      [m.constInt(m.i32, 0), m.constInt(m.i32, 0)],
      "",
    );
    m.buildStore(fulfilledStr, statusPtr);
    const valuePtr = m.buildGEP(
      structInfo.llvmType,
      obj,
      [m.constInt(m.i32, 0), m.constInt(m.i32, 1)],
      "",
    );
    m.buildStore(resolvedVal, valuePtr);

    m.buildCall(resultArrPush.fnType, resultArrPush.fn, [resultArr, obj], "");
  }

  const promiseNew = ctx.getDeclaredFunction("cs2_promise_new")!;
  const promiseResolvePtr = ctx.getDeclaredFunction("cs2_promise_resolve_ptr")!;
  const outPromise = m.buildCall(promiseNew.fnType, promiseNew.fn, [], "settled_promise");
  m.buildCall(promiseResolvePtr.fnType, promiseResolvePtr.fn, [outPromise, resultArr], "");
  return outPromise;
}

export function promiseGetFn(type: HIRType): string {
  switch (type.kind) {
    case "f64":
      return "cs2_promise_get_f64";
    case "i64":
      return "cs2_promise_get_i64";
    case "i1":
      return "cs2_promise_get_bool";
    case "i8ptr":
      return "cs2_promise_get_str";
    case "ptr":
    case "array":
    case "closure":
    case "promise":
      return "cs2_promise_get_ptr";
    default:
      throw new Error(`cannot await type: ${type.kind}`);
  }
}
