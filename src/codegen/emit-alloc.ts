import type { HIRExpr, HIRType } from "../hir/types.js";
import { EmitContext } from "./emit-context.js";
import { emitExpr } from "./emit-expr.js";

export function emitArrayPrefix(elemType: HIRType): string {
  if (elemType.kind === "i8ptr") return "cs2_str_array";
  if (elemType.kind === "ptr" || elemType.kind === "dynobj" || elemType.kind === "dynarray" || elemType.kind === "map" || elemType.kind === "boxed" || elemType.kind === "array") return "cs2_obj_array";
  return "cs2_num_array";
}

export function emitAllocArray(ctx: EmitContext, expr: HIRExpr & { kind: "alloc_array" }): any {
  const m = ctx.m;
  const prefix = emitArrayPrefix(expr.elementType);
  const newFn = `${prefix}_new`;
  const pushFn = `${prefix}_push`;

  const capacity = Math.max(expr.initialValues.length, 4);
  const newDecl = ctx.getDeclaredFunction(newFn)!;
  const arr = m.buildCall(newDecl.fnType, newDecl.fn, [m.constInt(m.i32, capacity)], "arr");

  if (expr.initialValues.length > 0) {
    const pushDecl = ctx.getDeclaredFunction(pushFn)!;
    for (const valExpr of expr.initialValues) {
      const v = emitExpr(ctx, valExpr);
      m.buildCall(pushDecl.fnType, pushDecl.fn, [arr, v], "");
    }
  }

  return arr;
}

export function emitAllocDynarray(ctx: EmitContext, expr: HIRExpr & { kind: "alloc_dynarray" }): any {
  const m = ctx.m;
  const newDecl = ctx.getDeclaredFunction("cs2_dynarray_new")!;
  const pushDecl = ctx.getDeclaredFunction("cs2_dynarray_push_boxed")!;
  const arr = m.buildCall(newDecl.fnType, newDecl.fn, [], "dynarr");
  for (const valExpr of expr.initialValues) {
    const v = emitExpr(ctx, valExpr);
    m.buildCall(pushDecl.fnType, pushDecl.fn, [arr, v], "");
  }
  return arr;
}

export function emitAllocArraySpread(
  ctx: EmitContext,
  expr: HIRExpr & { kind: "alloc_array_spread" },
): any {
  const m = ctx.m;
  const prefix = emitArrayPrefix(expr.elementType);
  const newDecl = ctx.getDeclaredFunction(`${prefix}_new`)!;
  const pushDecl = ctx.getDeclaredFunction(`${prefix}_push`)!;
  const spreadDecl = ctx.getDeclaredFunction(`${prefix}_spread`)!;

  const arr = m.buildCall(newDecl.fnType, newDecl.fn, [m.constInt(m.i32, 4)], "arr");

  for (const el of expr.elements) {
    if (el.spread) {
      const src = emitExpr(ctx, el.value);
      m.buildCall(spreadDecl.fnType, spreadDecl.fn, [arr, src], "");
    } else {
      const v = emitExpr(ctx, el.value);
      m.buildCall(pushDecl.fnType, pushDecl.fn, [arr, v], "");
    }
  }

  return arr;
}

function isAtomicType(t: HIRType): boolean {
  return t.kind === "f64" || t.kind === "i64" || t.kind === "i1";
}

export function emitAllocStruct(ctx: EmitContext, expr: HIRExpr & { kind: "alloc_struct" }): any {
  const m = ctx.m;
  const structInfo = ctx.getStructType(expr.structName);
  if (!structInfo) throw new Error(`unknown struct type: ${expr.structName}`);

  const size = m.sizeOf(structInfo.llvmType);
  const allFieldsAtomic = expr.fields.every((f) => isAtomicType(f.type));
  const allocName = allFieldsAtomic ? "malloc_atomic" : "malloc";
  const malloc = ctx.getDeclaredFunction(allocName)!;
  const raw = m.buildCall(malloc.fnType, malloc.fn, [size], "obj");

  for (let i = 0; i < expr.fields.length; i++) {
    const val = emitExpr(ctx, expr.fields[i]);
    const fieldPtr = m.buildGEP(
      structInfo.llvmType,
      raw,
      [m.constInt(m.i32, 0), m.constInt(m.i32, i)],
      "",
    );
    m.buildStore(val, fieldPtr);
  }

  const ifaceInfo = ctx.getInterfaceType(expr.structName);
  if (ifaceInfo) {
    const fatSize = m.sizeOf(ifaceInfo.fatType);
    const fat = m.buildCall(malloc.fnType, malloc.fn, [fatSize], "fat");
    const dataSlot = m.buildGEP(ifaceInfo.fatType, fat, [m.constInt(m.i32, 0), m.constInt(m.i32, 0)], "");
    m.buildStore(raw, dataSlot);
    const vtableSlot = m.buildGEP(ifaceInfo.fatType, fat, [m.constInt(m.i32, 0), m.constInt(m.i32, 1)], "");
    m.buildStore(m.constNull(m.ptr), vtableSlot);
    return fat;
  }

  return raw;
}

export function emitAllocMap(
  ctx: EmitContext,
  expr: HIRExpr & { kind: "alloc_map" },
): any {
  const m = ctx.m;
  const k = expr.keyType.kind === "i8ptr" ? "str" : "num";
  const primitiveVal = expr.valueType.kind === "i8ptr" || expr.valueType.kind === "f64" || expr.valueType.kind === "i64" || expr.valueType.kind === "i1";
  const v = expr.valueType.kind === "i8ptr" ? "str" : primitiveVal ? "num" : "ptr";
  const prefix = `cs2_${k}_${v}_map`;

  let mapPtr: any;
  if (expr.spreadSource) {
    const src = emitExpr(ctx, expr.spreadSource);
    const copyFn = ctx.getDeclaredFunction(`${prefix}_copy`)!;
    mapPtr = m.buildCall(copyFn.fnType, copyFn.fn, [src], "map");
  } else {
    const newFn = ctx.getDeclaredFunction(`${prefix}_new`)!;
    mapPtr = m.buildCall(newFn.fnType, newFn.fn, [], "map");
  }

  const setFn = ctx.getDeclaredFunction(`${prefix}_set`)!;
  for (const entry of expr.entries) {
    const key = emitExpr(ctx, entry.key);
    const val = emitExpr(ctx, entry.value);
    m.buildCall(setFn.fnType, setFn.fn, [mapPtr, key, val], "");
  }

  return mapPtr;
}

export function emitAllocSet(
  ctx: EmitContext,
  expr: HIRExpr & { kind: "alloc_set" },
): any {
  const m = ctx.m;
  const e = expr.element.kind === "i8ptr" ? "str" : "num";
  const prefix = `cs2_${e}_set`;

  const newFn = ctx.getDeclaredFunction(`${prefix}_new`)!;
  const setPtr = m.buildCall(newFn.fnType, newFn.fn, [], "set");

  const addFn = ctx.getDeclaredFunction(`${prefix}_add`)!;
  for (const elem of expr.elements) {
    const val = emitExpr(ctx, elem);
    m.buildCall(addFn.fnType, addFn.fn, [setPtr, val], "");
  }

  return setPtr;
}

function dynObjSetFunc(ctx: EmitContext, valueType: HIRType): { fn: any; fnType: any } | null {
  switch (valueType.kind) {
    case "f64":
      return ctx.getDeclaredFunction("cs2_dynobj_set_f64")!;
    case "i64":
      return ctx.getDeclaredFunction("cs2_dynobj_set_f64")!;
    case "i8ptr":
      return ctx.getDeclaredFunction("cs2_dynobj_set_str")!;
    case "i1":
      return ctx.getDeclaredFunction("cs2_dynobj_set_bool")!;
    case "dynobj":
    case "ptr":
    case "map":
    case "set":
      return ctx.getDeclaredFunction("cs2_dynobj_set_obj")!;
    case "dynarray":
    case "array":
      return ctx.getDeclaredFunction("cs2_dynobj_set_arr")!;
    case "boxed":
      return ctx.getDeclaredFunction("cs2_dynobj_set_boxed")!;
    default:
      return null;
  }
}

export function emitAllocDynObj(
  ctx: EmitContext,
  expr: HIRExpr & { kind: "alloc_dynobj" },
): any {
  const m = ctx.m;
  let objPtr: any;

  if (expr.spreadSource) {
    const src = emitExpr(ctx, expr.spreadSource);
    const copyFn = ctx.getDeclaredFunction("cs2_dynobj_copy");
    if (copyFn) {
      objPtr = m.buildCall(copyFn.fnType, copyFn.fn, [src], "obj");
    } else {
      const newFn = ctx.getDeclaredFunction("cs2_dynobj_new")!;
      objPtr = m.buildCall(newFn.fnType, newFn.fn, [], "obj");
    }
  } else {
    const newFn = ctx.getDeclaredFunction("cs2_dynobj_new")!;
    objPtr = m.buildCall(newFn.fnType, newFn.fn, [], "obj");
  }

  for (const prop of expr.props) {
    const keyVal = m.buildGlobalStringPtr(prop.key, "");
    let val = emitExpr(ctx, prop.value);
    let valType = prop.value.type;
    if (valType.kind === "array") {
      const elKind = (valType as any).element?.kind;
      let convName: string | null = null;
      if (elKind === "i8ptr") convName = "cs2_dynarray_from_str_array";
      else if (elKind === "f64" || elKind === "i64") convName = "cs2_dynarray_from_num_array";
      else if (elKind === "boxed") convName = "cs2_dynarray_from_boxed_array";
      else if (elKind === "ptr" || elKind === "dynobj" || elKind === "dynarray" || elKind === "map" || elKind === "array") convName = "cs2_dynarray_from_obj_array";
      if (convName) {
        const conv = ctx.getDeclaredFunction(convName)!;
        val = m.buildCall(conv.fnType, conv.fn, [val], "darr");
        valType = { kind: "dynarray" };
      }
    }
    const setFn = dynObjSetFunc(ctx, valType);
    if (setFn) {
      if (valType.kind === "i64") {
        const asF64 = m.buildSIToFP(val, m.f64, "");
        m.buildCall(setFn.fnType, setFn.fn, [objPtr, keyVal, asF64], "");
      } else if (valType.kind === "i1") {
        const asI32 = m.buildZExt(val, m.i32, "");
        m.buildCall(setFn.fnType, setFn.fn, [objPtr, keyVal, asI32], "");
      } else {
        m.buildCall(setFn.fnType, setFn.fn, [objPtr, keyVal, val], "");
      }
    }
  }

  return objPtr;
}
