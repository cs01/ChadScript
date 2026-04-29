import type { SyntaxNode } from "../parser-py.js";
import type { HIRType, HIRExpr, HIRStmt } from "./types.js";
import { F64, I64, I1, I8PTR, VOID, BOXED, DYNOBJ } from "./types.js";
import type { LowerCtx } from "./lower-py-ctx.js";
import {
  coerceTo, mapPrefix, resolveArithResultType,
  resolveType, inferType, namedChildren, defaultValue,
} from "./lower-py-types.js";

export function lowerBlock(node: SyntaxNode, ctx: LowerCtx): HIRStmt[] {
  const stmts: HIRStmt[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const prev = ctx.pendingStmts;
    ctx.pendingStmts = [];
    const lowered = ctx.lowerStmt(node.namedChild(i)!);
    stmts.push(...ctx.pendingStmts, ...lowered);
    ctx.pendingStmts = prev;
  }
  return stmts;
}

export function lowerStmt(node: SyntaxNode, ctx: LowerCtx): HIRStmt[] {
  switch (node.type) {
    case "expression_statement": {
      const inner = node.namedChild(0)!;
      if (inner.type === "assignment") {
        return lowerAssignment(inner, ctx);
      }
      if (inner.type === "augmented_assignment") {
        return lowerAugmentedAssignment(inner, ctx);
      }
      return [{ kind: "expr", expr: ctx.lowerExpr(inner) }];
    }
    case "return_statement": {
      const valNode = node.namedChild(0);
      return [{ kind: "return", value: valNode ? ctx.lowerExpr(valNode) : undefined }];
    }
    case "if_statement":
      return [lowerIfLike(node, ctx)];
    case "while_statement":
      return [lowerWhile(node, ctx)];
    case "for_statement":
      return lowerFor(node, ctx);
    case "break_statement":
      return [{ kind: "break" }];
    case "continue_statement":
      return [{ kind: "continue" }];
    case "pass_statement":
      return [];
    case "augmented_assignment":
      return lowerAugmentedAssignment(node, ctx);
    case "try_statement":
      return [lowerTryCatch(node, ctx)];
    case "raise_statement":
      return [lowerRaise(node, ctx)];
    case "delete_statement":
      return lowerDelete(node, ctx);
    case "assert_statement":
    case "import_statement":
    case "import_from_statement":
    case "global_statement":
    case "nonlocal_statement":
      return [];
    case "function_definition":
      ctx.lowerFunctionNode(node);
      return [];
    case "with_statement":
      return lowerWith(node, ctx);
    default:
      throw new Error(`unsupported statement: ${node.type}`);
  }
}

export function lowerAssignment(node: SyntaxNode, ctx: LowerCtx): HIRStmt[] {
  const children = namedChildren(node);
  const nameNode = children[0];

  let valueNode: SyntaxNode | null = null;
  let typeNode: SyntaxNode | null = null;
  for (let i = 1; i < children.length; i++) {
    if (children[i].type === "type") {
      typeNode = children[i];
    } else {
      valueNode = children[i];
    }
  }

  if (nameNode.type === "attribute") {
    return lowerAttributeAssign(nameNode, valueNode, ctx);
  }

  if (nameNode.type === "subscript") {
    const arrExpr = ctx.lowerExpr(nameNode.namedChild(0)!);
    const idxExpr = ctx.lowerExpr(nameNode.namedChild(1)!);
    const val = ctx.lowerExpr(valueNode!);
    if (arrExpr.type.kind === "dynobj") {
      const key = coerceTo(idxExpr, I8PTR);
      const boxed: HIRExpr = { kind: "box", value: val, fromType: val.type, type: BOXED };
      return [{
        kind: "expr",
        expr: {
          kind: "runtime_call",
          func: "cs2_dynobj_set",
          args: [arrExpr, key, val.type.kind === "boxed" ? val : boxed],
          returnType: VOID,
          type: VOID,
        },
      }];
    }
    if (arrExpr.type.kind === "map") {
      const mt = arrExpr.type as { kind: "map"; key: HIRType; value: HIRType };
      const prefix = mapPrefix(mt.key, mt.value);
      return [{
        kind: "expr",
        expr: {
          kind: "runtime_call",
          func: `${prefix}_set`,
          args: [arrExpr, coerceTo(idxExpr, mt.key), coerceTo(val, mt.value)],
          returnType: VOID,
          type: VOID,
        },
      }];
    }
    return [{
      kind: "expr",
      expr: { kind: "index_set", array: arrExpr, index: coerceTo(idxExpr, I64), value: val, type: val.type },
    }];
  }

  if (nameNode.type === "pattern_list") {
    return lowerPatternUnpack(nameNode, valueNode, ctx);
  }

  if (valueNode && valueNode.type === "assignment") {
    const innerStmts = lowerAssignment(valueNode, ctx);
    const innerNameNode = namedChildren(valueNode)[0];
    const innerName = innerNameNode.type === "identifier" ? innerNameNode.text : null;
    const innerLocal = innerName ? ctx.locals.get(innerName) : null;
    const outerValue: HIRExpr = innerLocal
      ? { kind: "local_get", id: innerLocal.id, type: innerLocal.type }
      : { kind: "literal_i64", value: 0, type: I64 };

    const name = nameNode.text;
    const existing = ctx.locals.get(name);
    if (existing) {
      return [...innerStmts, { kind: "expr", expr: { kind: "local_set", id: existing.id, value: coerceTo(outerValue, existing.type), type: existing.type } }];
    }
    const type = outerValue.type;
    const id = ctx.freshId();
    ctx.locals.set(name, { id, name, type });
    return [...innerStmts, { kind: "let", id, name, type, init: outerValue, mutable: true }];
  }

  const name = nameNode.text;
  const existing = ctx.locals.get(name);
  if (existing) {
    const value = valueNode
      ? coerceTo(ctx.lowerExpr(valueNode), existing.type)
      : { kind: "literal_i64" as const, value: 0, type: I64 };
    return [
      { kind: "expr", expr: { kind: "local_set", id: existing.id, value, type: existing.type } },
    ];
  }

  const id = ctx.freshId();
  let init = valueNode ? ctx.lowerExpr(valueNode) : undefined;
  const inferredType = typeNode
    ? resolveType(typeNode, ctx)
    : valueNode
      ? inferType(valueNode)
      : BOXED;
  let type = inferredType.kind === "boxed" && init && init.type.kind !== "boxed"
    ? init.type
    : inferredType;
  if (type.kind === "void") { type = I8PTR; init = { kind: "literal_null", type: I8PTR }; }
  ctx.locals.set(name, { id, name, type });

  if (valueNode && valueNode.type === "call") {
    const funcNode = valueNode.childForFieldName("function");
    if (funcNode && funcNode.type === "identifier" && ctx.dynobjClasses.has(funcNode.text)) {
      ctx.instanceClasses.set(name, funcNode.text);
    }
  }

  return [{ kind: "let", id, name, type, init, mutable: true }];
}

function lowerAttributeAssign(attrNode: SyntaxNode, valueNode: SyntaxNode | null, ctx: LowerCtx): HIRStmt[] {
  const obj = ctx.lowerExpr(attrNode.namedChild(0)!);
  const fieldName = attrNode.namedChild(1)!.text;

  if (obj.type.kind === "dynobj") {
    const val = valueNode ? ctx.lowerExpr(valueNode) : { kind: "literal_i64" as const, value: 0, type: I64 };
    const boxed: HIRExpr = val.type.kind === "boxed" ? val : { kind: "box", value: val, fromType: val.type, type: { kind: "boxed" } as const };
    return [{
      kind: "expr",
      expr: {
        kind: "runtime_call",
        func: "cs2_dynobj_set",
        args: [obj, { kind: "literal_string", value: fieldName, type: I8PTR }, boxed],
        returnType: VOID,
        type: VOID,
      },
    }];
  }

  if (obj.type.kind === "ptr") {
    const cls = ctx.classes.get(obj.type.pointee);
    if (cls) {
      const fieldIdx = cls.fields.findIndex((f) => f.name === fieldName);
      if (fieldIdx >= 0) {
        const fieldType = cls.fields[fieldIdx].type;
        const value = valueNode ? coerceTo(ctx.lowerExpr(valueNode), fieldType) : defaultValue(fieldType);
        return [
          {
            kind: "expr",
            expr: {
              kind: "field_set",
              object: obj,
              fieldName,
              index: fieldIdx,
              value,
              type: fieldType,
            },
          },
        ];
      }
    }
  }
  throw new Error(`cannot assign attribute ${fieldName} on ${obj.type.kind}`);
}

function lowerAugmentedAssignment(node: SyntaxNode, ctx: LowerCtx): HIRStmt[] {
  const children = namedChildren(node);
  const targetNode = children[0];
  const valueNode = children[1];

  let op = "";
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)!;
    if (!c.isNamed && c.text.length >= 2 && c.text.endsWith("=") && c.text !== "==") {
      op = c.text;
      break;
    }
  }

  const opMap: Record<string, string> = {
    "+=": "add",
    "-=": "sub",
    "*=": "mul",
    "/=": "div",
    "%=": "rem",
    "//=": "div",
    "&=": "bit_and",
    "|=": "bit_or",
    "^=": "bit_xor",
    "<<=": "shl",
    ">>=": "shr",
  };
  const hirOp = opMap[op];
  if (!hirOp) throw new Error(`unsupported augmented assignment: ${op}`);

  if (targetNode.type === "identifier") {
    const name = targetNode.text;
    const local = ctx.locals.get(name);
    if (!local) throw new Error(`undefined variable: ${name}`);
    const rhs = ctx.lowerExpr(valueNode);
    let combined: HIRExpr;
    if (op === "+=" && local.type.kind === "i8ptr") {
      combined = {
        kind: "runtime_call",
        func: "cs_string_concat",
        args: [{ kind: "local_get", id: local.id, type: local.type }, rhs],
        returnType: I8PTR,
        type: I8PTR,
      };
    } else {
      const resultType = resolveArithResultType(local.type, rhs.type);
      combined = {
        kind: "binary",
        op: hirOp as any,
        left: coerceTo({ kind: "local_get", id: local.id, type: local.type }, resultType),
        right: coerceTo(rhs, resultType),
        type: resultType,
      };
    }
    return [
      { kind: "expr", expr: { kind: "local_set", id: local.id, value: coerceTo(combined, local.type), type: local.type } },
    ];
  }

  if (targetNode.type === "attribute") {
    const obj = ctx.lowerExpr(targetNode.namedChild(0)!);
    const fieldName = targetNode.namedChild(1)!.text;
    if (obj.type.kind === "ptr") {
      const cls = ctx.classes.get(obj.type.pointee);
      if (cls) {
        const fieldIdx = cls.fields.findIndex((f) => f.name === fieldName);
        if (fieldIdx >= 0) {
          const fieldType = cls.fields[fieldIdx].type;
          const rhs = ctx.lowerExpr(valueNode);
          const current: HIRExpr = {
            kind: "field_get",
            object: obj,
            fieldName,
            index: fieldIdx,
            type: fieldType,
          };
          const resultType = resolveArithResultType(fieldType, rhs.type);
          const combined: HIRExpr = {
            kind: "binary",
            op: hirOp as any,
            left: coerceTo(current, resultType),
            right: coerceTo(rhs, resultType),
            type: resultType,
          };
          return [
            {
              kind: "expr",
              expr: {
                kind: "field_set",
                object: obj,
                fieldName,
                index: fieldIdx,
                value: combined,
                type: fieldType,
              },
            },
          ];
        }
      }
    }
  }

  throw new Error(`unsupported augmented assignment target: ${targetNode.type}`);
}

function lowerIfLike(node: SyntaxNode, ctx: LowerCtx): HIRStmt {
  const condition = ctx.lowerExpr(node.childForFieldName("condition")!);
  const thenBlock = ctx.lowerBlock(node.childForFieldName("consequence")!);
  const alts = node.childrenForFieldName("alternative");
  const elseBlock = alts.length > 0 ? buildElifChain(alts, 0, ctx) : undefined;
  return { kind: "if", condition, then: thenBlock, else: elseBlock };
}

function buildElifChain(alts: SyntaxNode[], idx: number, ctx: LowerCtx): HIRStmt[] | undefined {
  if (idx >= alts.length) return undefined;
  const alt = alts[idx];
  if (alt.type === "else_clause") {
    const body = alt.childForFieldName("body");
    return body ? ctx.lowerBlock(body) : ctx.lowerBlock(alt.namedChild(0)!);
  }
  if (alt.type === "elif_clause") {
    const condition = ctx.lowerExpr(alt.childForFieldName("condition")!);
    const thenBlock = ctx.lowerBlock(alt.childForFieldName("consequence")!);
    const elseBlock = buildElifChain(alts, idx + 1, ctx);
    return [{ kind: "if", condition, then: thenBlock, else: elseBlock }];
  }
  return undefined;
}

function lowerWhile(node: SyntaxNode, ctx: LowerCtx): HIRStmt {
  const condition = ctx.lowerExpr(node.childForFieldName("condition")!);
  const body = ctx.lowerBlock(node.childForFieldName("body")!);
  return { kind: "while", condition, body };
}

export function lowerFor(node: SyntaxNode, ctx: LowerCtx): HIRStmt[] {
  const left = node.childForFieldName("left")!;
  const right = node.childForFieldName("right")!;
  const body = node.childForFieldName("body")!;

  if (right.type === "call" && right.childForFieldName("function")?.text === "range") {
    return lowerRangeFor(left, right, body, ctx);
  }

  if (right.type === "call" && right.childForFieldName("function")?.text === "enumerate") {
    return lowerEnumerateFor(left, right, body, ctx);
  }

  if (right.type === "call" && right.childForFieldName("function")?.text === "zip") {
    return lowerZipFor(left, right, body, ctx);
  }

  if (right.type === "call") {
    const fn = right.childForFieldName("function");
    if (fn?.type === "attribute") {
      const method = fn.namedChild(1)!.text;
      if (method === "items" || method === "keys") {
        const dictExpr = ctx.lowerExpr(fn.namedChild(0)!);
        if (dictExpr.type.kind === "map") {
          return lowerMapFor(left, dictExpr, body, method === "items", ctx);
        }
      }
    }
  }

  const iterExpr = ctx.lowerExpr(right);
  if (iterExpr.type.kind === "map") {
    return lowerMapFor(left, iterExpr, body, left.type === "pattern_list", ctx);
  }
  if (iterExpr.type.kind === "set") {
    const elemType = (iterExpr.type as { kind: "set"; element: HIRType }).element;
    const prefix = elemType.kind === "i8ptr" ? "cs2_str_set" : "cs2_num_set";
    const valuesExpr: HIRExpr = {
      kind: "runtime_call", func: `${prefix}_values`,
      args: [iterExpr], returnType: { kind: "array", element: elemType }, type: { kind: "array", element: elemType },
    };
    return lowerArrayFor(left, valuesExpr, body, ctx);
  }
  return lowerArrayFor(left, iterExpr, body, ctx);
}

function lowerEnumerateFor(left: SyntaxNode, call: SyntaxNode, body: SyntaxNode, ctx: LowerCtx): HIRStmt[] {
  const argsNode = call.childForFieldName("arguments")!;
  const iterExpr = ctx.lowerExpr(argsNode.namedChild(0)!);
  if (iterExpr.type.kind !== "array") {
    throw new Error("enumerate() requires array");
  }
  const elemType = iterExpr.type.element;
  const iterPrefix = elemType.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";

  const arrId = ctx.freshId();
  const iId = ctx.freshId();
  const elemId = ctx.freshId();
  ctx.locals.set("__enum_arr", { id: arrId, name: "__enum_arr", type: iterExpr.type });
  ctx.locals.set("__enum_i", { id: iId, name: "__enum_i", type: I64 });

  const arrRef: HIRExpr = { kind: "local_get", id: arrId, type: iterExpr.type };
  const iRef: HIRExpr = { kind: "local_get", id: iId, type: I64 };

  const lenExpr: HIRExpr = {
    kind: "runtime_call", func: `${iterPrefix}_length`, args: [arrRef], returnType: I64, type: I64,
  };

  const bodyVars: HIRStmt[] = [];
  if (left.type === "pattern_list") {
    const names = namedChildren(left).map((c) => c.text);
    const idxName = names[0];
    const valName = names[1];
    if (idxName) {
      const idId = ctx.freshId();
      ctx.locals.set(idxName, { id: idId, name: idxName, type: I64 });
      bodyVars.push({ kind: "let", id: idId, name: idxName, type: I64, init: iRef, mutable: false });
    }
    if (valName) {
      ctx.locals.set(valName, { id: elemId, name: valName, type: elemType });
      bodyVars.push({
        kind: "let", id: elemId, name: valName, type: elemType,
        init: { kind: "index_get", array: arrRef, index: iRef, type: elemType },
        mutable: false,
      });
    }
  }

  return [
    { kind: "let", id: arrId, name: "__enum_arr", type: iterExpr.type, init: iterExpr, mutable: false },
    { kind: "let", id: iId, name: "__enum_i", type: I64, init: { kind: "literal_i64", value: 0, type: I64 }, mutable: true },
    {
      kind: "for",
      condition: { kind: "binary", op: "lt", left: iRef, right: lenExpr, type: I1 },
      update: {
        kind: "local_set", id: iId,
        value: { kind: "binary", op: "add", left: iRef, right: { kind: "literal_i64", value: 1, type: I64 }, type: I64 },
        type: I64,
      },
      body: [...bodyVars, ...ctx.lowerBlock(body)],
    },
  ];
}

function lowerZipFor(left: SyntaxNode, call: SyntaxNode, body: SyntaxNode, ctx: LowerCtx): HIRStmt[] {
  const argsNode = call.childForFieldName("arguments")!;
  const arr1Expr = ctx.lowerExpr(argsNode.namedChild(0)!);
  const arr2Expr = ctx.lowerExpr(argsNode.namedChild(1)!);
  if (arr1Expr.type.kind !== "array" || arr2Expr.type.kind !== "array") {
    throw new Error("zip() requires arrays");
  }
  const elem1 = arr1Expr.type.element;
  const elem2 = arr2Expr.type.element;
  const p1 = elem1.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";
  const p2 = elem2.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";
  void p2;

  const a1Id = ctx.freshId();
  const a2Id = ctx.freshId();
  const iId = ctx.freshId();
  ctx.locals.set("__zip_a1", { id: a1Id, name: "__zip_a1", type: arr1Expr.type });
  ctx.locals.set("__zip_a2", { id: a2Id, name: "__zip_a2", type: arr2Expr.type });
  ctx.locals.set("__zip_i", { id: iId, name: "__zip_i", type: I64 });

  const a1Ref: HIRExpr = { kind: "local_get", id: a1Id, type: arr1Expr.type };
  const a2Ref: HIRExpr = { kind: "local_get", id: a2Id, type: arr2Expr.type };
  const iRef: HIRExpr = { kind: "local_get", id: iId, type: I64 };

  const lenExpr: HIRExpr = {
    kind: "runtime_call", func: `${p1}_length`, args: [a1Ref], returnType: I64, type: I64,
  };

  const bodyVars: HIRStmt[] = [];
  if (left.type === "pattern_list") {
    const names = namedChildren(left).map((c) => c.text);
    if (names[0]) {
      const id1 = ctx.freshId();
      ctx.locals.set(names[0], { id: id1, name: names[0], type: elem1 });
      bodyVars.push({
        kind: "let", id: id1, name: names[0], type: elem1,
        init: { kind: "index_get", array: a1Ref, index: iRef, type: elem1 }, mutable: false,
      });
    }
    if (names[1]) {
      const id2 = ctx.freshId();
      ctx.locals.set(names[1], { id: id2, name: names[1], type: elem2 });
      bodyVars.push({
        kind: "let", id: id2, name: names[1], type: elem2,
        init: { kind: "index_get", array: a2Ref, index: iRef, type: elem2 }, mutable: false,
      });
    }
  }

  return [
    { kind: "let", id: a1Id, name: "__zip_a1", type: arr1Expr.type, init: arr1Expr, mutable: false },
    { kind: "let", id: a2Id, name: "__zip_a2", type: arr2Expr.type, init: arr2Expr, mutable: false },
    { kind: "let", id: iId, name: "__zip_i", type: I64, init: { kind: "literal_i64", value: 0, type: I64 }, mutable: true },
    {
      kind: "for",
      condition: { kind: "binary", op: "lt", left: iRef, right: lenExpr, type: I1 },
      update: {
        kind: "local_set", id: iId,
        value: { kind: "binary", op: "add", left: iRef, right: { kind: "literal_i64", value: 1, type: I64 }, type: I64 },
        type: I64,
      },
      body: [...bodyVars, ...ctx.lowerBlock(body)],
    },
  ];
}

function lowerRangeFor(left: SyntaxNode, call: SyntaxNode, body: SyntaxNode, ctx: LowerCtx): HIRStmt[] {
  const args = call.childForFieldName("arguments")!;
  const rangeArgs: SyntaxNode[] = [];
  for (let i = 0; i < args.namedChildCount; i++) rangeArgs.push(args.namedChild(i)!);

  let start: HIRExpr, end: HIRExpr, step: HIRExpr;
  if (rangeArgs.length === 1) {
    start = { kind: "literal_i64", value: 0, type: I64 };
    end = ctx.lowerExpr(rangeArgs[0]);
    step = { kind: "literal_i64", value: 1, type: I64 };
  } else if (rangeArgs.length === 2) {
    start = ctx.lowerExpr(rangeArgs[0]);
    end = ctx.lowerExpr(rangeArgs[1]);
    step = { kind: "literal_i64", value: 1, type: I64 };
  } else {
    start = ctx.lowerExpr(rangeArgs[0]);
    end = ctx.lowerExpr(rangeArgs[1]);
    step = ctx.lowerExpr(rangeArgs[2]);
  }

  const varName = left.text;
  const id = ctx.freshId();
  ctx.locals.set(varName, { id, name: varName, type: I64 });

  const isNegStep = step.kind === "literal_i64" && (step as any).value < 0
    || step.kind === "unary" && (step as any).op === "neg";
  const condOp = isNegStep ? "gt" : "lt";

  return [
    { kind: "let", id, name: varName, type: I64, init: start, mutable: true },
    {
      kind: "for",
      condition: {
        kind: "binary",
        op: condOp as any,
        left: { kind: "local_get", id, type: I64 },
        right: end,
        type: I1,
      },
      update: {
        kind: "local_set",
        id,
        value: {
          kind: "binary",
          op: "add",
          left: { kind: "local_get", id, type: I64 },
          right: step,
          type: I64,
        },
        type: I64,
      },
      body: ctx.lowerBlock(body),
    },
  ];
}

function lowerMapFor(left: SyntaxNode, mapExpr: HIRExpr, body: SyntaxNode, unpack: boolean, ctx: LowerCtx): HIRStmt[] {
  const mt = mapExpr.type as { kind: "map"; key: HIRType; value: HIRType };
  const prefix = mapPrefix(mt.key, mt.value);
  const mapType: HIRType = { kind: "map", key: mt.key, value: mt.value };

  const mapId = ctx.freshId();
  const iId = ctx.freshId();
  ctx.locals.set("__formap_map", { id: mapId, name: "__formap_map", type: mapType });
  ctx.locals.set("__formap_i", { id: iId, name: "__formap_i", type: I64 });

  const mapRef: HIRExpr = { kind: "local_get", id: mapId, type: mapType };
  const iRef: HIRExpr = { kind: "local_get", id: iId, type: I64 };

  const sizeExpr: HIRExpr = {
    kind: "runtime_call",
    func: `${prefix}_size`,
    args: [mapRef],
    returnType: I64,
    type: I64,
  };

  const bodyVars: HIRStmt[] = [];

  if (unpack && left.type === "pattern_list") {
    const kvNames = namedChildren(left).map((c) => c.text);
    const keyName = kvNames[0];
    const valName = kvNames[1];
    if (keyName) {
      const keyId = ctx.freshId();
      ctx.locals.set(keyName, { id: keyId, name: keyName, type: mt.key });
      bodyVars.push({
        kind: "let", id: keyId, name: keyName, type: mt.key,
        init: { kind: "runtime_call", func: `${prefix}_key_at`, args: [mapRef, iRef], returnType: mt.key, type: mt.key },
        mutable: false,
      });
    }
    if (valName) {
      const valId = ctx.freshId();
      ctx.locals.set(valName, { id: valId, name: valName, type: mt.value });
      bodyVars.push({
        kind: "let", id: valId, name: valName, type: mt.value,
        init: { kind: "runtime_call", func: `${prefix}_value_at`, args: [mapRef, iRef], returnType: mt.value, type: mt.value },
        mutable: false,
      });
    }
  } else {
    const keyName = left.text;
    const keyId = ctx.freshId();
    ctx.locals.set(keyName, { id: keyId, name: keyName, type: mt.key });
    bodyVars.push({
      kind: "let", id: keyId, name: keyName, type: mt.key,
      init: { kind: "runtime_call", func: `${prefix}_key_at`, args: [mapRef, iRef], returnType: mt.key, type: mt.key },
      mutable: false,
    });
  }

  return [
    { kind: "let", id: mapId, name: "__formap_map", type: mapType, init: mapExpr, mutable: false },
    { kind: "let", id: iId, name: "__formap_i", type: I64, init: { kind: "literal_i64", value: 0, type: I64 }, mutable: true },
    {
      kind: "for",
      condition: { kind: "binary", op: "lt", left: iRef, right: sizeExpr, type: I1 },
      update: {
        kind: "local_set", id: iId,
        value: { kind: "binary", op: "add", left: iRef, right: { kind: "literal_i64", value: 1, type: I64 }, type: I64 },
        type: I64,
      },
      body: [...bodyVars, ...ctx.lowerBlock(body)],
    },
  ];
}

function lowerArrayFor(left: SyntaxNode, arrExpr: HIRExpr, body: SyntaxNode, ctx: LowerCtx): HIRStmt[] {
  if (arrExpr.type.kind !== "array") {
    throw new Error(`for...in requires array type, got ${arrExpr.type.kind}`);
  }
  const elemType = arrExpr.type.element;
  const prefix = elemType.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";

  const arrId = ctx.freshId();
  const iId = ctx.freshId();
  const elemId = ctx.freshId();
  const varName = left.text;

  ctx.locals.set("__forin_arr", { id: arrId, name: "__forin_arr", type: arrExpr.type });
  ctx.locals.set("__forin_i", { id: iId, name: "__forin_i", type: I64 });
  ctx.locals.set(varName, { id: elemId, name: varName, type: elemType });

  const arrRef: HIRExpr = { kind: "local_get", id: arrId, type: arrExpr.type };
  const lenExpr: HIRExpr = {
    kind: "runtime_call",
    func: `${prefix}_length`,
    args: [arrRef],
    returnType: I64,
    type: I64,
  };

  return [
    { kind: "let", id: arrId, name: "__forin_arr", type: arrExpr.type, init: arrExpr, mutable: false },
    { kind: "let", id: iId, name: "__forin_i", type: I64, init: { kind: "literal_i64", value: 0, type: I64 }, mutable: true },
    {
      kind: "for",
      condition: {
        kind: "binary",
        op: "lt",
        left: { kind: "local_get", id: iId, type: I64 },
        right: lenExpr,
        type: I1,
      },
      update: {
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
      },
      body: [
        {
          kind: "let",
          id: elemId,
          name: varName,
          type: elemType,
          init: {
            kind: "index_get",
            array: arrRef,
            index: { kind: "local_get", id: iId, type: I64 },
            type: elemType,
          },
          mutable: false,
        },
        ...ctx.lowerBlock(body),
      ],
    },
  ];
}

export function lowerPatternUnpack(patternNode: SyntaxNode, valueNode: SyntaxNode | null, ctx: LowerCtx): HIRStmt[] {
  const children = namedChildren(patternNode);
  const stmts: HIRStmt[] = [];

  if (valueNode && (valueNode.type === "tuple" || valueNode.type === "expression_list")) {
    const values = namedChildren(valueNode).map((c) => ctx.lowerExpr(c));
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const name = child.type === "list_splat_pattern" ? child.namedChild(0)!.text : child.text;
      const val = values[i] ?? { kind: "literal_i64" as const, value: 0, type: I64 };
      const existing = ctx.locals.get(name);
      if (existing) {
        stmts.push({ kind: "expr", expr: { kind: "local_set", id: existing.id, value: coerceTo(val, existing.type), type: existing.type } });
      } else {
        const id = ctx.freshId();
        ctx.locals.set(name, { id, name, type: val.type });
        stmts.push({ kind: "let", id, name, type: val.type, init: val, mutable: true });
      }
    }
  } else {
    const rhs = valueNode ? ctx.lowerExpr(valueNode) : { kind: "literal_null" as const, type: VOID };
    const arrType = rhs.type.kind === "array" ? rhs.type : { kind: "array" as const, element: F64 as HIRType };
    const elemType = arrType.kind === "array" ? arrType.element : F64;
    const tmpId = ctx.freshId();
    stmts.push({ kind: "let", id: tmpId, name: "__unpack", type: rhs.type, init: rhs as HIRExpr, mutable: false });
    const tmpRef: HIRExpr = { kind: "local_get", id: tmpId, type: rhs.type as HIRType };
    const starIdx = children.findIndex((c) => c.type === "list_splat_pattern");
    const prefix = elemType.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";
    let posIdx = 0;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.type === "list_splat_pattern") {
        const name = child.namedChild(0)!.text;
        const afterCount = children.length - i - 1;
        const sliceType: HIRType = { kind: "array", element: elemType };
        const lenExpr: HIRExpr = { kind: "runtime_call", func: `${prefix}_length`, args: [tmpRef], returnType: I64, type: I64 };
        const endExpr: HIRExpr = afterCount === 0
          ? lenExpr
          : { kind: "binary", op: "sub", left: lenExpr, right: { kind: "literal_i64", value: afterCount, type: I64 }, type: I64 };
        const sliceExpr: HIRExpr = {
          kind: "runtime_call", func: `${prefix}_slice`,
          args: [tmpRef, { kind: "literal_i64", value: posIdx, type: I64 }, endExpr],
          returnType: sliceType, type: sliceType,
        };
        const existing = ctx.locals.get(name);
        if (existing) {
          stmts.push({ kind: "expr", expr: { kind: "local_set", id: existing.id, value: sliceExpr, type: sliceType } });
        } else {
          const id = ctx.freshId();
          ctx.locals.set(name, { id, name, type: sliceType });
          stmts.push({ kind: "let", id, name, type: sliceType, init: sliceExpr, mutable: true });
        }
        posIdx = -(afterCount);
      } else {
        const name = child.text;
        const idx = starIdx < 0 || i < starIdx ? posIdx : posIdx - (children.length - starIdx - 1) + i - starIdx;
        const getExpr: HIRExpr = {
          kind: "index_get", array: tmpRef,
          index: idx >= 0
            ? { kind: "literal_i64", value: idx, type: I64 }
            : { kind: "binary", op: "sub",
                left: { kind: "runtime_call", func: `${prefix}_length`, args: [tmpRef], returnType: I64, type: I64 },
                right: { kind: "literal_i64", value: -idx, type: I64 }, type: I64 },
          type: elemType,
        };
        const existing = ctx.locals.get(name);
        if (existing) {
          stmts.push({ kind: "expr", expr: { kind: "local_set", id: existing.id, value: coerceTo(getExpr, existing.type), type: existing.type } });
        } else {
          const id = ctx.freshId();
          ctx.locals.set(name, { id, name, type: elemType });
          stmts.push({ kind: "let", id, name, type: elemType, init: getExpr, mutable: true });
        }
        posIdx++;
      }
    }
  }

  return stmts;
}

function lowerWith(node: SyntaxNode, ctx: LowerCtx): HIRStmt[] {
  const clauseNode = node.namedChild(0)!;
  const bodyNode = node.childForFieldName("body")!;
  const stmts: HIRStmt[] = [];

  for (let i = 0; i < clauseNode.namedChildCount; i++) {
    const item = clauseNode.namedChild(i)!;
    const valueNode = item.childForFieldName("value") ?? item.namedChild(0)!;
    if (valueNode.type === "as_pattern") {
      const exprNode = valueNode.namedChild(0)!;
      const aliasNode = valueNode.namedChild(valueNode.namedChildCount - 1)!;
      const cmExpr = ctx.lowerExpr(exprNode);
      const aliasName = aliasNode.text;
      const aliasId = ctx.freshId();
      ctx.locals.set(aliasName, { id: aliasId, name: aliasName, type: cmExpr.type });
      stmts.push({ kind: "let", id: aliasId, name: aliasName, type: cmExpr.type, init: cmExpr, mutable: false });
    } else {
      stmts.push({ kind: "expr", expr: ctx.lowerExpr(valueNode) });
    }
  }

  stmts.push(...ctx.lowerBlock(bodyNode));
  return stmts;
}

function lowerTryCatch(node: SyntaxNode, ctx: LowerCtx): HIRStmt {
  const body = ctx.lowerBlock(node.childForFieldName("body")!);
  let catchClause: { paramId: number; paramName: string; body: HIRStmt[] } | undefined;
  let finallyBody: HIRStmt[] | undefined;

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)!;
    if (child.type === "except_clause") {
      let bindingName = "__e";
      let bodyBlock: SyntaxNode | null = null;
      for (let j = 0; j < child.namedChildCount; j++) {
        const c = child.namedChild(j)!;
        if (c.type === "as_pattern") {
          const target = c.namedChild(c.namedChildCount - 1)!;
          const ident = target.type === "as_pattern_target" ? target.namedChild(0) : target;
          if (ident) bindingName = ident.text;
        }
        if (c.type === "block") bodyBlock = c;
      }
      if (!bodyBlock) continue;
      const paramId = ctx.freshId();
      ctx.locals.set(bindingName, { id: paramId, name: bindingName, type: I8PTR });
      catchClause = { paramId, paramName: bindingName, body: ctx.lowerBlock(bodyBlock) };
    }
    if (child.type === "finally_clause") {
      const fb = child.childForFieldName("body") ?? child.namedChild(child.namedChildCount - 1)!;
      finallyBody = ctx.lowerBlock(fb);
    }
  }

  return { kind: "try", body, catch: catchClause, finally: finallyBody };
}

function lowerRaise(node: SyntaxNode, ctx: LowerCtx): HIRStmt {
  const arg = node.namedChild(0);
  let value: HIRExpr;

  if (!arg) {
    value = { kind: "literal_string", value: "exception", type: I8PTR };
  } else if (arg.type === "call") {
    const funcNode = arg.childForFieldName("function")!;
    const argsNode = arg.childForFieldName("arguments")!;
    if (argsNode.namedChildCount > 0) {
      const msgArg = ctx.lowerExpr(argsNode.namedChild(0)!);
      value = msgArg.type.kind === "i8ptr" ? msgArg : {
        kind: "runtime_call",
        func: "cs_string_concat",
        args: [{ kind: "literal_string", value: "", type: I8PTR }, msgArg],
        returnType: I8PTR,
        type: I8PTR,
      };
    } else {
      value = { kind: "literal_string", value: funcNode.text, type: I8PTR };
    }
  } else if (arg.type === "identifier") {
    const local = ctx.locals.get(arg.text);
    value = local && local.type.kind === "i8ptr"
      ? { kind: "local_get", id: local.id, type: I8PTR }
      : { kind: "literal_string", value: arg.text, type: I8PTR };
  } else {
    value = { kind: "literal_string", value: "exception", type: I8PTR };
  }

  return { kind: "throw", value };
}

function lowerDelete(node: SyntaxNode, ctx: LowerCtx): HIRStmt[] {
  const target = node.namedChild(0);
  if (!target) return [];
  if (target.type === "subscript") {
    const obj = ctx.lowerExpr(target.namedChild(0)!);
    const key = ctx.lowerExpr(target.namedChild(1)!);
    if (obj.type.kind === "map") {
      const mt = obj.type as { kind: "map"; key: HIRType; value: HIRType };
      const prefix = mapPrefix(mt.key, mt.value);
      return [{
        kind: "expr",
        expr: {
          kind: "runtime_call",
          func: `${prefix}_delete`,
          args: [obj, coerceTo(key, mt.key)],
          returnType: I64,
          type: I64,
        },
      }];
    }
  }
  return [];
}
