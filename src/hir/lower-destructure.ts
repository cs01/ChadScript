import type { HIRExpr, HIRType, HIRStmt } from "./types.js";
import { F64, I64, I1, I8PTR, DYNOBJ, DYNARRAY } from "./types.js";
import { compileError } from "../errors.js";
import {
  locals,
  classRegistry,
  freshId,
  resolveObjectDestructProps,
} from "./lower-state.js";
import { lowerExpr } from "./lower-expr.js";

export function lowerArrayDestructuring(d: any, mutable: boolean): HIRStmt[] {
  const stmts: HIRStmt[] = [];
  if (!d.init) compileError("array destructuring requires initializer", d.span);

  const initExpr = lowerExpr(d.init);
  if (initExpr.type.kind !== "array")
    compileError("array destructuring requires array type", d.span);

  const arrType = initExpr.type as { kind: "array"; element: HIRType };
  const elemType = arrType.element;

  const tmpId = freshId();
  const tmpName = `__destruct_${tmpId}`;
  locals.set(tmpName, { id: tmpId, type: initExpr.type, mutable: false });
  stmts.push({
    kind: "let",
    id: tmpId,
    name: tmpName,
    type: initExpr.type,
    init: initExpr,
    mutable: false,
  } as HIRStmt);

  const elements: any[] = d.id.elements;
  for (let i = 0; i < elements.length; i++) {
    const elem = elements[i];
    if (elem === null) continue;
    if (elem.type !== "Identifier")
      compileError(`unsupported destructuring element: ${elem.type}`, elem.span);

    const elemId = freshId();
    const indexGet: HIRExpr = {
      kind: "index_get",
      array: { kind: "local_get", id: tmpId, type: initExpr.type },
      index: { kind: "literal_i64", value: i, type: I64 },
      type: elemType,
    };

    locals.set(elem.value, { id: elemId, type: elemType, mutable });
    stmts.push({
      kind: "let",
      id: elemId,
      name: elem.value,
      type: elemType,
      init: indexGet,
      mutable,
    } as HIRStmt);
  }

  return stmts;
}

export function dynObjGetForType(obj: HIRExpr, key: HIRExpr, targetType: HIRType): HIRExpr {
  switch (targetType.kind) {
    case "f64":
    case "i64":
      return {
        kind: "runtime_call",
        func: "cs2_dynobj_get_f64",
        args: [obj, key],
        returnType: F64,
        type: F64,
      };
    case "i8ptr":
      return {
        kind: "runtime_call",
        func: "cs2_dynobj_get_str",
        args: [obj, key],
        returnType: I8PTR,
        type: I8PTR,
      };
    case "i1":
      return {
        kind: "runtime_call",
        func: "cs2_dynobj_get_bool",
        args: [obj, key],
        returnType: I1,
        type: I1,
      };
    case "dynarray":
      return {
        kind: "runtime_call",
        func: "cs2_dynobj_get_arr",
        args: [obj, key],
        returnType: DYNARRAY,
        type: DYNARRAY,
      };
    case "dynobj":
      return {
        kind: "runtime_call",
        func: "cs2_dynobj_get_obj",
        args: [obj, key],
        returnType: DYNOBJ,
        type: DYNOBJ,
      };
    default:
      return {
        kind: "runtime_call",
        func: "cs2_dynobj_get_obj",
        args: [obj, key],
        returnType: DYNOBJ,
        type: DYNOBJ,
      };
  }
}

export function lowerObjectDestructuring(d: any, mutable: boolean): HIRStmt[] {
  const stmts: HIRStmt[] = [];
  if (!d.init) compileError("object destructuring requires initializer", d.span);

  const initExpr = lowerExpr(d.init);

  if (initExpr.type.kind === "dynobj") {
    const props =
      (initExpr.type as { kind: "dynobj"; props?: { name: string; type: HIRType }[] }).props || [];
    const tmpId = freshId();
    const tmpName = `__destruct_${tmpId}`;
    locals.set(tmpName, { id: tmpId, type: initExpr.type, mutable: false });
    stmts.push({
      kind: "let",
      id: tmpId,
      name: tmpName,
      type: initExpr.type,
      init: initExpr,
      mutable: false,
    } as HIRStmt);

    for (const { fieldName, localName, span } of resolveObjectDestructProps(d.id.properties)) {
      const propInfo = props.find((p) => p.name === fieldName);
      let propType = propInfo ? propInfo.type : DYNOBJ;
      if (propType.kind === "i64") propType = F64;
      const elemId = freshId();
      const key: HIRExpr = { kind: "literal_string", value: fieldName, type: I8PTR };
      const fieldGet = dynObjGetForType(
        { kind: "local_get", id: tmpId, type: initExpr.type },
        key,
        propType,
      );

      locals.set(localName, { id: elemId, type: propType, mutable });
      stmts.push({
        kind: "let",
        id: elemId,
        name: localName,
        type: propType,
        init: fieldGet,
        mutable,
      } as HIRStmt);
    }

    return stmts;
  }

  if (initExpr.type.kind !== "ptr")
    compileError("object destructuring requires struct/class/object type", d.span);

  const typeName = (initExpr.type as { kind: "ptr"; pointee: string }).pointee;
  const classInfo = classRegistry.get(typeName);
  if (!classInfo) compileError(`object destructuring: unknown class '${typeName}'`, d.span);

  const tmpId = freshId();
  const tmpName = `__destruct_${tmpId}`;
  locals.set(tmpName, { id: tmpId, type: initExpr.type, mutable: false });
  stmts.push({
    kind: "let",
    id: tmpId,
    name: tmpName,
    type: initExpr.type,
    init: initExpr,
    mutable: false,
  } as HIRStmt);

  for (const { fieldName, localName, span } of resolveObjectDestructProps(d.id.properties)) {
    const fieldIdx = classInfo!.fields.findIndex((f) => f.name === fieldName);
    if (fieldIdx < 0) compileError(`property '${fieldName}' does not exist on '${typeName}'`, span);

    const field = classInfo!.fields[fieldIdx];
    const elemId = freshId();
    const fieldGet: HIRExpr = {
      kind: "field_get",
      object: { kind: "local_get", id: tmpId, type: initExpr.type },
      fieldName,
      index: fieldIdx,
      type: field.type,
    };

    locals.set(localName, { id: elemId, type: field.type, mutable });
    stmts.push({
      kind: "let",
      id: elemId,
      name: localName,
      type: field.type,
      init: fieldGet,
      mutable,
    } as HIRStmt);
  }

  return stmts;
}
