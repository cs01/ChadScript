import type { SyntaxNode } from "../parser-py.js";
import type {
  HIRModule,
  HIRFunction,
  HIRClass,
  HIRStmt,
  HIRExpr,
  HIRType,
  HIRParam,
  HIRGlobal,
  SourceInfo,
} from "./types.js";
import { F64, I64, I1, I8PTR, VOID, BOXED } from "./types.js";

let nextId = 0;
function freshId(): number {
  return nextId++;
}

interface Local {
  id: number;
  name: string;
  type: HIRType;
}

let locals: Map<string, Local>;
let functions: Map<string, { params: HIRType[]; returnType: HIRType }>;
let classes: Map<string, { fields: { name: string; type: HIRType }[] }>;
let classParents: Map<string, string>;
let currentClassName: string | null;
let pendingStmts: HIRStmt[] = [];
let pendingFunctions: HIRFunction[] = [];

export function lowerPythonModule(
  root: SyntaxNode,
  source: string,
  filename: string,
): HIRModule {
  nextId = 0;
  locals = new Map();
  functions = new Map();
  classes = new Map();
  classParents = new Map();
  currentClassName = null;
  pendingStmts = [];
  pendingFunctions = [];

  const hirFunctions: HIRFunction[] = [];
  const hirClasses: HIRClass[] = [];
  const hirGlobals: HIRGlobal[] = [];
  const initStmts: HIRStmt[] = [];

  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i)!;
    if (child.type === "class_definition") registerClass(child);
  }

  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i)!;
    if (child.type === "function_definition") registerFunction(child);
  }

  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i)!;
    switch (child.type) {
      case "function_definition":
        hirFunctions.push(lowerFunction(child));
        break;
      case "class_definition": {
        const { hirClass, fns } = lowerClass(child);
        hirClasses.push(hirClass);
        hirFunctions.push(...fns);
        break;
      }
      case "expression_statement":
      case "if_statement":
      case "while_statement":
      case "for_statement":
      case "try_statement":
      case "delete_statement":
      case "raise_statement": {
        const prev = pendingStmts;
        pendingStmts = [];
        const lowered = lowerStmt(child);
        initStmts.push(...pendingStmts, ...lowered);
        pendingStmts = prev;
        break;
      }
      case "import_statement":
      case "import_from_statement":
      case "comment":
        break;
      default:
        throw new Error(`unsupported top-level node: ${child.type}`);
    }
  }

  hirFunctions.push({
    name: "main",
    params: [],
    returnType: I64,
    body: [
      ...initStmts,
      { kind: "return", value: { kind: "literal_i64", value: 0, type: I64 } },
    ],
    isAsync: false,
    captures: [],
  });

  const sourceInfo: SourceInfo = {
    filename,
    directory: filename.replace(/\/[^/]+$/, ""),
    source,
  };

  return {
    functions: [...pendingFunctions, ...hirFunctions],
    classes: hirClasses,
    interfaces: [],
    globals: hirGlobals,
    init: [],
    sourceInfo,
  };
}

function resolveMethodOwner(className: string, methodName: string): string {
  const fnKey = `${className}_${methodName}`;
  if (functions.has(fnKey)) return className;
  const parent = classParents.get(className);
  if (parent) return resolveMethodOwner(parent, methodName);
  return className;
}

function registerClass(node: SyntaxNode): void {
  const name = node.childForFieldName("name")!.text;
  const body = node.childForFieldName("body")!;
  const fields: { name: string; type: HIRType }[] = [];

  // Detect superclass and inherit fields
  const argList = node.namedChild(1);
  if (argList && argList.type === "argument_list" && argList.namedChildCount > 0) {
    const superName = argList.namedChild(0)!.text;
    if (superName !== "Generic" && classes.has(superName)) {
      classParents.set(name, superName);
      const parentFields = classes.get(superName)!.fields;
      fields.push(...parentFields);
    }
  }

  for (let i = 0; i < body.namedChildCount; i++) {
    const member = body.namedChild(i)!;
    if (member.type !== "expression_statement") continue;
    const inner = member.namedChild(0)!;
    if (inner.type !== "assignment") continue;
    const children = namedChildren(inner);
    if (children.length < 2) continue;
    const nameNode = children[0];
    if (nameNode.type !== "identifier") continue;
    const typeNode = children.find((c) => c.type === "type");
    if (!typeNode) continue;
    fields.push({ name: nameNode.text, type: resolveType(typeNode) });
  }

  classes.set(name, { fields });
}

function registerFunction(node: SyntaxNode): void {
  const name = node.childForFieldName("name")!.text;
  const paramsNode = node.childForFieldName("parameters")!;
  const returnTypeNode = node.childForFieldName("return_type");
  const returnType = returnTypeNode ? resolveType(returnTypeNode) : VOID;
  const params: HIRType[] = [];

  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const p = paramsNode.namedChild(i)!;
    if (p.type === "typed_parameter" || p.type === "typed_default_parameter") {
      params.push(resolveType(p.childForFieldName("type")!));
    } else {
      params.push(BOXED);
    }
  }

  functions.set(name, { params, returnType });
}

function lowerFunction(node: SyntaxNode): HIRFunction {
  const savedLocals = new Map(locals);
  locals = new Map();

  const name = node.childForFieldName("name")!.text;
  const paramsNode = node.childForFieldName("parameters")!;
  const returnTypeNode = node.childForFieldName("return_type");
  const body = node.childForFieldName("body")!;

  const returnType = returnTypeNode ? resolveType(returnTypeNode) : VOID;
  const params: HIRParam[] = [];

  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const p = paramsNode.namedChild(i)!;
    if (p.type === "typed_parameter" || p.type === "typed_default_parameter") {
      const pName = p.namedChild(0)!.text;
      const pTypeNode = p.childForFieldName("type")!;
      const pType = resolveType(pTypeNode);
      const id = freshId();
      params.push({ id, name: pName, type: pType });
      locals.set(pName, { id, name: pName, type: pType });
    } else if (p.type === "identifier") {
      const pName = p.text;
      const id = freshId();
      params.push({ id, name: pName, type: BOXED });
      locals.set(pName, { id, name: pName, type: BOXED });
    }
  }

  functions.set(name, { params: params.map((p) => p.type), returnType });

  const hirBody = lowerBlock(body);

  locals = savedLocals;

  return { name, params, returnType, body: hirBody, isAsync: false, captures: [] };
}

function lowerClass(
  node: SyntaxNode,
): { hirClass: HIRClass; fns: HIRFunction[] } {
  const className = node.childForFieldName("name")!.text;
  const body = node.childForFieldName("body")!;
  const classInfo = classes.get(className)!;
  const fns: HIRFunction[] = [];
  const thisType: HIRType = { kind: "ptr", pointee: className };

  let hasInit = false;

  for (let i = 0; i < body.namedChildCount; i++) {
    const member = body.namedChild(i)!;
    if (member.type !== "function_definition") continue;
    const methodName = member.childForFieldName("name")!.text;
    if (methodName === "__init__") {
      hasInit = true;
      const { init, constructor } = lowerInitPair(className, member, classInfo);
      fns.push(init, constructor);
    } else {
      fns.push(lowerMethod(className, member, classInfo));
    }
  }

  if (!hasInit) {
    const id = freshId();
    functions.set(`${className}_constructor`, { params: [], returnType: thisType });
    const allocExpr: HIRExpr = {
      kind: "alloc_struct",
      structName: className,
      fields: classInfo.fields.map((f) => defaultValue(f.type)),
      type: thisType,
    };
    fns.push({
      name: `${className}_constructor`,
      params: [],
      returnType: thisType,
      body: [
        { kind: "let", id, name: "__self", type: thisType, init: allocExpr, mutable: false },
        { kind: "return", value: { kind: "local_get", id, type: thisType } },
      ],
      isAsync: false,
      captures: [],
    });
  }

  return {
    hirClass: { name: className, fields: classInfo.fields, methods: [] },
    fns,
  };
}

function lowerInitPair(
  className: string,
  initDef: SyntaxNode,
  classInfo: { fields: { name: string; type: HIRType }[] },
): { init: HIRFunction; constructor: HIRFunction } {
  const thisType: HIRType = { kind: "ptr", pointee: className };
  const thisId = freshId();

  const savedLocals = new Map(locals);
  locals = new Map();
  locals.set("self", { id: thisId, name: "self", type: thisType });

  const paramsNode = initDef.childForFieldName("parameters")!;
  const params: HIRParam[] = [];

  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const p = paramsNode.namedChild(i)!;
    if (p.type === "identifier" && p.text === "self") continue;
    if (p.type === "typed_parameter" || p.type === "typed_default_parameter") {
      const pName = p.namedChild(0)!.text;
      const pType = resolveType(p.childForFieldName("type")!);
      const id = freshId();
      params.push({ id, name: pName, type: pType });
      locals.set(pName, { id, name: pName, type: pType });
    } else if (p.type === "identifier") {
      const id = freshId();
      params.push({ id, name: p.text, type: BOXED });
      locals.set(p.text, { id, name: p.text, type: BOXED });
    }
  }

  functions.set(`${className}_init`, {
    params: [thisType, ...params.map((p) => p.type)],
    returnType: VOID,
  });
  functions.set(`${className}_constructor`, {
    params: params.map((p) => p.type),
    returnType: thisType,
  });

  const savedClass = currentClassName;
  currentClassName = className;
  const initBody = lowerBlock(initDef.childForFieldName("body")!);
  currentClassName = savedClass;

  locals = savedLocals;

  const init: HIRFunction = {
    name: `${className}_init`,
    params: [{ id: thisId, name: "self", type: thisType }, ...params],
    returnType: VOID,
    body: initBody,
    isAsync: false,
    captures: [],
  };

  const selfLocalId = freshId();
  const allocExpr: HIRExpr = {
    kind: "alloc_struct",
    structName: className,
    fields: classInfo.fields.map((f) => defaultValue(f.type)),
    type: thisType,
  };
  const constructor: HIRFunction = {
    name: `${className}_constructor`,
    params,
    returnType: thisType,
    body: [
      { kind: "let", id: selfLocalId, name: "__self", type: thisType, init: allocExpr, mutable: false },
      {
        kind: "expr",
        expr: {
          kind: "call",
          callee: `${className}_init`,
          args: [
            { kind: "local_get", id: selfLocalId, type: thisType },
            ...params.map((p) => ({ kind: "local_get" as const, id: p.id, type: p.type })),
          ],
          returnType: VOID,
          type: VOID,
        },
      },
      { kind: "return", value: { kind: "local_get", id: selfLocalId, type: thisType } },
    ],
    isAsync: false,
    captures: [],
  };

  return { init, constructor };
}

function lowerMethod(
  className: string,
  methodDef: SyntaxNode,
  classInfo: { fields: { name: string; type: HIRType }[] },
): HIRFunction {
  const methodName = methodDef.childForFieldName("name")!.text;
  const thisType: HIRType = { kind: "ptr", pointee: className };
  const thisId = freshId();

  const savedLocals = new Map(locals);
  locals = new Map();
  locals.set("self", { id: thisId, name: "self", type: thisType });

  const paramsNode = methodDef.childForFieldName("parameters")!;
  const returnTypeNode = methodDef.childForFieldName("return_type");
  const returnType = returnTypeNode ? resolveType(returnTypeNode) : VOID;
  const params: HIRParam[] = [{ id: thisId, name: "self", type: thisType }];

  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const p = paramsNode.namedChild(i)!;
    if (p.type === "identifier" && p.text === "self") continue;
    if (p.type === "typed_parameter" || p.type === "typed_default_parameter") {
      const pName = p.namedChild(0)!.text;
      const pType = resolveType(p.childForFieldName("type")!);
      const id = freshId();
      params.push({ id, name: pName, type: pType });
      locals.set(pName, { id, name: pName, type: pType });
    } else if (p.type === "identifier") {
      const id = freshId();
      params.push({ id, name: p.text, type: BOXED });
      locals.set(p.text, { id, name: p.text, type: BOXED });
    }
  }

  functions.set(`${className}_${methodName}`, {
    params: params.map((p) => p.type),
    returnType,
  });

  const savedClass = currentClassName;
  currentClassName = className;
  const body = lowerBlock(methodDef.childForFieldName("body")!);
  currentClassName = savedClass;

  locals = savedLocals;

  return {
    name: `${className}_${methodName}`,
    params,
    returnType,
    body,
    isAsync: false,
    captures: [],
  };
}

function lowerBlock(node: SyntaxNode): HIRStmt[] {
  const stmts: HIRStmt[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const prev = pendingStmts;
    pendingStmts = [];
    const lowered = lowerStmt(node.namedChild(i)!);
    stmts.push(...pendingStmts, ...lowered);
    pendingStmts = prev;
  }
  return stmts;
}

function lowerStmt(node: SyntaxNode): HIRStmt[] {
  switch (node.type) {
    case "expression_statement": {
      const inner = node.namedChild(0)!;
      if (inner.type === "assignment") {
        return lowerAssignment(inner);
      }
      if (inner.type === "augmented_assignment") {
        return lowerAugmentedAssignment(inner);
      }
      return [{ kind: "expr", expr: lowerExpr(inner) }];
    }
    case "return_statement": {
      const valNode = node.namedChild(0);
      return [{ kind: "return", value: valNode ? lowerExpr(valNode) : undefined }];
    }
    case "if_statement":
      return [lowerIfLike(node)];
    case "while_statement":
      return [lowerWhile(node)];
    case "for_statement":
      return lowerFor(node);
    case "break_statement":
      return [{ kind: "break" }];
    case "continue_statement":
      return [{ kind: "continue" }];
    case "pass_statement":
      return [];
    case "augmented_assignment":
      return lowerAugmentedAssignment(node);
    case "try_statement":
      return [lowerTryCatch(node)];
    case "raise_statement":
      return [lowerRaise(node)];
    case "delete_statement":
      return lowerDelete(node);
    case "assert_statement":
    case "import_statement":
    case "import_from_statement":
    case "global_statement":
    case "nonlocal_statement":
      return [];
    case "function_definition":
      lowerFunction(node);
      return [];
    default:
      throw new Error(`unsupported statement: ${node.type}`);
  }
}

function lowerAssignment(node: SyntaxNode): HIRStmt[] {
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
    return lowerAttributeAssign(nameNode, valueNode);
  }

  if (nameNode.type === "subscript") {
    const arrExpr = lowerExpr(nameNode.namedChild(0)!);
    const idxExpr = lowerExpr(nameNode.namedChild(1)!);
    const val = lowerExpr(valueNode!);
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
    return lowerPatternUnpack(nameNode, valueNode);
  }

  // Chained assignment: a = b = 5 → lower inner first, use result
  if (valueNode && valueNode.type === "assignment") {
    const innerStmts = lowerAssignment(valueNode);
    const innerNameNode = namedChildren(valueNode)[0];
    const innerName = innerNameNode.type === "identifier" ? innerNameNode.text : null;
    const innerLocal = innerName ? locals.get(innerName) : null;
    const outerValue: HIRExpr = innerLocal
      ? { kind: "local_get", id: innerLocal.id, type: innerLocal.type }
      : { kind: "literal_i64", value: 0, type: I64 };

    const name = nameNode.text;
    const existing = locals.get(name);
    if (existing) {
      return [...innerStmts, { kind: "expr", expr: { kind: "local_set", id: existing.id, value: coerceTo(outerValue, existing.type), type: existing.type } }];
    }
    const type = outerValue.type;
    const id = freshId();
    locals.set(name, { id, name, type });
    return [...innerStmts, { kind: "let", id, name, type, init: outerValue, mutable: true }];
  }

  const name = nameNode.text;
  const existing = locals.get(name);
  if (existing) {
    const value = valueNode
      ? coerceTo(lowerExpr(valueNode), existing.type)
      : { kind: "literal_i64" as const, value: 0, type: I64 };
    return [
      { kind: "expr", expr: { kind: "local_set", id: existing.id, value, type: existing.type } },
    ];
  }

  const type = typeNode
    ? resolveType(typeNode)
    : valueNode
      ? inferType(valueNode)
      : BOXED;
  const id = freshId();
  locals.set(name, { id, name, type });

  const init = valueNode ? lowerExpr(valueNode) : undefined;
  return [{ kind: "let", id, name, type, init, mutable: true }];
}

function lowerAttributeAssign(attrNode: SyntaxNode, valueNode: SyntaxNode | null): HIRStmt[] {
  const obj = lowerExpr(attrNode.namedChild(0)!);
  const fieldName = attrNode.namedChild(1)!.text;

  if (obj.type.kind === "ptr") {
    const cls = classes.get(obj.type.pointee);
    if (cls) {
      const fieldIdx = cls.fields.findIndex((f) => f.name === fieldName);
      if (fieldIdx >= 0) {
        const fieldType = cls.fields[fieldIdx].type;
        const value = valueNode ? coerceTo(lowerExpr(valueNode), fieldType) : defaultValue(fieldType);
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

function lowerAugmentedAssignment(node: SyntaxNode): HIRStmt[] {
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
    const local = locals.get(name);
    if (!local) throw new Error(`undefined variable: ${name}`);
    const rhs = lowerExpr(valueNode);
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
    const obj = lowerExpr(targetNode.namedChild(0)!);
    const fieldName = targetNode.namedChild(1)!.text;
    if (obj.type.kind === "ptr") {
      const cls = classes.get(obj.type.pointee);
      if (cls) {
        const fieldIdx = cls.fields.findIndex((f) => f.name === fieldName);
        if (fieldIdx >= 0) {
          const fieldType = cls.fields[fieldIdx].type;
          const rhs = lowerExpr(valueNode);
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

function lowerIfLike(node: SyntaxNode): HIRStmt {
  const condition = lowerExpr(node.childForFieldName("condition")!);
  const thenBlock = lowerBlock(node.childForFieldName("consequence")!);
  const alts = node.childrenForFieldName("alternative");
  const elseBlock = alts.length > 0 ? buildElifChain(alts, 0) : undefined;
  return { kind: "if", condition, then: thenBlock, else: elseBlock };
}

function buildElifChain(alts: SyntaxNode[], idx: number): HIRStmt[] | undefined {
  if (idx >= alts.length) return undefined;
  const alt = alts[idx];
  if (alt.type === "else_clause") {
    const body = alt.childForFieldName("body");
    return body ? lowerBlock(body) : lowerBlock(alt.namedChild(0)!);
  }
  if (alt.type === "elif_clause") {
    const condition = lowerExpr(alt.childForFieldName("condition")!);
    const thenBlock = lowerBlock(alt.childForFieldName("consequence")!);
    const elseBlock = buildElifChain(alts, idx + 1);
    return [{ kind: "if", condition, then: thenBlock, else: elseBlock }];
  }
  return undefined;
}

function lowerWhile(node: SyntaxNode): HIRStmt {
  const condition = lowerExpr(node.childForFieldName("condition")!);
  const body = lowerBlock(node.childForFieldName("body")!);
  return { kind: "while", condition, body };
}

function lowerFor(node: SyntaxNode): HIRStmt[] {
  const left = node.childForFieldName("left")!;
  const right = node.childForFieldName("right")!;
  const body = node.childForFieldName("body")!;

  if (right.type === "call" && right.childForFieldName("function")?.text === "range") {
    return lowerRangeFor(left, right, body);
  }

  if (right.type === "call" && right.childForFieldName("function")?.text === "enumerate") {
    return lowerEnumerateFor(left, right, body);
  }

  if (right.type === "call" && right.childForFieldName("function")?.text === "zip") {
    return lowerZipFor(left, right, body);
  }

  // dict.items() or dict.keys()
  if (right.type === "call") {
    const fn = right.childForFieldName("function");
    if (fn?.type === "attribute") {
      const method = fn.namedChild(1)!.text;
      if (method === "items" || method === "keys") {
        const dictExpr = lowerExpr(fn.namedChild(0)!);
        if (dictExpr.type.kind === "map") {
          return lowerMapFor(left, dictExpr, body, method === "items");
        }
      }
    }
  }

  const iterExpr = lowerExpr(right);
  if (iterExpr.type.kind === "map") {
    return lowerMapFor(left, iterExpr, body, left.type === "pattern_list");
  }
  if (iterExpr.type.kind === "set") {
    const elemType = (iterExpr.type as { kind: "set"; element: HIRType }).element;
    const prefix = elemType.kind === "i8ptr" ? "cs2_str_set" : "cs2_num_set";
    const valuesExpr: HIRExpr = {
      kind: "runtime_call", func: `${prefix}_values`,
      args: [iterExpr], returnType: { kind: "array", element: elemType }, type: { kind: "array", element: elemType },
    };
    return lowerArrayFor(left, valuesExpr, body);
  }
  return lowerArrayFor(left, iterExpr, body);
}

function lowerEnumerateFor(left: SyntaxNode, call: SyntaxNode, body: SyntaxNode): HIRStmt[] {
  const argsNode = call.childForFieldName("arguments")!;
  const iterExpr = lowerExpr(argsNode.namedChild(0)!);
  if (iterExpr.type.kind !== "array") {
    throw new Error("enumerate() requires array");
  }
  const elemType = iterExpr.type.element;
  const iterPrefix = elemType.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";

  const arrId = freshId();
  const iId = freshId();
  const elemId = freshId();
  locals.set("__enum_arr", { id: arrId, name: "__enum_arr", type: iterExpr.type });
  locals.set("__enum_i", { id: iId, name: "__enum_i", type: I64 });

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
      const idId = freshId();
      locals.set(idxName, { id: idId, name: idxName, type: I64 });
      bodyVars.push({ kind: "let", id: idId, name: idxName, type: I64, init: iRef, mutable: false });
    }
    if (valName) {
      locals.set(valName, { id: elemId, name: valName, type: elemType });
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
      body: [...bodyVars, ...lowerBlock(body)],
    },
  ];
}

function lowerZipFor(left: SyntaxNode, call: SyntaxNode, body: SyntaxNode): HIRStmt[] {
  const argsNode = call.childForFieldName("arguments")!;
  const arr1Expr = lowerExpr(argsNode.namedChild(0)!);
  const arr2Expr = lowerExpr(argsNode.namedChild(1)!);
  if (arr1Expr.type.kind !== "array" || arr2Expr.type.kind !== "array") {
    throw new Error("zip() requires arrays");
  }
  const elem1 = arr1Expr.type.element;
  const elem2 = arr2Expr.type.element;
  const p1 = elem1.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";
  const p2 = elem2.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";

  const a1Id = freshId();
  const a2Id = freshId();
  const iId = freshId();
  locals.set("__zip_a1", { id: a1Id, name: "__zip_a1", type: arr1Expr.type });
  locals.set("__zip_a2", { id: a2Id, name: "__zip_a2", type: arr2Expr.type });
  locals.set("__zip_i", { id: iId, name: "__zip_i", type: I64 });

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
      const id1 = freshId();
      locals.set(names[0], { id: id1, name: names[0], type: elem1 });
      bodyVars.push({
        kind: "let", id: id1, name: names[0], type: elem1,
        init: { kind: "index_get", array: a1Ref, index: iRef, type: elem1 }, mutable: false,
      });
    }
    if (names[1]) {
      const id2 = freshId();
      locals.set(names[1], { id: id2, name: names[1], type: elem2 });
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
      body: [...bodyVars, ...lowerBlock(body)],
    },
  ];
}

function lowerRangeFor(left: SyntaxNode, call: SyntaxNode, body: SyntaxNode): HIRStmt[] {
  const args = call.childForFieldName("arguments")!;
  const rangeArgs: SyntaxNode[] = [];
  for (let i = 0; i < args.namedChildCount; i++) rangeArgs.push(args.namedChild(i)!);

  let start: HIRExpr, end: HIRExpr, step: HIRExpr;
  if (rangeArgs.length === 1) {
    start = { kind: "literal_i64", value: 0, type: I64 };
    end = lowerExpr(rangeArgs[0]);
    step = { kind: "literal_i64", value: 1, type: I64 };
  } else if (rangeArgs.length === 2) {
    start = lowerExpr(rangeArgs[0]);
    end = lowerExpr(rangeArgs[1]);
    step = { kind: "literal_i64", value: 1, type: I64 };
  } else {
    start = lowerExpr(rangeArgs[0]);
    end = lowerExpr(rangeArgs[1]);
    step = lowerExpr(rangeArgs[2]);
  }

  const varName = left.text;
  const id = freshId();
  locals.set(varName, { id, name: varName, type: I64 });

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
      body: lowerBlock(body),
    },
  ];
}

function mapPrefix(keyType: HIRType, valueType: HIRType): string {
  const k = keyType.kind === "i8ptr" ? "str" : "num";
  const v = valueType.kind === "i8ptr" ? "str" : "num";
  return `cs2_${k}_${v}_map`;
}

function lowerMapFor(left: SyntaxNode, mapExpr: HIRExpr, body: SyntaxNode, unpack: boolean): HIRStmt[] {
  const mt = mapExpr.type as { kind: "map"; key: HIRType; value: HIRType };
  const prefix = mapPrefix(mt.key, mt.value);
  const mapType: HIRType = { kind: "map", key: mt.key, value: mt.value };

  const mapId = freshId();
  const iId = freshId();
  locals.set("__formap_map", { id: mapId, name: "__formap_map", type: mapType });
  locals.set("__formap_i", { id: iId, name: "__formap_i", type: I64 });

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
      const keyId = freshId();
      locals.set(keyName, { id: keyId, name: keyName, type: mt.key });
      bodyVars.push({
        kind: "let", id: keyId, name: keyName, type: mt.key,
        init: { kind: "runtime_call", func: `${prefix}_key_at`, args: [mapRef, iRef], returnType: mt.key, type: mt.key },
        mutable: false,
      });
    }
    if (valName) {
      const valId = freshId();
      locals.set(valName, { id: valId, name: valName, type: mt.value });
      bodyVars.push({
        kind: "let", id: valId, name: valName, type: mt.value,
        init: { kind: "runtime_call", func: `${prefix}_value_at`, args: [mapRef, iRef], returnType: mt.value, type: mt.value },
        mutable: false,
      });
    }
  } else {
    const keyName = left.text;
    const keyId = freshId();
    locals.set(keyName, { id: keyId, name: keyName, type: mt.key });
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
      body: [...bodyVars, ...lowerBlock(body)],
    },
  ];
}

function lowerArrayFor(left: SyntaxNode, arrExpr: HIRExpr, body: SyntaxNode): HIRStmt[] {
  if (arrExpr.type.kind !== "array") {
    throw new Error(`for...in requires array type, got ${arrExpr.type.kind}`);
  }
  const elemType = arrExpr.type.element;
  const prefix = elemType.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";

  const arrId = freshId();
  const iId = freshId();
  const elemId = freshId();
  const varName = left.text;

  locals.set("__forin_arr", { id: arrId, name: "__forin_arr", type: arrExpr.type });
  locals.set("__forin_i", { id: iId, name: "__forin_i", type: I64 });
  locals.set(varName, { id: elemId, name: varName, type: elemType });

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
        ...lowerBlock(body),
      ],
    },
  ];
}

function lowerExpr(node: SyntaxNode): HIRExpr {
  switch (node.type) {
    case "integer":
      return { kind: "literal_i64", value: parseInt(node.text, 10), type: I64 };
    case "float":
      return { kind: "literal_f64", value: parseFloat(node.text), type: F64 };
    case "string":
      return lowerString(node);
    case "true":
      return { kind: "literal_i1", value: true, type: I1 };
    case "false":
      return { kind: "literal_i1", value: false, type: I1 };
    case "none":
      return { kind: "literal_null", type: VOID };
    case "identifier":
      return lowerIdentifier(node);
    case "binary_operator":
      return lowerBinaryOp(node);
    case "comparison_operator":
      return lowerComparison(node);
    case "boolean_operator":
      return lowerBooleanOp(node);
    case "unary_operator":
      return lowerUnaryOp(node);
    case "not_operator":
      return { kind: "unary", op: "not", operand: lowerExpr(node.namedChild(0)!), type: I1 };
    case "call":
      return lowerCall(node);
    case "parenthesized_expression":
      return lowerExpr(node.namedChild(0)!);
    case "list":
      return lowerListLiteral(node);
    case "list_comprehension":
      return lowerListComp(node);
    case "dictionary_comprehension":
      return lowerDictComp(node);
    case "dictionary":
      return lowerDictLiteral(node);
    case "tuple":
    case "expression_list":
      return lowerTupleLiteral(node);
    case "subscript":
      return lowerSubscript(node);
    case "attribute":
      return lowerAttribute(node);
    case "lambda": {
      const lambdaId = freshId();
      const lambdaName = `__lambda_${lambdaId}`;
      const fn = lowerLambda(node, lambdaName);
      pendingFunctions.push(fn);
      functions.set(lambdaName, { params: fn.params.map((p) => p.type), returnType: fn.returnType });
      const closureType: HIRType = { kind: "closure", params: fn.params.map((p) => p.type), returnType: fn.returnType };
      return { kind: "make_closure", funcName: lambdaName, captures: [], type: closureType };
    }
    default:
      throw new Error(`unsupported expression: ${node.type} "${node.text}"`);
  }
}

function lowerLambda(node: SyntaxNode, name: string): HIRFunction {
  const paramsNode = node.childForFieldName("parameters");
  const savedLocals = new Map(locals);
  const envParam: HIRParam = { id: freshId(), name: "__env", type: I8PTR };
  const hirParams: HIRParam[] = [envParam];

  if (paramsNode) {
    for (let i = 0; i < paramsNode.namedChildCount; i++) {
      const p = paramsNode.namedChild(i)!;
      const paramId = freshId();
      const paramName = p.type === "typed_parameter" ? p.namedChild(0)!.text : p.text;
      const paramType = p.type === "typed_parameter" ? resolveType(p.childForFieldName("type")!) : F64;
      hirParams.push({ id: paramId, name: paramName, type: paramType });
      locals.set(paramName, { id: paramId, name: paramName, type: paramType });
    }
  }

  const bodyNode = node.childForFieldName("body")!;
  const bodyExpr = lowerExpr(bodyNode);
  locals = savedLocals;

  return {
    name,
    params: hirParams,
    returnType: bodyExpr.type,
    body: [{ kind: "return", value: bodyExpr }],
    isAsync: false,
    captures: [],
  };
}

function lowerString(node: SyntaxNode): HIRExpr {
  const start = node.childCount > 0 ? node.child(0)!.text : "";
  if (start.startsWith("f") || start.startsWith("F")) {
    return lowerFString(node);
  }
  return { kind: "literal_string", value: extractStringContent(node), type: I8PTR };
}

function lowerFString(node: SyntaxNode): HIRExpr {
  const parts: HIRExpr[] = [];

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)!;
    if (child.type === "string_content") {
      if (child.text) parts.push({ kind: "literal_string", value: child.text, type: I8PTR });
    } else if (child.type === "escape_sequence") {
      parts.push({ kind: "literal_string", value: interpretEscape(child.text), type: I8PTR });
    } else if (child.type === "interpolation") {
      parts.push(lowerExpr(child.namedChild(0)!));
    }
  }

  if (parts.length === 0) return { kind: "literal_string", value: "", type: I8PTR };
  if (parts.length === 1 && parts[0].type.kind === "i8ptr") return parts[0];

  let result = parts[0];
  if (result.type.kind !== "i8ptr") {
    result = {
      kind: "runtime_call",
      func: "cs_string_concat",
      args: [{ kind: "literal_string", value: "", type: I8PTR }, result],
      returnType: I8PTR,
      type: I8PTR,
    };
  }
  for (let i = 1; i < parts.length; i++) {
    result = {
      kind: "runtime_call",
      func: "cs_string_concat",
      args: [result, parts[i]],
      returnType: I8PTR,
      type: I8PTR,
    };
  }
  return result;
}

function lowerListLiteral(node: SyntaxNode): HIRExpr {
  if (node.namedChildCount === 0) {
    return { kind: "alloc_array", elementType: F64, initialValues: [], type: { kind: "array", element: F64 } };
  }
  const elements = namedChildren(node).map((c) => lowerExpr(c));
  const rawType = elements[0].type;
  // num arrays store f64; coerce int element type to f64 for storage
  const elemType = rawType.kind === "i64" ? F64 : rawType;
  return {
    kind: "alloc_array",
    elementType: elemType,
    initialValues: elements.map((e) => coerceTo(e, elemType)),
    type: { kind: "array", element: elemType },
  };
}

function lowerSubscript(node: SyntaxNode): HIRExpr {
  const arr = lowerExpr(node.namedChild(0)!);
  const idx = lowerExpr(node.namedChild(1)!);
  if (arr.type.kind === "array") {
    return { kind: "index_get", array: arr, index: coerceTo(idx, I64), type: arr.type.element };
  }
  if (arr.type.kind === "map") {
    const mt = arr.type as { kind: "map"; key: HIRType; value: HIRType };
    const prefix = mapPrefix(mt.key, mt.value);
    return {
      kind: "runtime_call",
      func: `${prefix}_get`,
      args: [arr, coerceTo(idx, mt.key)],
      returnType: mt.value,
      type: mt.value,
    };
  }
  if (arr.type.kind === "i8ptr") {
    return {
      kind: "runtime_call",
      func: "cs2_str_char_at",
      args: [arr, coerceTo(idx, I64)],
      returnType: I8PTR,
      type: I8PTR,
    };
  }
  throw new Error(`subscript on unsupported type: ${arr.type.kind}`);
}

function lowerAttribute(node: SyntaxNode): HIRExpr {
  const objNode = node.namedChild(0)!;
  const fieldName = node.namedChild(1)!.text;

  if (objNode.text === "math") {
    switch (fieldName) {
      case "pi": return { kind: "literal_f64", value: Math.PI, type: F64 };
      case "e": return { kind: "literal_f64", value: Math.E, type: F64 };
      case "inf": return { kind: "literal_f64", value: Infinity, type: F64 };
      case "tau": return { kind: "literal_f64", value: 2 * Math.PI, type: F64 };
    }
  }

  const obj = lowerExpr(objNode);

  if (obj.type.kind === "ptr") {
    const cls = classes.get(obj.type.pointee);
    if (cls) {
      const fieldIdx = cls.fields.findIndex((f) => f.name === fieldName);
      if (fieldIdx >= 0) {
        return {
          kind: "field_get",
          object: obj,
          fieldName,
          index: fieldIdx,
          type: cls.fields[fieldIdx].type,
        };
      }
    }
  }
  throw new Error(`unknown attribute: ${fieldName} on ${obj.type.kind}`);
}

function lowerIdentifier(node: SyntaxNode): HIRExpr {
  const name = node.text;
  const local = locals.get(name);
  if (local) return { kind: "local_get", id: local.id, type: local.type };
  if (name === "math") return { kind: "literal_null", type: VOID };
  throw new Error(`undefined variable: ${name}`);
}

function lowerBinaryOp(node: SyntaxNode): HIRExpr {
  const left = lowerExpr(node.namedChild(0)!);
  const right = lowerExpr(node.namedChild(1)!);
  const opNode = node.child(1)!;
  const op = opNode.text;

  if (op === "+" && (left.type.kind === "i8ptr" || right.type.kind === "i8ptr")) {
    return {
      kind: "runtime_call",
      func: "cs_string_concat",
      args: [left, right],
      returnType: I8PTR,
      type: I8PTR,
    };
  }

  if (op === "**") {
    return {
      kind: "runtime_call",
      func: "pow",
      args: [coerceToF64(left), coerceToF64(right)],
      returnType: F64,
      type: F64,
    };
  }

  const opMap: Record<string, string> = {
    "+": "add",
    "-": "sub",
    "*": "mul",
    "/": "div",
    "%": "rem",
    "//": "div",
    "<<": "shl",
    ">>": "shr",
    "&": "bit_and",
    "|": "bit_or",
    "^": "bit_xor",
  };
  const hirOp = opMap[op];
  if (!hirOp) throw new Error(`unsupported binary operator: ${op}`);

  const resultType = resolveArithResultType(left.type, right.type);
  return {
    kind: "binary",
    op: hirOp as any,
    left: coerceTo(left, resultType),
    right: coerceTo(right, resultType),
    type: resultType,
  };
}

function lowerComparison(node: SyntaxNode): HIRExpr {
  const left = lowerExpr(node.namedChild(0)!);
  const right = lowerExpr(node.namedChild(1)!);

  const opParts: string[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)!;
    if (!c.isNamed) {
      const t = c.text.trim();
      if (t) opParts.push(t);
    }
  }
  const opText = opParts.join(" ");

  if (opText === "in" || opText === "not in") {
    const rightType = right.type;
    if (rightType.kind === "map") {
      const mt = rightType as { kind: "map"; key: HIRType; value: HIRType };
      const prefix = mapPrefix(mt.key, mt.value);
      const hasExpr: HIRExpr = {
        kind: "runtime_call",
        func: `${prefix}_has`,
        args: [right, coerceTo(left, mt.key)],
        returnType: I1,
        type: I1,
      };
      return opText === "not in"
        ? { kind: "unary", op: "not", operand: hasExpr, type: I1 }
        : hasExpr;
    }
    if (rightType.kind === "set") {
      const elemType = (rightType as { kind: "set"; element: HIRType }).element;
      const prefix = elemType.kind === "i8ptr" ? "cs2_str_set" : "cs2_num_set";
      const hasExpr: HIRExpr = {
        kind: "runtime_call",
        func: `${prefix}_has`,
        args: [right, coerceTo(left, elemType)],
        returnType: I1,
        type: I1,
      };
      return opText === "not in"
        ? { kind: "unary", op: "not", operand: hasExpr, type: I1 }
        : hasExpr;
    }
    if (rightType.kind === "array") {
      const elemType = (rightType as { kind: "array"; element: HIRType }).element;
      const prefix = elemType.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";
      const hasExpr: HIRExpr = {
        kind: "runtime_call",
        func: `${prefix}_index_of`,
        args: [right, coerceTo(left, elemType)],
        returnType: I64,
        type: I64,
      };
      const geZero: HIRExpr = { kind: "binary", op: "ge", left: hasExpr, right: { kind: "literal_i64", value: 0, type: I64 }, type: I1 };
      return opText === "not in"
        ? { kind: "unary", op: "not", operand: geZero, type: I1 }
        : geZero;
    }
    throw new Error(`'${opText}' not supported for type: ${rightType.kind}`);
  }

  if (opText === "is" || opText === "is not") {
    const isNullCheck = right.type.kind === "void" || (right.kind === "literal_null" as any);
    let cmp: HIRExpr;
    if (isNullCheck && left.type.kind === "ptr") {
      cmp = { kind: "binary", op: "eq", left, right: { kind: "literal_null", type: left.type }, type: I1 };
    } else {
      const commonType = resolveArithResultType(left.type, right.type);
      cmp = { kind: "binary", op: "eq", left: coerceTo(left, commonType), right: coerceTo(right, commonType), type: I1 };
    }
    return opText === "is not" ? { kind: "unary", op: "not", operand: cmp, type: I1 } : cmp;
  }

  const opMap: Record<string, string> = {
    "==": "eq", "!=": "ne", "<": "lt", "<=": "le", ">": "gt", ">=": "ge",
  };
  const hirOp = opMap[opText];
  if (!hirOp) throw new Error(`unsupported comparison operator: ${opText}`);

  const commonType = resolveArithResultType(left.type, right.type);
  return {
    kind: "binary",
    op: hirOp as any,
    left: coerceTo(left, commonType),
    right: coerceTo(right, commonType),
    type: I1,
  };
}

function lowerBooleanOp(node: SyntaxNode): HIRExpr {
  const left = lowerExpr(node.namedChild(0)!);
  const right = lowerExpr(node.namedChild(1)!);
  const op = node.child(1)!.text;
  return {
    kind: "binary",
    op: op === "and" ? "and" : "or",
    left,
    right,
    type: left.type,
  };
}

function lowerUnaryOp(node: SyntaxNode): HIRExpr {
  const opText = node.child(0)!.text;
  const operand = lowerExpr(node.namedChild(0)!);
  switch (opText) {
    case "-":
      return { kind: "unary", op: "neg", operand, type: operand.type };
    case "~":
      return { kind: "unary", op: "bit_not", operand, type: operand.type };
    default:
      throw new Error(`unsupported unary operator: ${opText}`);
  }
}

function lowerCall(node: SyntaxNode): HIRExpr {
  const funcNode = node.childForFieldName("function")!;
  const argsNode = node.childForFieldName("arguments")!;

  function buildPositionalArgs(): HIRExpr[] {
    const result: HIRExpr[] = [];
    for (let i = 0; i < argsNode.namedChildCount; i++) {
      const a = argsNode.namedChild(i)!;
      if (a.type !== "keyword_argument") result.push(lowerExpr(a));
    }
    return result;
  }

  function getKwarg(name: string): SyntaxNode | undefined {
    for (let i = 0; i < argsNode.namedChildCount; i++) {
      const a = argsNode.namedChild(i)!;
      if (a.type === "keyword_argument" && a.namedChild(0)!.text === name) {
        return a.namedChild(1)!;
      }
    }
    return undefined;
  }

  if (funcNode.type === "attribute") {
    const args = buildPositionalArgs();

    // math.method(args)
    if (funcNode.namedChild(0)!.text === "math") {
      const mathMethod = funcNode.namedChild(1)!.text;
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
      if (mathFn) {
        return {
          kind: "runtime_call",
          func: mathFn,
          args: args.map(coerceToF64),
          returnType: F64, type: F64,
        };
      }
    }

    // super().method(args) → ParentClass_method(self, args)
    const objNode = funcNode.namedChild(0)!;
    if (objNode.type === "call" && objNode.childForFieldName("function")?.text === "super") {
      const rawMethodName = funcNode.namedChild(1)!.text;
      const methodName = rawMethodName === "__init__" ? "init" : rawMethodName;
      const parentName = currentClassName ? classParents.get(currentClassName) : undefined;
      if (parentName) {
        const fnKey = `${parentName}_${methodName}`;
        const fnInfo = functions.get(fnKey);
        const returnType = fnInfo?.returnType ?? VOID;
        const selfLocal = locals.get("self");
        const selfExpr: HIRExpr = selfLocal
          ? { kind: "local_get", id: selfLocal.id, type: selfLocal.type }
          : { kind: "literal_null", type: VOID };
        return { kind: "call", callee: fnKey, args: [selfExpr, ...args], returnType, type: returnType };
      }
    }

    return lowerMethodCall(funcNode, args);
  }

  const args = buildPositionalArgs();
  const funcName = funcNode.text;

  if (funcName === "print") {
    if (args.length === 0) {
      return {
        kind: "runtime_call",
        func: "cs_console_log",
        args: [{ kind: "literal_string", value: "", type: I8PTR }],
        returnType: VOID,
        type: VOID,
      };
    }
    const printArgs = args.map((a): HIRExpr =>
      a.type.kind === "i1"
        ? { kind: "runtime_call", func: "cs2_py_bool_str", args: [a], returnType: I8PTR, type: I8PTR }
        : a
    );
    return { kind: "runtime_call", func: "cs_console_log", args: printArgs, returnType: VOID, type: VOID };
  }

  if (funcName === "len") {
    const arg = args[0];
    if (arg.type.kind === "array") {
      const prefix = arg.type.element.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";
      return { kind: "runtime_call", func: `${prefix}_length`, args: [arg], returnType: I64, type: I64 };
    }
    if (arg.type.kind === "map") {
      const mt = arg.type as { kind: "map"; key: HIRType; value: HIRType };
      return { kind: "runtime_call", func: `${mapPrefix(mt.key, mt.value)}_size`, args: [arg], returnType: I64, type: I64 };
    }
    if (arg.type.kind === "set") {
      const elemType = (arg.type as { kind: "set"; element: HIRType }).element;
      const prefix = elemType.kind === "i8ptr" ? "cs2_str_set" : "cs2_num_set";
      return { kind: "runtime_call", func: `${prefix}_size`, args: [arg], returnType: I64, type: I64 };
    }
    if (arg.type.kind === "i8ptr") {
      return { kind: "runtime_call", func: "cs2_str_length", args: [arg], returnType: I64, type: I64 };
    }
    throw new Error(`len() on unsupported type: ${arg.type.kind}`);
  }

  if (funcName === "str") {
    if (args.length === 0) return { kind: "literal_string", value: "", type: I8PTR };
    const arg = args[0];
    if (arg.type.kind === "i8ptr") return arg;
    return {
      kind: "runtime_call",
      func: "cs_string_concat",
      args: [{ kind: "literal_string", value: "", type: I8PTR }, arg],
      returnType: I8PTR,
      type: I8PTR,
    };
  }

  if (funcName === "int") {
    if (args.length === 1) return coerceTo(args[0], I64);
    return { kind: "literal_i64", value: 0, type: I64 };
  }

  if (funcName === "float") {
    if (args.length === 1) return coerceToF64(args[0]);
    return { kind: "literal_f64", value: 0, type: F64 };
  }

  if (funcName === "abs") {
    return {
      kind: "runtime_call",
      func: "cs_math_abs",
      args: [coerceToF64(args[0])],
      returnType: F64,
      type: F64,
    };
  }

  if (funcName === "bool") {
    if (args.length === 1) return coerceTo(args[0], I1);
    return { kind: "literal_i1", value: false, type: I1 };
  }

  if (funcName === "sum") {
    const arg = args[0];
    if (arg.type.kind === "array") {
      return { kind: "runtime_call", func: "cs2_num_array_sum", args: [arg], returnType: F64, type: F64 };
    }
    return { kind: "literal_f64", value: 0, type: F64 };
  }

  if (funcName === "min") {
    if (args.length === 1 && args[0].type.kind === "array") {
      return { kind: "runtime_call", func: "cs2_num_array_min", args: [args[0]], returnType: F64, type: F64 };
    }
    if (args.length === 2) {
      return {
        kind: "runtime_call",
        func: "cs_math_min",
        args: [coerceToF64(args[0]), coerceToF64(args[1])],
        returnType: F64, type: F64,
      };
    }
    return args[0] ?? { kind: "literal_f64", value: 0, type: F64 };
  }

  if (funcName === "max") {
    if (args.length === 1 && args[0].type.kind === "array") {
      return { kind: "runtime_call", func: "cs2_num_array_max", args: [args[0]], returnType: F64, type: F64 };
    }
    if (args.length === 2) {
      return {
        kind: "runtime_call",
        func: "cs_math_max",
        args: [coerceToF64(args[0]), coerceToF64(args[1])],
        returnType: F64, type: F64,
      };
    }
    return args[0] ?? { kind: "literal_f64", value: 0, type: F64 };
  }

  if (funcName === "sorted") {
    const arg = args[0];
    if (arg.type.kind === "array") {
      const prefix = arg.type.element.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";
      const copyExpr: HIRExpr = {
        kind: "runtime_call", func: "cs2_num_array_copy", args: [arg], returnType: arg.type, type: arg.type,
      };
      const copyId = freshId();
      const copyName = `__sorted_${copyId}`;
      locals.set(copyName, { id: copyId, name: copyName, type: arg.type });
      pendingStmts.push({ kind: "let", id: copyId, name: copyName, type: arg.type, init: copyExpr, mutable: false });
      const copyRef: HIRExpr = { kind: "local_get", id: copyId, type: arg.type };
      const keyNode = getKwarg("key");
      if (keyNode && keyNode.type === "lambda") {
        const lambdaId = freshId();
        const lambdaName = `__lambda_${lambdaId}`;
        const fn = lowerLambda(keyNode, lambdaName);
        pendingFunctions.push(fn);
        functions.set(lambdaName, { params: fn.params.map((p) => p.type), returnType: fn.returnType });
        const closureType: HIRType = { kind: "closure", params: fn.params.map((p) => p.type), returnType: fn.returnType };
        const closureExpr: HIRExpr = { kind: "make_closure", funcName: lambdaName, captures: [], type: closureType };
        pendingStmts.push({
          kind: "expr",
          expr: { kind: "array_hof", method: "forEach", array: copyRef, callback: closureExpr,
                  bridgeFunc: `${prefix}_sort_by`, returnType: VOID, type: VOID },
        });
      } else {
        pendingStmts.push({
          kind: "expr",
          expr: { kind: "runtime_call", func: `${prefix}_sort`, args: [copyRef], returnType: VOID, type: VOID },
        });
      }
      const reverseNode = getKwarg("reverse");
      if (reverseNode && reverseNode.text === "True") {
        pendingStmts.push({
          kind: "expr",
          expr: { kind: "runtime_call", func: `${prefix}_reverse`, args: [copyRef], returnType: VOID, type: VOID },
        });
      }
      return copyRef;
    }
    return arg;
  }

  if (funcName === "reversed") {
    const arg = args[0];
    if (arg.type.kind === "array") {
      const copyExpr: HIRExpr = {
        kind: "runtime_call", func: "cs2_num_array_copy", args: [arg], returnType: arg.type, type: arg.type,
      };
      const copyId = freshId();
      const copyName = `__reversed_${copyId}`;
      locals.set(copyName, { id: copyId, name: copyName, type: arg.type });
      pendingStmts.push({ kind: "let", id: copyId, name: copyName, type: arg.type, init: copyExpr, mutable: false });
      const copyRef: HIRExpr = { kind: "local_get", id: copyId, type: arg.type };
      pendingStmts.push({
        kind: "expr",
        expr: { kind: "runtime_call", func: "cs2_num_array_reverse", args: [copyRef], returnType: VOID, type: VOID },
      });
      return copyRef;
    }
    return arg;
  }

  if (funcName === "map") {
    if (argsNode.namedChildCount >= 2) {
      const fnNode = argsNode.namedChild(0)!;
      const lstExpr = lowerExpr(argsNode.namedChild(1)!);
      if (lstExpr.type.kind === "array") {
        const closureExpr = lowerExpr(fnNode);
        const prefix = lstExpr.type.element.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";
        return { kind: "array_hof", method: "map", array: lstExpr, callback: closureExpr,
                 bridgeFunc: `${prefix}_map`, returnType: lstExpr.type, type: lstExpr.type };
      }
    }
    return { kind: "alloc_array", elementType: F64, initialValues: [], type: { kind: "array", element: F64 } };
  }

  if (funcName === "filter") {
    if (argsNode.namedChildCount >= 2) {
      const fnNode = argsNode.namedChild(0)!;
      const lstExpr = lowerExpr(argsNode.namedChild(1)!);
      if (lstExpr.type.kind === "array") {
        const closureExpr = lowerExpr(fnNode);
        const prefix = lstExpr.type.element.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";
        return { kind: "array_hof", method: "filter", array: lstExpr, callback: closureExpr,
                 bridgeFunc: `${prefix}_filter`, returnType: lstExpr.type, type: lstExpr.type };
      }
    }
    return { kind: "alloc_array", elementType: F64, initialValues: [], type: { kind: "array", element: F64 } };
  }

  if (funcName === "range") {
    return { kind: "literal_i64", value: 0, type: I64 };
  }

  if (funcName === "dict") {
    const mapType: HIRType = { kind: "map", key: I8PTR, value: I8PTR };
    return { kind: "alloc_map", keyType: I8PTR, valueType: I8PTR, entries: [], type: mapType };
  }

  if (funcName === "list") {
    if (args.length === 1 && args[0].type.kind === "array") return args[0];
    return { kind: "alloc_array", elementType: F64, initialValues: [], type: { kind: "array", element: F64 } };
  }

  if (funcName === "set") {
    if (args.length === 1 && args[0].type.kind === "array") {
      const elemType = (args[0].type as { kind: "array"; element: HIRType }).element;
      const setType: HIRType = { kind: "set", element: elemType };
      const prefix = elemType.kind === "i8ptr" ? "cs2_str_set" : "cs2_num_set";
      const setId = freshId();
      const setName = `__set_${setId}`;
      locals.set(setName, { id: setId, name: setName, type: setType });
      const setRef: HIRExpr = { kind: "local_get", id: setId, type: setType };
      const arrRef = args[0];
      const iId = freshId();
      const iName = `__si_${iId}`;
      locals.set(iName, { id: iId, name: iName, type: I64 });
      const iRef: HIRExpr = { kind: "local_get", id: iId, type: I64 };
      const lenExpr: HIRExpr = { kind: "runtime_call",
        func: elemType.kind === "i8ptr" ? "cs2_str_array_length" : "cs2_num_array_length",
        args: [arrRef], returnType: I64, type: I64 };
      const elemExpr: HIRExpr = { kind: "index_get", array: arrRef, index: iRef, type: elemType };
      pendingStmts.push(
        { kind: "let", id: setId, name: setName, type: setType,
          init: { kind: "alloc_set", element: elemType, elements: [], type: setType }, mutable: false },
        { kind: "let", id: iId, name: iName, type: I64,
          init: { kind: "literal_i64", value: 0, type: I64 }, mutable: true },
        { kind: "for",
          condition: { kind: "binary", op: "lt", left: iRef, right: lenExpr, type: I1 },
          update: { kind: "local_set", id: iId,
            value: { kind: "binary", op: "add", left: iRef, right: { kind: "literal_i64", value: 1, type: I64 }, type: I64 },
            type: I64 },
          body: [{ kind: "expr",
            expr: { kind: "runtime_call", func: `${prefix}_add`, args: [setRef, elemExpr], returnType: VOID, type: VOID } }] }
      );
      return setRef;
    }
    const setType: HIRType = { kind: "set", element: F64 };
    return { kind: "alloc_set", element: F64, elements: [], type: setType };
  }

  if (funcName === "any") {
    const arg = args[0];
    if (arg.type.kind === "array") {
      const elemType = (arg.type as { kind: "array"; element: HIRType }).element;
      const prefix = elemType.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";
      return { kind: "runtime_call", func: `${prefix}_any`, args: [arg], returnType: I1, type: I1 };
    }
    return { kind: "literal_i1", value: false, type: I1 };
  }

  if (funcName === "all") {
    const arg = args[0];
    if (arg.type.kind === "array") {
      const elemType = (arg.type as { kind: "array"; element: HIRType }).element;
      const prefix = elemType.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";
      return { kind: "runtime_call", func: `${prefix}_all`, args: [arg], returnType: I1, type: I1 };
    }
    return { kind: "literal_i1", value: true, type: I1 };
  }

  const classInfo = classes.get(funcName);
  if (classInfo) {
    const thisType: HIRType = { kind: "ptr", pointee: funcName };
    return {
      kind: "call",
      callee: `${funcName}_constructor`,
      args,
      returnType: thisType,
      type: thisType,
    };
  }

  const fnInfo = functions.get(funcName);
  if (fnInfo) {
    return { kind: "call", callee: funcName, args, returnType: fnInfo.returnType, type: fnInfo.returnType };
  }

  return { kind: "call", callee: funcName, args, returnType: I64, type: I64 };
}

function lowerMethodCall(attrNode: SyntaxNode, args: HIRExpr[]): HIRExpr {
  const obj = lowerExpr(attrNode.namedChild(0)!);
  const methodName = attrNode.namedChild(1)!.text;

  if (obj.type.kind === "ptr") {
    const cls = classes.get(obj.type.pointee);
    if (cls) {
      const owner = resolveMethodOwner(obj.type.pointee, methodName);
      const fnKey = `${owner}_${methodName}`;
      const fnInfo = functions.get(fnKey);
      const returnType = fnInfo?.returnType ?? VOID;
      const selfType: HIRType = { kind: "ptr", pointee: owner };
      return {
        kind: "call",
        callee: fnKey,
        args: [obj.type.pointee === owner ? obj : { ...obj, type: selfType }, ...args],
        returnType,
        type: returnType,
      };
    }
  }

  if (obj.type.kind === "map") {
    const mt = obj.type as { kind: "map"; key: HIRType; value: HIRType };
    const prefix = mapPrefix(mt.key, mt.value);
    const mapType = obj.type;
    switch (methodName) {
      case "get": {
        if (args.length >= 2) {
          return {
            kind: "runtime_call",
            func: `${prefix}_get_or`,
            args: [obj, coerceTo(args[0], mt.key), coerceTo(args[1], mt.value)],
            returnType: mt.value,
            type: mt.value,
          };
        }
        return {
          kind: "runtime_call",
          func: `${prefix}_get`,
          args: [obj, coerceTo(args[0], mt.key)],
          returnType: mt.value,
          type: mt.value,
        };
      }
      case "pop":
        return { kind: "runtime_call", func: `${prefix}_delete`, args: [obj, coerceTo(args[0], mt.key)], returnType: I64, type: I64 };
      case "keys":
        return { kind: "runtime_call", func: `${prefix}_keys`, args: [obj], returnType: { kind: "array", element: mt.key }, type: { kind: "array", element: mt.key } };
      case "values":
        return { kind: "runtime_call", func: `${prefix}_values`, args: [obj], returnType: { kind: "array", element: mt.value }, type: { kind: "array", element: mt.value } };
      case "items":
        return obj;
      case "clear":
        return { kind: "runtime_call", func: `${prefix}_clear`, args: [obj], returnType: VOID, type: VOID };
      case "update": {
        if (args.length > 0) {
          return { kind: "runtime_call", func: `${prefix}_copy`, args: [args[0]], returnType: mapType, type: mapType };
        }
        return obj;
      }
      default:
        throw new Error(`unsupported map method: ${methodName}`);
    }
  }

  if (obj.type.kind === "set") {
    const elemType = (obj.type as { kind: "set"; element: HIRType }).element;
    const prefix = elemType.kind === "i8ptr" ? "cs2_str_set" : "cs2_num_set";
    switch (methodName) {
      case "add":
        return { kind: "runtime_call", func: `${prefix}_add`, args: [obj, coerceTo(args[0], elemType)], returnType: VOID, type: VOID };
      case "remove":
      case "discard":
        return { kind: "runtime_call", func: `${prefix}_delete`, args: [obj, coerceTo(args[0], elemType)], returnType: I64, type: I64 };
      case "clear":
        return { kind: "runtime_call", func: `${prefix}_clear`, args: [obj], returnType: VOID, type: VOID };
      case "values":
      case "__iter__": {
        const arrType: HIRType = { kind: "array", element: elemType };
        return { kind: "runtime_call", func: `${prefix}_values`, args: [obj], returnType: arrType, type: arrType };
      }
      default:
        throw new Error(`unsupported set method: ${methodName}`);
    }
  }

  if (obj.type.kind === "array") {
    const elemType = obj.type.element;
    const prefix = elemType.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";
    switch (methodName) {
      case "append":
        return {
          kind: "runtime_call",
          func: `${prefix}_push`,
          args: [obj, coerceTo(args[0], elemType)],
          returnType: VOID,
          type: VOID,
        };
      case "pop":
        return { kind: "runtime_call", func: `${prefix}_pop`, args: [obj], returnType: elemType, type: elemType };
      case "reverse":
        return { kind: "runtime_call", func: `${prefix}_reverse`, args: [obj], returnType: VOID, type: VOID };
      case "index":
        return {
          kind: "runtime_call",
          func: `${prefix}_index_of`,
          args: [obj, coerceTo(args[0], elemType)],
          returnType: I64,
          type: I64,
        };
      default:
        throw new Error(`unsupported array method: ${methodName}`);
    }
  }

  if (obj.type.kind === "i8ptr") {
    const strMethods: Record<string, { func: string; returnType: HIRType }> = {
      upper: { func: "cs2_str_to_upper", returnType: I8PTR },
      lower: { func: "cs2_str_to_lower", returnType: I8PTR },
      strip: { func: "cs2_str_trim", returnType: I8PTR },
      lstrip: { func: "cs2_str_trim_start", returnType: I8PTR },
      rstrip: { func: "cs2_str_trim_end", returnType: I8PTR },
      replace: { func: "cs2_str_replace", returnType: I8PTR },
      startswith: { func: "cs2_str_starts_with", returnType: I1 },
      endswith: { func: "cs2_str_ends_with", returnType: I1 },
      find: { func: "cs2_str_index_of", returnType: I64 },
      index: { func: "cs2_str_index_of", returnType: I64 },
    };
    const info = strMethods[methodName];
    if (info) {
      return { kind: "runtime_call", func: info.func, args: [obj, ...args], returnType: info.returnType, type: info.returnType };
    }
    if (methodName === "split") {
      const sep = args[0] ?? { kind: "literal_string", value: " ", type: I8PTR };
      return { kind: "runtime_call", func: "cs2_str_split", args: [obj, sep], returnType: { kind: "array", element: I8PTR }, type: { kind: "array", element: I8PTR } };
    }
    throw new Error(`unsupported string method: ${methodName}`);
  }

  throw new Error(`method call on unsupported type: ${methodName} on ${obj.type.kind}`);
}

function extractStringContent(node: SyntaxNode): string {
  let result = "";
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)!;
    if (child.type === "string_content") {
      result += child.text;
    } else if (child.type === "escape_sequence") {
      result += interpretEscape(child.text);
    }
  }
  return result;
}

function interpretEscape(esc: string): string {
  switch (esc) {
    case "\\n": return "\n";
    case "\\t": return "\t";
    case "\\\\": return "\\";
    case '\\"': return '"';
    case "\\'": return "'";
    case "\\0": return "\0";
    default: return esc;
  }
}

function resolveType(node: SyntaxNode): HIRType {
  if (node.type === "type") {
    const inner = node.namedChild(0);
    return inner ? resolveType(inner) : BOXED;
  }
  if (node.type === "generic_type") {
    const baseName = node.namedChild(0)!.text;
    const typeParams = node.namedChild(1);
    if (baseName === "list" && typeParams) {
      const elemNode = typeParams.namedChild(0);
      const elemType = elemNode ? resolveType(elemNode) : F64;
      const storageType = elemType.kind === "i64" ? F64 : elemType;
      return { kind: "array", element: storageType };
    }
    if (baseName === "dict" && typeParams) {
      const keyNode = typeParams.namedChild(0);
      const valNode = typeParams.namedChild(1);
      const rawKey = keyNode ? resolveType(keyNode) : I8PTR;
      const rawVal = valNode ? resolveType(valNode) : I8PTR;
      const keyType = rawKey.kind === "i64" ? F64 : rawKey;
      const valType = rawVal.kind === "i64" ? F64 : rawVal;
      return { kind: "map", key: keyType, value: valType };
    }
    if (baseName === "set" && typeParams) {
      const elemNode = typeParams.namedChild(0);
      const elemType = elemNode ? resolveType(elemNode) : F64;
      const storageType = elemType.kind === "i64" ? F64 : elemType;
      return { kind: "set", element: storageType };
    }
    if ((baseName === "Optional" || baseName === "Union") && typeParams) {
      const inner = typeParams.namedChild(0);
      return inner ? resolveType(inner) : BOXED;
    }
    return BOXED;
  }
  if (node.type === "none") return VOID;
  const text = node.text;
  switch (text) {
    case "int": return I64;
    case "float": return F64;
    case "str": return I8PTR;
    case "bool": return I1;
    case "None": return VOID;
    default:
      if (classes.has(text)) return { kind: "ptr", pointee: text };
      return BOXED;
  }
}

function inferType(node: SyntaxNode): HIRType {
  switch (node.type) {
    case "integer": return I64;
    case "float": return F64;
    case "string": return I8PTR;
    case "true":
    case "false":
      return I1;
    case "list": {
      if (node.namedChildCount === 0) return { kind: "array", element: F64 };
      const first = node.namedChild(0)!;
      const t = inferType(first);
      return { kind: "array", element: t.kind === "i64" ? F64 : t };
    }
    case "dictionary": {
      if (node.namedChildCount === 0) return { kind: "map", key: I8PTR, value: I8PTR };
      const pair = node.namedChild(0)!;
      if (pair.type === "pair") {
        const kRaw = inferType(pair.namedChild(0)!);
        const vRaw = inferType(pair.namedChild(1)!);
        return {
          kind: "map",
          key: kRaw.kind === "i64" ? F64 : kRaw,
          value: vRaw.kind === "i64" ? F64 : vRaw,
        };
      }
      return { kind: "map", key: I8PTR, value: I8PTR };
    }
    default: return BOXED;
  }
}

function defaultValue(type: HIRType): HIRExpr {
  switch (type.kind) {
    case "f64": return { kind: "literal_f64", value: 0, type: F64 };
    case "i64": return { kind: "literal_i64", value: 0, type: I64 };
    case "i1": return { kind: "literal_i1", value: false, type: I1 };
    case "i8ptr": return { kind: "literal_string", value: "", type: I8PTR };
    case "array": return { kind: "alloc_array", elementType: type.element, initialValues: [], type };
    case "map": return { kind: "alloc_map", keyType: type.key, valueType: type.value, entries: [], type };
    default: return { kind: "literal_null", type: { kind: "ptr", pointee: "" } };
  }
}

function resolveArithResultType(a: HIRType, b: HIRType): HIRType {
  if (a.kind === "f64" || b.kind === "f64") return F64;
  if (a.kind === "i64" || b.kind === "i64") return I64;
  return F64;
}

function coerceTo(expr: HIRExpr, target: HIRType): HIRExpr {
  if (expr.type.kind === target.kind) return expr;
  if (expr.type.kind === "i64" && target.kind === "f64") {
    return { kind: "widen_f64", value: expr, type: F64 };
  }
  if (expr.type.kind === "f64" && target.kind === "i64") {
    return { kind: "narrow_i64", value: expr, type: I64 };
  }
  if (expr.type.kind === "i1" && target.kind === "i64") {
    return { kind: "narrow_i64", value: expr, type: I64 };
  }
  return expr;
}

function coerceToF64(expr: HIRExpr): HIRExpr {
  return coerceTo(expr, F64);
}

function namedChildren(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  for (let i = 0; i < node.namedChildCount; i++) result.push(node.namedChild(i)!);
  return result;
}

function lowerListComp(node: SyntaxNode): HIRExpr {
  const bodyNode = node.namedChild(0)!;
  const forClause = node.namedChild(1)!;
  const lastChild = node.namedChild(node.namedChildCount - 1)!;
  const ifClause = lastChild.type === "if_clause" ? lastChild : null;

  const loopVarNode = forClause.namedChild(0)!;
  const iterNode = forClause.namedChild(forClause.namedChildCount - 1)!;
  const loopVarName = loopVarNode.text;

  const iterExpr = lowerExpr(iterNode);
  const iterElemType: HIRType = iterExpr.type.kind === "array" ? iterExpr.type.element : F64;
  const iterPrefix = iterElemType.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";

  // Type-inference pass: determine result element type
  const savedLocals = new Map(locals);
  const savedPending = pendingStmts;
  pendingStmts = [];
  const tmpVarId = freshId();
  locals.set(loopVarName, { id: tmpVarId, name: loopVarName, type: iterElemType });
  const typeCheckExpr = lowerExpr(bodyNode);
  const resultElemType: HIRType = typeCheckExpr.type.kind === "i64" ? F64 : typeCheckExpr.type;
  locals = savedLocals;
  pendingStmts = savedPending;

  const resultType: HIRType = { kind: "array", element: resultElemType };
  const arrPrefix = resultElemType.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";

  const resultId = freshId();
  const iterArrId = freshId();
  const iId = freshId();
  const varId = freshId();
  const resultName = `__cr${resultId}`;
  const iterArrName = `__ci${iterArrId}`;
  const iName = `__ci2${iId}`;

  locals.set(resultName, { id: resultId, name: resultName, type: resultType });
  locals.set(iterArrName, { id: iterArrId, name: iterArrName, type: iterExpr.type });
  locals.set(iName, { id: iId, name: iName, type: I64 });
  locals.set(loopVarName, { id: varId, name: loopVarName, type: iterElemType });

  const resultRef: HIRExpr = { kind: "local_get", id: resultId, type: resultType };
  const iterArrRef: HIRExpr = { kind: "local_get", id: iterArrId, type: iterExpr.type };
  const iRef: HIRExpr = { kind: "local_get", id: iId, type: I64 };

  const lenExpr: HIRExpr = {
    kind: "runtime_call", func: `${iterPrefix}_length`,
    args: [iterArrRef], returnType: I64, type: I64,
  };

  const bodyExpr = lowerExpr(bodyNode);
  const pushStmt: HIRStmt = {
    kind: "expr",
    expr: {
      kind: "runtime_call",
      func: `${arrPrefix}_push`,
      args: [resultRef, coerceTo(bodyExpr, resultElemType)],
      returnType: VOID, type: VOID,
    },
  };

  const elemLet: HIRStmt = {
    kind: "let", id: varId, name: loopVarName, type: iterElemType,
    init: { kind: "index_get", array: iterArrRef, index: iRef, type: iterElemType },
    mutable: false,
  };

  let loopBody: HIRStmt[] = [elemLet];
  if (ifClause) {
    locals.set(loopVarName, { id: varId, name: loopVarName, type: iterElemType });
    const condExpr = lowerExpr(ifClause.namedChild(0)!);
    loopBody.push({ kind: "if", condition: condExpr, then: [pushStmt], else: undefined });
  } else {
    loopBody.push(pushStmt);
  }

  pendingStmts.push(
    {
      kind: "let", id: resultId, name: resultName, type: resultType,
      init: { kind: "alloc_array", elementType: resultElemType, initialValues: [], type: resultType },
      mutable: false,
    },
    {
      kind: "let", id: iterArrId, name: iterArrName, type: iterExpr.type,
      init: iterExpr, mutable: false,
    },
    {
      kind: "let", id: iId, name: iName, type: I64,
      init: { kind: "literal_i64", value: 0, type: I64 }, mutable: true,
    },
    {
      kind: "for",
      condition: { kind: "binary", op: "lt", left: iRef, right: lenExpr, type: I1 },
      update: {
        kind: "local_set", id: iId,
        value: { kind: "binary", op: "add", left: iRef, right: { kind: "literal_i64", value: 1, type: I64 }, type: I64 },
        type: I64,
      },
      body: loopBody,
    }
  );

  return resultRef;
}

function lowerDictComp(node: SyntaxNode): HIRExpr {
  // {key_expr: val_expr for var in iterable [if cond]}
  // namedChild(0) is a `pair` with key/value, namedChild(1) is for_in_clause
  const pairNode = node.namedChild(0)!;
  const keyNode = pairNode.type === "pair" ? pairNode.namedChild(0)! : pairNode;
  const valNode = pairNode.type === "pair" ? pairNode.namedChild(1)! : node.namedChild(1)!;
  const lastChild = node.namedChild(node.namedChildCount - 1)!;
  const ifClause = lastChild.type === "if_clause" ? lastChild : null;
  const forClause = node.namedChild(1)!;
  const actualFor = ifClause ? node.namedChild(node.namedChildCount - 2)! : forClause;

  const loopVarNode = actualFor.namedChild(0)!;
  const iterNode = actualFor.namedChild(actualFor.namedChildCount - 1)!;
  const loopVarName = loopVarNode.text;

  const iterExpr = lowerExpr(iterNode);
  const iterElemType: HIRType = iterExpr.type.kind === "array" ? iterExpr.type.element : F64;
  const iterPrefix = iterElemType.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";

  // type inference pass
  const savedLocals = new Map(locals);
  const savedPending = pendingStmts;
  pendingStmts = [];
  const tmpId = freshId();
  locals.set(loopVarName, { id: tmpId, name: loopVarName, type: iterElemType });
  const typeKeyExpr = lowerExpr(keyNode);
  const typeValExpr = lowerExpr(valNode);
  const keyType: HIRType = typeKeyExpr.type.kind === "i64" ? F64 : typeKeyExpr.type;
  const valType: HIRType = typeValExpr.type.kind === "i64" ? F64 : typeValExpr.type;
  locals = savedLocals;
  pendingStmts = savedPending;

  const mapType: HIRType = { kind: "map", key: keyType, value: valType };
  const prefix = mapPrefix(keyType, valType);

  const resultId = freshId();
  const iterArrId = freshId();
  const iId = freshId();
  const varId = freshId();
  const resultName = `__dc${resultId}`;
  const iterArrName = `__di${iterArrId}`;
  const iName = `__di2${iId}`;

  locals.set(resultName, { id: resultId, name: resultName, type: mapType });
  locals.set(iterArrName, { id: iterArrId, name: iterArrName, type: iterExpr.type });
  locals.set(iName, { id: iId, name: iName, type: I64 });
  locals.set(loopVarName, { id: varId, name: loopVarName, type: iterElemType });

  const resultRef: HIRExpr = { kind: "local_get", id: resultId, type: mapType };
  const iterArrRef: HIRExpr = { kind: "local_get", id: iterArrId, type: iterExpr.type };
  const iRef: HIRExpr = { kind: "local_get", id: iId, type: I64 };

  const lenExpr: HIRExpr = {
    kind: "runtime_call", func: `${iterPrefix}_length`,
    args: [iterArrRef], returnType: I64, type: I64,
  };

  const keyExpr = coerceTo(lowerExpr(keyNode), keyType);
  const valExpr = coerceTo(lowerExpr(valNode), valType);
  const setStmt: HIRStmt = {
    kind: "expr",
    expr: { kind: "runtime_call", func: `${prefix}_set`, args: [resultRef, keyExpr, valExpr], returnType: VOID, type: VOID },
  };

  const elemLet: HIRStmt = {
    kind: "let", id: varId, name: loopVarName, type: iterElemType,
    init: { kind: "index_get", array: iterArrRef, index: iRef, type: iterElemType },
    mutable: false,
  };

  const loopBody: HIRStmt[] = [elemLet];
  if (ifClause) {
    locals.set(loopVarName, { id: varId, name: loopVarName, type: iterElemType });
    const condExpr = lowerExpr(ifClause.namedChild(0)!);
    loopBody.push({ kind: "if", condition: condExpr, then: [setStmt], else: undefined });
  } else {
    loopBody.push(setStmt);
  }

  pendingStmts.push(
    { kind: "let", id: resultId, name: resultName, type: mapType,
      init: { kind: "alloc_map", keyType, valueType: valType, entries: [], type: mapType }, mutable: false },
    { kind: "let", id: iterArrId, name: iterArrName, type: iterExpr.type, init: iterExpr, mutable: false },
    { kind: "let", id: iId, name: iName, type: I64,
      init: { kind: "literal_i64", value: 0, type: I64 }, mutable: true },
    {
      kind: "for",
      condition: { kind: "binary", op: "lt", left: iRef, right: lenExpr, type: I1 },
      update: { kind: "local_set", id: iId,
        value: { kind: "binary", op: "add", left: iRef, right: { kind: "literal_i64", value: 1, type: I64 }, type: I64 },
        type: I64 },
      body: loopBody,
    }
  );

  return resultRef;
}

function lowerDictLiteral(node: SyntaxNode): HIRExpr {
  const entries: { key: HIRExpr; value: HIRExpr }[] = [];
  let keyType: HIRType = I8PTR;
  let valType: HIRType = I8PTR;

  for (let i = 0; i < node.namedChildCount; i++) {
    const pair = node.namedChild(i)!;
    if (pair.type !== "pair") continue;
    const k = lowerExpr(pair.namedChild(0)!);
    const v = lowerExpr(pair.namedChild(1)!);
    if (i === 0) {
      keyType = k.type.kind === "i64" ? F64 : k.type;
      valType = v.type.kind === "i64" ? F64 : v.type;
    }
    entries.push({ key: coerceTo(k, keyType), value: coerceTo(v, valType) });
  }

  const mapType: HIRType = { kind: "map", key: keyType, value: valType };
  return { kind: "alloc_map", keyType, valueType: valType, entries, type: mapType };
}

function lowerTupleLiteral(node: SyntaxNode): HIRExpr {
  const elems = namedChildren(node).map((c) => lowerExpr(c));
  if (elems.length === 0) {
    return { kind: "alloc_array", elementType: F64, initialValues: [], type: { kind: "array", element: F64 } };
  }
  const elemType = elems[0].type.kind === "i64" ? F64 : elems[0].type;
  return {
    kind: "alloc_array",
    elementType: elemType,
    initialValues: elems.map((e) => coerceTo(e, elemType)),
    type: { kind: "array", element: elemType },
  };
}

function lowerPatternUnpack(patternNode: SyntaxNode, valueNode: SyntaxNode | null): HIRStmt[] {
  const names = namedChildren(patternNode).map((c) => c.text);
  const stmts: HIRStmt[] = [];

  if (valueNode && (valueNode.type === "tuple" || valueNode.type === "expression_list")) {
    const values = namedChildren(valueNode).map((c) => lowerExpr(c));
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const val = values[i] ?? { kind: "literal_i64" as const, value: 0, type: I64 };
      const existing = locals.get(name);
      if (existing) {
        stmts.push({ kind: "expr", expr: { kind: "local_set", id: existing.id, value: coerceTo(val, existing.type), type: existing.type } });
      } else {
        const id = freshId();
        locals.set(name, { id, name, type: val.type });
        stmts.push({ kind: "let", id, name, type: val.type, init: val, mutable: true });
      }
    }
  } else {
    const rhs = valueNode ? lowerExpr(valueNode) : { kind: "literal_null" as const, type: VOID };
    const arrType = rhs.type.kind === "array" ? rhs.type : { kind: "array" as const, element: F64 as HIRType };
    const elemType = arrType.kind === "array" ? arrType.element : F64;
    const tmpId = freshId();
    stmts.push({ kind: "let", id: tmpId, name: "__unpack", type: rhs.type, init: rhs as HIRExpr, mutable: false });
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const getExpr: HIRExpr = {
        kind: "index_get",
        array: { kind: "local_get", id: tmpId, type: rhs.type as HIRType },
        index: { kind: "literal_i64", value: i, type: I64 },
        type: elemType,
      };
      const existing = locals.get(name);
      if (existing) {
        stmts.push({ kind: "expr", expr: { kind: "local_set", id: existing.id, value: coerceTo(getExpr, existing.type), type: existing.type } });
      } else {
        const id = freshId();
        locals.set(name, { id, name, type: elemType });
        stmts.push({ kind: "let", id, name, type: elemType, init: getExpr, mutable: true });
      }
    }
  }

  return stmts;
}

function lowerTryCatch(node: SyntaxNode): HIRStmt {
  const body = lowerBlock(node.childForFieldName("body")!);
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
      const paramId = freshId();
      locals.set(bindingName, { id: paramId, name: bindingName, type: I8PTR });
      catchClause = { paramId, paramName: bindingName, body: lowerBlock(bodyBlock) };
    }
    if (child.type === "finally_clause") {
      const fb = child.childForFieldName("body") ?? child.namedChild(child.namedChildCount - 1)!;
      finallyBody = lowerBlock(fb);
    }
  }

  return { kind: "try", body, catch: catchClause, finally: finallyBody };
}

function lowerRaise(node: SyntaxNode): HIRStmt {
  const arg = node.namedChild(0);
  let value: HIRExpr;

  if (!arg) {
    value = { kind: "literal_string", value: "exception", type: I8PTR };
  } else if (arg.type === "call") {
    const funcNode = arg.childForFieldName("function")!;
    const argsNode = arg.childForFieldName("arguments")!;
    if (argsNode.namedChildCount > 0) {
      const msgArg = lowerExpr(argsNode.namedChild(0)!);
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
    const local = locals.get(arg.text);
    value = local && local.type.kind === "i8ptr"
      ? { kind: "local_get", id: local.id, type: I8PTR }
      : { kind: "literal_string", value: arg.text, type: I8PTR };
  } else {
    value = { kind: "literal_string", value: "exception", type: I8PTR };
  }

  return { kind: "throw", value };
}

function lowerDelete(node: SyntaxNode): HIRStmt[] {
  const target = node.namedChild(0);
  if (!target) return [];
  if (target.type === "subscript") {
    const obj = lowerExpr(target.namedChild(0)!);
    const key = lowerExpr(target.namedChild(1)!);
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
