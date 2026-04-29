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
let currentClassName: string | null;

export function lowerPythonModule(
  root: SyntaxNode,
  source: string,
  filename: string,
): HIRModule {
  nextId = 0;
  locals = new Map();
  functions = new Map();
  classes = new Map();
  currentClassName = null;

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
        initStmts.push(...lowerStmt(child));
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
    functions: hirFunctions,
    classes: hirClasses,
    interfaces: [],
    globals: hirGlobals,
    init: [],
    sourceInfo,
  };
}

function registerClass(node: SyntaxNode): void {
  const name = node.childForFieldName("name")!.text;
  const body = node.childForFieldName("body")!;
  const fields: { name: string; type: HIRType }[] = [];

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
    if (p.type === "typed_parameter") {
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
    if (p.type === "typed_parameter") {
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
    if (p.type === "typed_parameter") {
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
    if (p.type === "typed_parameter") {
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
    stmts.push(...lowerStmt(node.namedChild(i)!));
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
    return [
      {
        kind: "expr",
        expr: {
          kind: "index_set",
          array: arrExpr,
          index: coerceTo(idxExpr, I64),
          value: val,
          type: val.type,
        },
      },
    ];
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

  return lowerArrayFor(left, right, body);
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

  return [
    { kind: "let", id, name: varName, type: I64, init: start, mutable: true },
    {
      kind: "for",
      condition: {
        kind: "binary",
        op: "lt",
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

function lowerArrayFor(left: SyntaxNode, right: SyntaxNode, body: SyntaxNode): HIRStmt[] {
  const arrExpr = lowerExpr(right);
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
    case "subscript":
      return lowerSubscript(node);
    case "attribute":
      return lowerAttribute(node);
    default:
      throw new Error(`unsupported expression: ${node.type} "${node.text}"`);
  }
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
    return {
      kind: "index_get",
      array: arr,
      index: coerceTo(idx, I64),
      type: arr.type.element,
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
  const obj = lowerExpr(node.namedChild(0)!);
  const fieldName = node.namedChild(1)!.text;

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

  let opText = "";
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)!;
    if (!c.isNamed && c.text !== "(" && c.text !== ")") {
      opText = c.text;
      break;
    }
  }

  const opMap: Record<string, string> = {
    "==": "eq",
    "!=": "ne",
    "<": "lt",
    "<=": "le",
    ">": "gt",
    ">=": "ge",
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

  if (funcNode.type === "attribute") {
    const args: HIRExpr[] = [];
    for (let i = 0; i < argsNode.namedChildCount; i++) {
      args.push(lowerExpr(argsNode.namedChild(i)!));
    }
    return lowerMethodCall(funcNode, args);
  }

  const args: HIRExpr[] = [];
  for (let i = 0; i < argsNode.namedChildCount; i++) {
    args.push(lowerExpr(argsNode.namedChild(i)!));
  }

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
    return { kind: "runtime_call", func: "cs_console_log", args, returnType: VOID, type: VOID };
  }

  if (funcName === "len") {
    const arg = args[0];
    if (arg.type.kind === "array") {
      const prefix = arg.type.element.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";
      return { kind: "runtime_call", func: `${prefix}_length`, args: [arg], returnType: I64, type: I64 };
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
      const fnKey = `${obj.type.pointee}_${methodName}`;
      const fnInfo = functions.get(fnKey);
      const returnType = fnInfo?.returnType ?? VOID;
      return {
        kind: "call",
        callee: fnKey,
        args: [obj, ...args],
        returnType,
        type: returnType,
      };
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
      // num arrays store f64; use F64 for int too to match storage
      const storageType = elemType.kind === "i64" ? F64 : elemType;
      return { kind: "array", element: storageType };
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
