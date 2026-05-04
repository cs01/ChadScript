import type { HIRExpr, HIRType, HIRStmt } from "./types.js";
import { F64, I64, I1, I8PTR, BOXED, DYNOBJ, DYNARRAY } from "./types.js";
import { compileError } from "../errors.js";
import {
  locals,
  freshId,
  coerce,
  arrayPrefix,
  mapPrefix,
  setPrefix,
} from "./lower-state.js";
import { lowerExpr } from "./lower-expr.js";

type LowerConsequent = (stmt: any) => HIRStmt[];

export function lowerForOf(stmt: any, lowerConsequent: LowerConsequent): HIRStmt[] {
  let iteree = lowerExpr(stmt.right);

  if (iteree.type.kind === "boxed") {
    iteree = coerce(iteree, DYNARRAY);
  }

  if (iteree.type.kind === "map") {
    return lowerForOfMap(stmt, iteree, lowerConsequent);
  }

  if (iteree.type.kind === "dynarray" || iteree.type.kind === "dynobj") {
    return lowerForOfDynarray(stmt, iteree, lowerConsequent);
  }

  if (iteree.type.kind !== "array") {
    compileError(`for...of requires array or map type, got ${iteree.type.kind}`, stmt.span);
  }

  const elemType = (iteree.type as { kind: "array"; element: HIRType }).element;
  const lenFn = `${arrayPrefix(elemType)}_length`;

  const iId = freshId();
  const arrId = freshId();
  locals.set("__forof_arr", { id: arrId, type: iteree.type, mutable: false });
  locals.set("__forof_i", { id: iId, type: I64, mutable: true });

  const arrStore: HIRStmt = {
    kind: "let",
    id: arrId,
    name: "__forof_arr",
    type: iteree.type,
    init: iteree,
    mutable: false,
  };
  const iInit: HIRStmt = {
    kind: "let",
    id: iId,
    name: "__forof_i",
    type: I64,
    init: { kind: "literal_i64", value: 0, type: I64 },
    mutable: true,
  };

  const lenExpr: HIRExpr = {
    kind: "runtime_call",
    func: lenFn,
    args: [{ kind: "local_get", id: arrId, type: iteree.type }],
    returnType: I64,
    type: I64,
  };

  const condition: HIRExpr = {
    kind: "binary",
    op: "lt",
    left: { kind: "local_get", id: iId, type: I64 },
    right: lenExpr,
    type: I1,
  };

  const indexGet: HIRExpr = {
    kind: "index_get",
    array: { kind: "local_get", id: arrId, type: iteree.type },
    index: { kind: "local_get", id: iId, type: I64 },
    type: elemType,
  };

  const varDecl = stmt.left;
  const declId = varDecl.declarations[0].id;
  const elemId = freshId();
  const bodyStmts: HIRStmt[] = [];

  if (declId.type === "ObjectPattern") {
    locals.set("__forof_elem", { id: elemId, type: elemType, mutable: false });
    bodyStmts.push({ kind: "let", id: elemId, name: "__forof_elem", type: elemType, init: indexGet, mutable: false });
    const elemGetExpr: HIRExpr = { kind: "local_get", id: elemId, type: elemType };
    const props = (elemType as any).props as { name: string; type: HIRType }[] | undefined;
    for (const prop of declId.properties) {
      const fieldName: string = prop.key?.value ?? prop.value?.value;
      const localName: string = prop.value?.value ?? fieldName;
      const propInfo = props?.find((p: { name: string }) => p.name === fieldName);
      const propType: HIRType = propInfo?.type ?? BOXED;
      const propId = freshId();
      locals.set(localName, { id: propId, type: propType, mutable: false });
      const func = propType.kind === "i8ptr" ? "cs2_dynobj_get_str"
                 : propType.kind === "f64" || propType.kind === "i64" ? "cs2_dynobj_get_f64"
                 : propType.kind === "i1" ? "cs2_dynobj_get_bool"
                 : "cs2_dynobj_get_obj";
      const retType = propType.kind === "i8ptr" ? I8PTR
                    : propType.kind === "f64" || propType.kind === "i64" ? F64
                    : propType.kind === "i1" ? I1
                    : propType;
      const dynInit: HIRExpr = elemType.kind === "dynobj" || elemType.kind === "boxed"
        ? { kind: "runtime_call", func, args: [elemGetExpr, { kind: "literal_string", value: fieldName, type: I8PTR }], returnType: retType, type: retType }
        : { kind: "runtime_call", func, args: [elemGetExpr, { kind: "literal_string", value: fieldName, type: I8PTR }], returnType: retType, type: retType };
      bodyStmts.push({ kind: "let", id: propId, name: localName, type: propType, init: dynInit, mutable: false });
    }
  } else if (declId.type === "ArrayPattern") {
    locals.set("__forof_elem", { id: elemId, type: elemType, mutable: false });
    bodyStmts.push({ kind: "let", id: elemId, name: "__forof_elem", type: elemType, init: indexGet, mutable: false });
    const elemGetExpr: HIRExpr = { kind: "local_get", id: elemId, type: elemType };
    const innerElemType = elemType.kind === "array" ? (elemType as { kind: "array"; element: HIRType }).element : BOXED;
    for (let pi = 0; pi < declId.elements.length; pi++) {
      const pat = declId.elements[pi];
      if (!pat) continue;
      const patName: string = pat.type === "Identifier" ? pat.value : `__pat${pi}`;
      const patId = freshId();
      locals.set(patName, { id: patId, type: innerElemType, mutable: false });
      const patInit: HIRExpr = {
        kind: "index_get",
        array: elemGetExpr,
        index: { kind: "literal_i64", value: pi, type: I64 },
        type: innerElemType,
      };
      bodyStmts.push({ kind: "let", id: patId, name: patName, type: innerElemType, init: patInit, mutable: false });
    }
  } else {
    const varName: string = declId.value;
    locals.set(varName, { id: elemId, type: elemType, mutable: false });
    bodyStmts.push({ kind: "let", id: elemId, name: varName, type: elemType, init: indexGet, mutable: false });
  }

  const innerBody = lowerConsequent(stmt.body);

  const update: HIRExpr = {
    kind: "local_set",
    id: iId,
    value: {
      kind: "binary",
      op: "add",
      left: { kind: "local_get", id: iId, type: I64 },
      right: { kind: "literal_i64", value: 1, type: I64 },
      type: I64,
    },
    type: I64,
  };

  const forStmt: HIRStmt = {
    kind: "for",
    init: undefined,
    condition,
    update,
    body: [...bodyStmts, ...innerBody],
  };

  return [arrStore, iInit, forStmt];
}

function lowerForOfDynarray(stmt: any, iteree: HIRExpr, lowerConsequent: LowerConsequent): HIRStmt[] {
  const arrType: HIRType = { kind: "dynarray" };
  let actualArr: HIRExpr;
  if (iteree.type.kind === "dynobj") {
    if ((iteree as any).kind === "runtime_call" && (iteree as any).func === "cs2_dynobj_get_obj") {
      actualArr = { ...(iteree as any), func: "cs2_dynobj_get_arr", returnType: arrType, type: arrType };
    } else {
      actualArr = { ...iteree, type: arrType };
    }
  } else {
    actualArr = iteree;
  }

  const iId = freshId();
  const arrId = freshId();
  locals.set("__forof_darr", { id: arrId, type: arrType, mutable: false });
  locals.set("__forof_i", { id: iId, type: I64, mutable: true });

  const arrStore: HIRStmt = {
    kind: "let",
    id: arrId,
    name: "__forof_darr",
    type: arrType,
    init: actualArr,
    mutable: false,
  };
  const iInit: HIRStmt = {
    kind: "let",
    id: iId,
    name: "__forof_i",
    type: I64,
    init: { kind: "literal_i64", value: 0, type: I64 },
    mutable: true,
  };

  const lenExpr: HIRExpr = {
    kind: "runtime_call",
    func: "cs2_dynarray_length",
    args: [{ kind: "local_get", id: arrId, type: arrType }],
    returnType: I64,
    type: I64,
  };

  const condition: HIRExpr = {
    kind: "binary",
    op: "lt",
    left: { kind: "local_get", id: iId, type: I64 },
    right: lenExpr,
    type: I1,
  };

  const indexGet: HIRExpr = {
    kind: "runtime_call",
    func: "cs2_dynarray_get_obj",
    args: [
      { kind: "local_get", id: arrId, type: arrType },
      { kind: "local_get", id: iId, type: I64 },
    ],
    returnType: DYNOBJ,
    type: DYNOBJ,
  };

  const varDecl = stmt.left;
  const declId = varDecl.declarations[0].id;
  const elemId = freshId();
  const dynarrBodyStmts: HIRStmt[] = [];

  if (declId.type === "ObjectPattern") {
    locals.set("__forof_elem", { id: elemId, type: DYNOBJ, mutable: false });
    dynarrBodyStmts.push({ kind: "let", id: elemId, name: "__forof_elem", type: DYNOBJ, init: indexGet, mutable: false });
    const elemGetExpr: HIRExpr = { kind: "local_get", id: elemId, type: DYNOBJ };
    for (const prop of declId.properties) {
      const fieldName: string = prop.key?.value ?? prop.value?.value;
      const localName: string = prop.value?.value ?? fieldName;
      const propId = freshId();
      locals.set(localName, { id: propId, type: DYNOBJ, mutable: false });
      dynarrBodyStmts.push({
        kind: "let", id: propId, name: localName, type: DYNOBJ, mutable: false,
        init: { kind: "runtime_call", func: "cs2_dynobj_get_obj", args: [elemGetExpr, { kind: "literal_string", value: fieldName, type: I8PTR }], returnType: DYNOBJ, type: DYNOBJ },
      });
    }
  } else {
    const varName: string = declId.value;
    locals.set(varName, { id: elemId, type: DYNOBJ, mutable: false });
    dynarrBodyStmts.push({ kind: "let", id: elemId, name: varName, type: DYNOBJ, init: indexGet, mutable: false });
  }

  const innerBody = lowerConsequent(stmt.body);

  const update: HIRExpr = {
    kind: "local_set",
    id: iId,
    value: {
      kind: "binary",
      op: "add",
      left: { kind: "local_get", id: iId, type: I64 },
      right: { kind: "literal_i64", value: 1, type: I64 },
      type: I64,
    },
    type: I64,
  };

  return [
    arrStore,
    iInit,
    { kind: "for", init: undefined, condition, update, body: [...dynarrBodyStmts, ...innerBody] },
  ];
}

function lowerForOfMap(stmt: any, mapExpr: HIRExpr, lowerConsequent: LowerConsequent): HIRStmt[] {
  const mt = mapExpr.type as { kind: "map"; key: HIRType; value: HIRType };
  const prefix = mapPrefix(mt.key, mt.value);

  const mapId = freshId();
  const iId = freshId();
  locals.set("__forof_map", { id: mapId, type: mapExpr.type, mutable: false });
  locals.set("__forof_i", { id: iId, type: I64, mutable: true });

  const mapStore: HIRStmt = {
    kind: "let",
    id: mapId,
    name: "__forof_map",
    type: mapExpr.type,
    init: mapExpr,
    mutable: false,
  };
  const iInit: HIRStmt = {
    kind: "let",
    id: iId,
    name: "__forof_i",
    type: I64,
    init: { kind: "literal_i64", value: 0, type: I64 },
    mutable: true,
  };

  const sizeExpr: HIRExpr = {
    kind: "runtime_call",
    func: `${prefix}_size`,
    args: [{ kind: "local_get", id: mapId, type: mapExpr.type }],
    returnType: I64,
    type: I64,
  };

  const condition: HIRExpr = {
    kind: "binary",
    op: "lt",
    left: { kind: "local_get", id: iId, type: I64 },
    right: sizeExpr,
    type: I1,
  };

  const varDecl = stmt.left;
  const declId = varDecl.declarations[0].id;
  const bodyVars: HIRStmt[] = [];

  if (declId.type === "ArrayPattern" && declId.elements.length === 2) {
    if (declId.elements[0]) {
      const keyName = declId.elements[0].value;
      const keyId = freshId();
      locals.set(keyName, { id: keyId, type: mt.key, mutable: false });
      bodyVars.push({
        kind: "let",
        id: keyId,
        name: keyName,
        type: mt.key,
        init: {
          kind: "runtime_call",
          func: `${prefix}_key_at`,
          args: [
            { kind: "local_get", id: mapId, type: mapExpr.type },
            { kind: "local_get", id: iId, type: I64 },
          ],
          returnType: mt.key,
          type: mt.key,
        },
        mutable: false,
      });
    }
    if (declId.elements[1]) {
      const valName = declId.elements[1].value;
      const valId = freshId();
      locals.set(valName, { id: valId, type: mt.value, mutable: false });
      bodyVars.push({
        kind: "let",
        id: valId,
        name: valName,
        type: mt.value,
        init: {
          kind: "runtime_call",
          func: `${prefix}_value_at`,
          args: [
            { kind: "local_get", id: mapId, type: mapExpr.type },
            { kind: "local_get", id: iId, type: I64 },
          ],
          returnType: mt.value,
          type: mt.value,
        },
        mutable: false,
      });
    }
  } else {
    compileError("for...of over Map requires [key, value] destructuring", stmt.span);
  }

  const innerBody = lowerConsequent(stmt.body);

  const update: HIRExpr = {
    kind: "local_set",
    id: iId,
    value: {
      kind: "binary",
      op: "add",
      left: { kind: "local_get", id: iId, type: I64 },
      right: { kind: "literal_i64", value: 1, type: I64 },
      type: I64,
    },
    type: I64,
  };

  const forStmt: HIRStmt = {
    kind: "for",
    init: undefined,
    condition,
    update,
    body: [...bodyVars, ...innerBody],
  };

  return [mapStore, iInit, forStmt];
}
