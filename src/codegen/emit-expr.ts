import type { HIRExpr, HIRType } from "../hir/types.js";
import {
  LLVMIntEQ,
  LLVMIntNE,
  LLVMIntSLT,
  LLVMIntSLE,
  LLVMIntSGT,
  LLVMIntSGE,
  LLVMRealOEQ,
  LLVMRealONE,
  LLVMRealOLT,
  LLVMRealOLE,
  LLVMRealOGT,
  LLVMRealOGE,
  LLVMRealORD,
  LLVMRealUNO,
} from "./llvm.js";
import {
  EmitContext,
  llvmType,
  coerceLLVM,
  emitCapturedLoad,
  emitCapturedStore,
  emitBoxValue,
  emitUnboxValue,
} from "./emit-context.js";
import {
  emitArrayPrefix,
  emitAllocArray,
  emitAllocArraySpread,
  emitAllocStruct,
  emitAllocMap,
  emitAllocSet,
  emitAllocDynObj,
  emitAllocDynarray,
} from "./emit-alloc.js";
import { emitRuntimeCall } from "./emit-runtime.js";
import { emitArrayHof, emitPromiseStatic, promiseGetFn } from "./emit-hof-promise.js";

export function emitExpr(ctx: EmitContext, expr: HIRExpr): any {
  const m = ctx.m;

  switch (expr.kind) {
    case "literal_f64":
      return m.constReal(m.f64, expr.value);
    case "literal_i64":
      return m.constInt(m.i64, expr.value);
    case "literal_i1":
      return m.constInt(m.i1, expr.value ? 1 : 0);
    case "literal_string":
      return m.buildGlobalStringPtr(expr.value, "str");
    case "literal_null":
      if (expr.type.kind === "boxed") {
        const fn = ctx.getDeclaredFunction("nanbox_null")!;
        return m.buildCall(fn.fnType, fn.fn, [], "");
      }
      return m.constNull(m.ptr);
    case "local_get": {
      const alloc = ctx.getLocalAlloc(expr.id);
      if (alloc) {
        const ty = llvmType(ctx, expr.type);
        return m.buildLoad(ty, alloc, "");
      }
      const captured = ctx.getCapturedLocal(expr.id);
      if (captured) {
        return emitCapturedLoad(ctx, captured, expr.type);
      }
      throw new Error(`unresolved local id ${expr.id}`);
    }
    case "local_set": {
      const val = emitExpr(ctx, expr.value);
      const alloc = ctx.getLocalAlloc(expr.id);
      if (alloc) {
        m.buildStore(val, alloc);
        return val;
      }
      const captured = ctx.getCapturedLocal(expr.id);
      if (captured) {
        emitCapturedStore(ctx, captured, val, expr.type);
        return val;
      }
      throw new Error(`unresolved local id ${expr.id}`);
    }
    case "global_get": {
      const g = ctx.getGlobal(expr.name);
      if (!g) throw new Error(`global_get: no alloc for "${expr.name}"`);
      const ty = llvmType(ctx, expr.type);
      return m.buildLoad(ty, g.alloc, "");
    }
    case "global_set": {
      const val = emitExpr(ctx, expr.value);
      const g = ctx.getGlobal(expr.name)!;
      m.buildStore(val, g.alloc);
      return val;
    }
    case "binary":
      return emitBinary(ctx, expr);
    case "unary":
      return emitUnary(ctx, expr);
    case "call":
      return emitCall(ctx, expr);
    case "runtime_call":
      return emitRuntimeCall(ctx, expr);
    case "conditional": {
      const fn = ctx.getCurrentFn();
      const condRaw = emitExpr(ctx, expr.condition);
      const cond = ensureI1(ctx, condRaw, expr.condition.type);

      const thenBlock = m.appendBlock(fn, "cond.then");
      const elseBlock = m.appendBlock(fn, "cond.else");
      const mergeBlock = m.appendBlock(fn, "cond.merge");

      m.buildCondBr(cond, thenBlock, elseBlock);

      m.positionAtEnd(thenBlock);
      const thenRaw = emitExpr(ctx, expr.then);
      const thenVal = coerceLLVM(ctx, thenRaw, expr.then.type, expr.type);
      const thenEndBlock = m.getInsertBlock();
      m.buildBr(mergeBlock);

      m.positionAtEnd(elseBlock);
      const elseRaw = emitExpr(ctx, expr.else);
      const elseVal = coerceLLVM(ctx, elseRaw, expr.else.type, expr.type);
      const elseEndBlock = m.getInsertBlock();
      m.buildBr(mergeBlock);

      m.positionAtEnd(mergeBlock);
      const ty = llvmType(ctx, expr.type);
      const phi = m.buildPhi(ty, "");
      m.addIncoming(phi, [thenVal, elseVal], [thenEndBlock, elseEndBlock]);
      return phi;
    }
    case "narrow_i64": {
      const val = emitExpr(ctx, expr.value);
      return m.buildFPToSI(val, m.i64, "");
    }
    case "widen_f64": {
      const val = emitExpr(ctx, expr.value);
      return m.buildSIToFP(val, m.f64, "");
    }
    case "alloc_array":
      return emitAllocArray(ctx, expr as HIRExpr & { kind: "alloc_array" });
    case "alloc_array_spread":
      return emitAllocArraySpread(ctx, expr as HIRExpr & { kind: "alloc_array_spread" });
    case "alloc_struct":
      return emitAllocStruct(ctx, expr as HIRExpr & { kind: "alloc_struct" });
    case "alloc_map":
      return emitAllocMap(ctx, expr as HIRExpr & { kind: "alloc_map" });
    case "alloc_set":
      return emitAllocSet(ctx, expr as HIRExpr & { kind: "alloc_set" });
    case "alloc_dynobj":
      return emitAllocDynObj(ctx, expr as HIRExpr & { kind: "alloc_dynobj" });
    case "alloc_dynarray":
      return emitAllocDynarray(ctx, expr as HIRExpr & { kind: "alloc_dynarray" });
    case "field_get":
      return emitFieldGet(ctx, expr as HIRExpr & { kind: "field_get" });
    case "field_set":
      return emitFieldSet(ctx, expr as HIRExpr & { kind: "field_set" });
    case "index_get":
      return emitIndexGet(ctx, expr as HIRExpr & { kind: "index_get" });
    case "index_set":
      return emitIndexSet(ctx, expr as HIRExpr & { kind: "index_set" });
    case "vtable_call":
      return emitVtableCall(ctx, expr as HIRExpr & { kind: "vtable_call" });
    case "wrap_interface":
      return emitWrapInterface(ctx, expr as HIRExpr & { kind: "wrap_interface" });
    case "make_closure":
      return emitMakeClosure(ctx, expr as HIRExpr & { kind: "make_closure" });
    case "call_closure":
      return emitCallClosure(ctx, expr as HIRExpr & { kind: "call_closure" });
    case "array_hof":
      return emitArrayHof(ctx, expr as HIRExpr & { kind: "array_hof" });
    case "nullish_coalesce":
      return emitNullishCoalesce(ctx, expr as HIRExpr & { kind: "nullish_coalesce" });
    case "await": {
      const awaitExpr = expr as HIRExpr & { kind: "await"; value: HIRExpr; resolvedType: HIRType };
      const promiseVal = emitExpr(ctx, awaitExpr.value);
      const getFn = promiseGetFn(awaitExpr.resolvedType);
      const decl = ctx.getDeclaredFunction(getFn)!;
      let result = m.buildCall(decl.fnType, decl.fn, [promiseVal], "awaited");
      if (awaitExpr.resolvedType.kind === "i1") {
        result = m.buildTrunc(result, m.i1, "");
      }
      return result;
    }
    case "box": {
      const inner = emitExpr(ctx, (expr as HIRExpr & { kind: "box" }).value);
      return emitBoxValue(ctx, inner, (expr as HIRExpr & { kind: "box" }).fromType);
    }
    case "unbox": {
      const inner = emitExpr(ctx, (expr as HIRExpr & { kind: "unbox" }).value);
      return emitUnboxValue(ctx, inner, (expr as HIRExpr & { kind: "unbox" }).toType);
    }
    case "promise_static":
      return emitPromiseStatic(
        ctx,
        expr as HIRExpr & {
          kind: "promise_static";
          method: "all" | "race" | "allSettled";
          promises: HIRExpr[];
          innerType: HIRType;
        },
      );
    default:
      return m.constInt(m.i64, 0);
  }
}

function emitFieldGet(ctx: EmitContext, expr: HIRExpr & { kind: "field_get" }): any {
  const m = ctx.m;
  const typeName = (expr.object.type as { kind: "ptr"; pointee: string }).pointee;
  const ifaceInfo = ctx.getInterfaceType(typeName);

  if (ifaceInfo) {
    const fatPtr = emitExpr(ctx, expr.object);
    const dataSlot = m.buildGEP(ifaceInfo.fatType, fatPtr, [m.constInt(m.i32, 0), m.constInt(m.i32, 0)], "");
    const dataPtr = m.buildLoad(m.ptr, dataSlot, "data");
    const fieldPtr = m.buildGEP(
      ifaceInfo.layoutType,
      dataPtr,
      [m.constInt(m.i32, 0), m.constInt(m.i32, expr.index)],
      "",
    );
    return m.buildLoad(llvmType(ctx, expr.type), fieldPtr, "");
  }

  const obj = emitExpr(ctx, expr.object);
  const structInfo = ctx.getStructType(typeName);
  if (!structInfo) throw new Error(`unknown struct type: ${typeName}`);

  const fieldPtr = m.buildGEP(
    structInfo.llvmType,
    obj,
    [m.constInt(m.i32, 0), m.constInt(m.i32, expr.index)],
    "",
  );
  return m.buildLoad(llvmType(ctx, expr.type), fieldPtr, "");
}

function emitFieldSet(ctx: EmitContext, expr: HIRExpr & { kind: "field_set" }): any {
  const m = ctx.m;
  const obj = emitExpr(ctx, expr.object);
  const val = emitExpr(ctx, expr.value);
  const className = (expr.object.type as { kind: "ptr"; pointee: string }).pointee;
  const structInfo = ctx.getStructType(className);
  if (!structInfo) throw new Error(`unknown struct type: ${className}`);

  const fieldPtr = m.buildGEP(
    structInfo.llvmType,
    obj,
    [m.constInt(m.i32, 0), m.constInt(m.i32, expr.index)],
    "",
  );
  m.buildStore(val, fieldPtr);
  return val;
}

function emitWrapInterface(ctx: EmitContext, expr: HIRExpr & { kind: "wrap_interface" }): any {
  const m = ctx.m;
  const dataPtr = emitExpr(ctx, expr.value);
  const ifaceInfo = ctx.getInterfaceType(expr.interfaceName);
  if (!ifaceInfo) throw new Error(`unknown interface type: ${expr.interfaceName}`);

  let vtablePtr: any;
  if (expr.className) {
    const vt = ctx.getVtable(`${expr.className}_${expr.interfaceName}`);
    if (!vt) throw new Error(`missing vtable: ${expr.className}_${expr.interfaceName}`);
    vtablePtr = vt;
  } else {
    vtablePtr = m.constNull(m.ptr);
  }

  const fat = m.buildAlloca(ifaceInfo.fatType, "fat");
  const dataSlot = m.buildGEP(ifaceInfo.fatType, fat, [m.constInt(m.i32, 0), m.constInt(m.i32, 0)], "");
  m.buildStore(dataPtr, dataSlot);
  const vtableSlot = m.buildGEP(ifaceInfo.fatType, fat, [m.constInt(m.i32, 0), m.constInt(m.i32, 1)], "");
  m.buildStore(vtablePtr, vtableSlot);
  return fat;
}

function emitVtableCall(ctx: EmitContext, expr: HIRExpr & { kind: "vtable_call" }): any {
  const m = ctx.m;
  const fatPtr = emitExpr(ctx, expr.object);

  const ifaceInfo = ctx.getInterfaceType(expr.interfaceName);
  if (!ifaceInfo) throw new Error(`unknown interface: ${expr.interfaceName}`);

  const dataSlot = m.buildGEP(ifaceInfo.fatType, fatPtr, [m.constInt(m.i32, 0), m.constInt(m.i32, 0)], "");
  const dataPtr = m.buildLoad(m.ptr, dataSlot, "data");
  const vtableSlot = m.buildGEP(ifaceInfo.fatType, fatPtr, [m.constInt(m.i32, 0), m.constInt(m.i32, 1)], "");
  const vtablePtr = m.buildLoad(m.ptr, vtableSlot, "vtable");

  const methodCount = ifaceInfo.iface.methods.length;
  const vtableArrTy = m.arrayType(m.ptr, methodCount);
  const fnPtrPtr = m.buildGEP(
    vtableArrTy,
    vtablePtr,
    [m.constInt(m.i32, 0), m.constInt(m.i32, expr.methodIndex)],
    "",
  );
  const fnPtr = m.buildLoad(m.ptr, fnPtrPtr, "fnptr");

  const methodDef = ifaceInfo.iface.methods[expr.methodIndex];
  const paramTypes = [m.ptr, ...methodDef.params.map((p) => llvmType(ctx, p.type))];
  const retType = llvmType(ctx, expr.returnType);
  const fnType = m.functionType(retType, paramTypes);

  const callArgs = [dataPtr, ...expr.args.map((a) => emitExpr(ctx, a))];
  return m.buildCall(fnType, fnPtr, callArgs, expr.returnType.kind === "void" ? "" : "vcall");
}

function emitIndexGet(ctx: EmitContext, expr: HIRExpr & { kind: "index_get" }): any {
  const m = ctx.m;
  const arr = emitExpr(ctx, expr.array);
  let idx = emitExpr(ctx, expr.index);
  if (expr.index.type.kind === "i64") {
    idx = m.buildTrunc(idx, m.i32, "");
  }
  const elemType =
    expr.array.type.kind === "array" ? (expr.array.type as any).element : { kind: "f64" };
  // Fast path for array<f64>: direct GEP+load, skip bounds-checked C call.
  // Layout: { data: f64*, length: i32, capacity: i32 } — data at offset 0.
  if (elemType.kind === "f64") {
    const dataPtr = m.buildLoad(m.ptr, arr, "");
    const elemPtr = m.buildGEP(m.f64, dataPtr, [idx], "");
    return m.buildLoad(m.f64, elemPtr, "");
  }
  const storagePrefix = elemType.kind === "i1" ? "cs2_num_array" : emitArrayPrefix(elemType);
  const getFn = `${storagePrefix}_get`;
  const decl = ctx.getDeclaredFunction(getFn)!;
  let result = m.buildCall(decl.fnType, decl.fn, [arr, idx], "");
  if (elemType.kind === "i1") {
    result = m.buildFCmp(LLVMRealONE, result, m.constReal(m.f64, 0.0), "");
  }
  return result;
}

function emitIndexSet(ctx: EmitContext, expr: HIRExpr & { kind: "index_set" }): any {
  const m = ctx.m;
  const arr = emitExpr(ctx, expr.array);
  let idx = emitExpr(ctx, expr.index);
  if (expr.index.type.kind === "i64") {
    idx = m.buildTrunc(idx, m.i32, "");
  }
  let val = emitExpr(ctx, expr.value);
  const elemType =
    expr.array.type.kind === "array" ? (expr.array.type as any).element : { kind: "f64" };
  const storagePrefix = elemType.kind === "i1" ? "cs2_num_array" : emitArrayPrefix(elemType);
  if (elemType.kind === "i1") {
    const ext = m.buildZExt(val, m.i64, "");
    val = m.buildSIToFP(ext, m.f64, "");
  }
  const setFn = `${storagePrefix}_set`;
  const decl = ctx.getDeclaredFunction(setFn)!;
  m.buildCall(decl.fnType, decl.fn, [arr, idx, val], "");
  return val;
}

function emitCall(ctx: EmitContext, expr: HIRExpr & { kind: "call" }): any {
  const m = ctx.m;
  const args = expr.args.map((a) => emitExpr(ctx, a));
  const decl = ctx.getDeclaredFunction(expr.callee);
  if (!decl) throw new Error(`undeclared function: ${expr.callee}`);
  return m.buildCall(decl.fnType, decl.fn, args, expr.returnType.kind === "void" ? "" : "");
}

function emitBinary(ctx: EmitContext, expr: HIRExpr & { kind: "binary" }): any {
  const m = ctx.m;

  if (expr.op === "and" || expr.op === "or") {
    return emitShortCircuit(ctx, expr);
  }

  if (expr.op === "str_eq" || expr.op === "str_ne") {
    return emitStringCompare(ctx, expr);
  }

  if (expr.left.type.kind === "boxed" || expr.right.type.kind === "boxed") {
    return emitBoxedBinary(ctx, expr);
  }

  const left = emitExpr(ctx, expr.left);
  const right = emitExpr(ctx, expr.right);
  const isFloat = expr.left.type.kind === "f64";

  // f64 compared to undefined (literal_null with ptr type): use NaN-check semantics
  // undefined maps to NaN in f64 space; fcmp ORD/UNO with self detects NaN
  if (isFloat && expr.right.kind === "literal_null") {
    if (expr.op === "ne") return m.buildFCmp(LLVMRealORD, left, left, "");
    if (expr.op === "eq") return m.buildFCmp(LLVMRealUNO, left, left, "");
  }
  if (isFloat && expr.left.kind === "literal_null") {
    if (expr.op === "ne") return m.buildFCmp(LLVMRealORD, right, right, "");
    if (expr.op === "eq") return m.buildFCmp(LLVMRealUNO, right, right, "");
  }

  switch (expr.op) {
    case "add":
      return isFloat ? m.buildFAdd(left, right, "") : m.buildAdd(left, right, "");
    case "sub":
      return isFloat ? m.buildFSub(left, right, "") : m.buildSub(left, right, "");
    case "mul":
      return isFloat ? m.buildFMul(left, right, "") : m.buildMul(left, right, "");
    case "div":
      return isFloat ? m.buildFDiv(left, right, "") : m.buildSDiv(left, right, "");
    case "rem":
      return isFloat ? m.buildFRem(left, right, "") : m.buildSRem(left, right, "");
    case "eq":
      return isFloat
        ? m.buildFCmp(LLVMRealOEQ, left, right, "")
        : m.buildICmp(LLVMIntEQ, left, right, "");
    case "ne":
      return isFloat
        ? m.buildFCmp(LLVMRealONE, left, right, "")
        : m.buildICmp(LLVMIntNE, left, right, "");
    case "lt":
      return isFloat
        ? m.buildFCmp(LLVMRealOLT, left, right, "")
        : m.buildICmp(LLVMIntSLT, left, right, "");
    case "le":
      return isFloat
        ? m.buildFCmp(LLVMRealOLE, left, right, "")
        : m.buildICmp(LLVMIntSLE, left, right, "");
    case "gt":
      return isFloat
        ? m.buildFCmp(LLVMRealOGT, left, right, "")
        : m.buildICmp(LLVMIntSGT, left, right, "");
    case "ge":
      return isFloat
        ? m.buildFCmp(LLVMRealOGE, left, right, "")
        : m.buildICmp(LLVMIntSGE, left, right, "");
    case "bit_and":
    case "bit_or":
    case "bit_xor":
    case "shl":
    case "shr":
    case "ushr": {
      const l32 = m.buildTrunc(left, m.i32, "");
      const r32 = m.buildTrunc(right, m.i32, "");
      let res32: any;
      switch (expr.op) {
        case "bit_and":
          res32 = m.buildAnd(l32, r32, "");
          break;
        case "bit_or":
          res32 = m.buildOr(l32, r32, "");
          break;
        case "bit_xor":
          res32 = m.buildXor(l32, r32, "");
          break;
        case "shl":
          res32 = m.buildShl(l32, r32, "");
          break;
        case "shr":
          res32 = m.buildAShr(l32, r32, "");
          break;
        case "ushr":
          res32 = m.buildLShr(l32, r32, "");
          break;
      }
      return m.buildSExt(res32, m.i64, "");
    }
    default:
      throw new Error(`unhandled binary op: ${expr.op}`);
  }
}

function emitBoxedBinary(ctx: EmitContext, expr: HIRExpr & { kind: "binary" }): any {
  const m = ctx.m;
  let left = emitExpr(ctx, expr.left);
  let right = emitExpr(ctx, expr.right);
  if (expr.left.type.kind !== "boxed") left = emitBoxValue(ctx, left, expr.left.type);
  if (expr.right.type.kind !== "boxed") right = emitBoxValue(ctx, right, expr.right.type);

  const fnMap: Record<string, string> = {
    add: "nanbox_add",
    sub: "nanbox_sub",
    mul: "nanbox_mul",
    div: "nanbox_div",
    rem: "nanbox_rem",
    eq: "nanbox_eq",
    ne: "nanbox_ne",
    lt: "nanbox_lt",
    le: "nanbox_le",
    gt: "nanbox_gt",
    ge: "nanbox_ge",
  };

  const fname = fnMap[expr.op];
  if (!fname) throw new Error(`unsupported boxed binary op: ${expr.op}`);

  const decl = ctx.getDeclaredFunction(fname)!;
  const result = m.buildCall(decl.fnType, decl.fn, [left, right], "");

  if (["eq", "ne", "lt", "le", "gt", "ge"].includes(expr.op)) {
    return m.buildTrunc(result, m.i1, "");
  }
  return result;
}

function emitStringCompare(ctx: EmitContext, expr: HIRExpr & { kind: "binary" }): any {
  const m = ctx.m;
  const left = emitExpr(ctx, expr.left);
  const right = emitExpr(ctx, expr.right);
  const strcmp = ctx.getDeclaredFunction("strcmp")!;
  const result = m.buildCall(strcmp.fnType, strcmp.fn, [left, right], "");
  if (expr.op === "str_eq") {
    return m.buildICmp(LLVMIntEQ, result, m.constInt(m.i32, 0), "");
  }
  return m.buildICmp(LLVMIntNE, result, m.constInt(m.i32, 0), "");
}

function emitShortCircuit(ctx: EmitContext, expr: HIRExpr & { kind: "binary" }): any {
  const m = ctx.m;
  const fn = ctx.getCurrentFn();
  const isBoolean = expr.type.kind === "i1";

  const leftRaw = emitExpr(ctx, expr.left);
  const leftCond = ensureI1(ctx, leftRaw, expr.left.type);
  const leftCoerced = isBoolean
    ? (expr.op === "or" ? m.constInt(m.i1, 1) : m.constInt(m.i1, 0))
    : coerceLLVM(ctx, leftRaw, expr.left.type, expr.type);
  const leftBlock = m.getInsertBlock();

  const rhsBlock = m.appendBlock(fn, "sc.rhs");
  const mergeBlock = m.appendBlock(fn, "sc.merge");

  if (expr.op === "and") {
    m.buildCondBr(leftCond, rhsBlock, mergeBlock);
  } else {
    m.buildCondBr(leftCond, mergeBlock, rhsBlock);
  }

  m.positionAtEnd(rhsBlock);
  const rightRaw = emitExpr(ctx, expr.right);
  const rightCond = ensureI1(ctx, rightRaw, expr.right.type);
  const rightCoerced = isBoolean
    ? rightCond
    : coerceLLVM(ctx, rightRaw, expr.right.type, expr.type);
  const rhsEndBlock = m.getInsertBlock();
  m.buildBr(mergeBlock);

  m.positionAtEnd(mergeBlock);

  if (isBoolean) {
    const phi = m.buildPhi(m.i1, "");
    if (expr.op === "and") {
      m.addIncoming(phi, [rightCond, m.constInt(m.i1, 0)], [rhsEndBlock, leftBlock]);
    } else {
      m.addIncoming(phi, [rightCond, m.constInt(m.i1, 1)], [rhsEndBlock, leftBlock]);
    }
    return phi;
  }

  const ty = llvmType(ctx, expr.type);
  const phi = m.buildPhi(ty, "");
  m.addIncoming(phi, [rightCoerced, leftCoerced], [rhsEndBlock, leftBlock]);
  return phi;
}

function emitUnary(ctx: EmitContext, expr: HIRExpr & { kind: "unary" }): any {
  const m = ctx.m;
  const operand = emitExpr(ctx, expr.operand);

  if (expr.operand.type.kind === "boxed") {
    switch (expr.op) {
      case "typeof": {
        const fn = ctx.getDeclaredFunction("nanbox_typeof")!;
        return m.buildCall(fn.fnType, fn.fn, [operand], "");
      }
      case "neg": {
        const fn = ctx.getDeclaredFunction("nanbox_neg")!;
        return m.buildCall(fn.fnType, fn.fn, [operand], "");
      }
      case "not": {
        const fn = ctx.getDeclaredFunction("nanbox_truthy")!;
        const truthy = m.buildCall(fn.fnType, fn.fn, [operand], "");
        return m.buildICmp(LLVMIntEQ, truthy, m.constInt(m.i32, 0), "");
      }
      default:
        throw new Error(`unsupported unary op on boxed: ${expr.op}`);
    }
  }

  switch (expr.op) {
    case "neg":
      return expr.operand.type.kind === "f64" ? m.buildFNeg(operand, "") : m.buildNeg(operand, "");
    case "not": {
      const boolVal = ensureI1(ctx, operand, expr.operand.type);
      return m.buildXor(boolVal, m.constInt(m.i1, 1), "");
    }
    case "bit_not":
      return m.buildNot(operand, "");
    case "typeof": {
      const typeStr =
        expr.operand.type.kind === "f64" || expr.operand.type.kind === "i64"
          ? "number"
          : expr.operand.type.kind === "i8ptr"
            ? "string"
            : expr.operand.type.kind === "i1"
              ? "boolean"
              : expr.operand.type.kind === "ptr"
                ? "object"
                : "undefined";
      return m.buildGlobalStringPtr(typeStr, "typeof_str");
    }
    default:
      throw new Error(`unhandled unary op: ${expr.op}`);
  }
}


function emitMakeClosure(ctx: EmitContext, expr: HIRExpr & { kind: "make_closure" }): any {
  const m = ctx.m;
  const closureTy = ctx.getClosureType();

  const fnDecl = ctx.getDeclaredFunction(expr.funcName);
  if (!fnDecl) throw new Error(`undeclared closure function: ${expr.funcName}`);
  const fnPtr = m.buildBitCast(fnDecl.fn, m.ptr, "fn_ptr");

  const envAlloc = ctx.getEnvAlloc();
  const envPtr = envAlloc ? m.buildLoad(m.ptr, envAlloc, "env") : m.constNull(m.ptr);

  const mallocDecl = ctx.getDeclaredFunction("malloc")!;
  const closureSize = m.constInt(m.i64, 16);
  const rawPtr = m.buildCall(mallocDecl.fnType, mallocDecl.fn, [closureSize], "closure_raw");

  const fnSlot = m.buildGEP(m.i8, rawPtr, [m.constInt(m.i64, 0)], "fn_slot");
  m.buildStore(fnPtr, fnSlot);
  const envSlot = m.buildGEP(m.i8, rawPtr, [m.constInt(m.i64, 8)], "env_slot");
  m.buildStore(envPtr, envSlot);

  return rawPtr;
}

function emitCallClosure(ctx: EmitContext, expr: HIRExpr & { kind: "call_closure" }): any {
  const m = ctx.m;
  const closurePtr = emitExpr(ctx, expr.callee);

  const fnSlot = m.buildGEP(m.i8, closurePtr, [m.constInt(m.i64, 0)], "fn_slot");
  const fnPtr = m.buildLoad(m.ptr, fnSlot, "fn_ptr");
  const envSlot = m.buildGEP(m.i8, closurePtr, [m.constInt(m.i64, 8)], "env_slot");
  const envPtr = m.buildLoad(m.ptr, envSlot, "env_ptr");

  const argVals = expr.args.map((a) => emitExpr(ctx, a));
  const allArgs = [envPtr, ...argVals];

  const paramTypes = [m.ptr, ...expr.args.map((a) => llvmType(ctx, a.type))];
  const retType = llvmType(ctx, expr.returnType);
  const fnType = m.functionType(retType, paramTypes);

  return m.buildCall(fnType, fnPtr, allArgs, expr.returnType.kind === "void" ? "" : "");
}


function emitNullishCoalesce(ctx: EmitContext, expr: HIRExpr & { kind: "nullish_coalesce" }): any {
  const m = ctx.m;
  const fn = ctx.getCurrentFn();

  const leftVal = emitExpr(ctx, expr.left);
  const leftBlock = m.getInsertBlock();

  const isNull = m.buildICmp(LLVMIntEQ, leftVal, m.constNull(m.ptr), "is_null");

  const rhsBlock = m.appendBlock(fn, "nc.rhs");
  const mergeBlock = m.appendBlock(fn, "nc.merge");

  m.buildCondBr(isNull, rhsBlock, mergeBlock);

  m.positionAtEnd(rhsBlock);
  const rightRaw = emitExpr(ctx, expr.right);
  const rightVal = coerceLLVM(ctx, rightRaw, expr.right.type, expr.type);
  const rhsEndBlock = m.getInsertBlock();
  m.buildBr(mergeBlock);

  m.positionAtEnd(mergeBlock);
  const ty = llvmType(ctx, expr.type);
  const phi = m.buildPhi(ty, "nc");
  const leftCoerced = coerceLLVM(ctx, leftVal, expr.left.type, expr.type);
  m.addIncoming(phi, [rightVal, leftCoerced], [rhsEndBlock, leftBlock]);
  return phi;
}

export function ensureI1(ctx: EmitContext, val: any, hirType: HIRType): any {
  const m = ctx.m;
  switch (hirType.kind) {
    case "i1":
      return val;
    case "f64":
      return m.buildFCmp(LLVMRealONE, val, m.constReal(m.f64, 0.0), "");
    case "i64":
      return m.buildICmp(LLVMIntNE, val, m.constInt(m.i64, 0), "");
    case "i8ptr":
    case "dynobj":
    case "dynarray":
    case "map":
    case "set":
    case "array":
    case "struct":
    case "closure":
    case "promise":
    case "regex":
      return m.buildICmp(LLVMIntNE, val, m.constNull(m.ptr), "");
    case "ptr":
      return m.buildICmp(LLVMIntNE, val, m.constNull(m.ptr), "");
    case "boxed": {
      const fn = ctx.getDeclaredFunction("nanbox_truthy")!;
      const result = m.buildCall(fn.fnType, fn.fn, [val], "");
      return m.buildICmp(LLVMIntNE, result, m.constInt(m.i32, 0), "");
    }
    default:
      return val;
  }
}
