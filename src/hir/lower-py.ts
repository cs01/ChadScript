import type { SyntaxNode } from "../parser-py.js";
import type {
  HIRModule,
  HIRFunction,
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

export function lowerPythonModule(
  root: SyntaxNode,
  source: string,
  filename: string,
): HIRModule {
  nextId = 0;
  locals = new Map();
  functions = new Map();

  const hirFunctions: HIRFunction[] = [];
  const hirGlobals: HIRGlobal[] = [];
  const initStmts: HIRStmt[] = [];

  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i)!;
    switch (child.type) {
      case "function_definition":
        hirFunctions.push(lowerFunction(child));
        break;
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

  const mainBody: HIRStmt[] = [...initStmts];
  hirFunctions.push({
    name: "main",
    params: [],
    returnType: { kind: "i64" },
    body: [
      ...mainBody,
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
    classes: [],
    interfaces: [],
    globals: hirGlobals,
    init: [],
    sourceInfo,
  };
}

function lowerFunction(node: SyntaxNode): HIRFunction {
  const savedLocals = locals;
  locals = new Map(savedLocals);

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
      const pType = BOXED;
      params.push({ id, name: pName, type: pType });
      locals.set(pName, { id, name: pName, type: pType });
    }
  }

  functions.set(name, {
    params: params.map((p) => p.type),
    returnType,
  });

  const hirBody = lowerBlock(body);

  locals = savedLocals;

  return {
    name,
    params,
    returnType,
    body: hirBody,
    isAsync: false,
    captures: [],
  };
}

function lowerBlock(node: SyntaxNode): HIRStmt[] {
  const stmts: HIRStmt[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)!;
    stmts.push(...lowerStmt(child));
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
      return [{ kind: "expr", expr: lowerExpr(inner) }];
    }
    case "return_statement": {
      const valNode = node.namedChild(0);
      return [
        {
          kind: "return",
          value: valNode ? lowerExpr(valNode) : undefined,
        },
      ];
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
    default:
      throw new Error(`unsupported statement: ${node.type}`);
  }
}

function lowerAssignment(node: SyntaxNode): HIRStmt[] {
  const children = namedChildren(node);
  const nameNode = children[0];
  const name = nameNode.text;

  let valueNode: SyntaxNode | null = null;
  let typeNode: SyntaxNode | null = null;
  for (let i = 1; i < children.length; i++) {
    if (children[i].type === "type") {
      typeNode = children[i];
    } else {
      valueNode = children[i];
    }
  }

  const existing = locals.get(name);
  if (existing) {
    const value = valueNode ? lowerExpr(valueNode) : { kind: "literal_i64" as const, value: 0, type: I64 };
    return [{ kind: "expr", expr: { kind: "local_set", id: existing.id, value, type: existing.type } }];
  }

  const type = typeNode ? resolveType(typeNode) : (valueNode ? inferType(valueNode) : BOXED);
  const id = freshId();
  locals.set(name, { id, name, type });

  const init = valueNode ? lowerExpr(valueNode) : undefined;
  return [{ kind: "let", id, name, type, init, mutable: true }];
}

function lowerIfLike(node: SyntaxNode): HIRStmt {
  const condition = lowerExpr(node.childForFieldName("condition")!);
  const thenBlock = lowerBlock(node.childForFieldName("consequence")!);

  const alts = node.childrenForFieldName("alternative");

  let elseBlock: HIRStmt[] | undefined;
  if (alts.length > 0) {
    elseBlock = buildElifChain(alts, 0);
  }

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
    const nested: HIRStmt = { kind: "if", condition, then: thenBlock, else: elseBlock };
    return [nested];
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

  throw new Error(`unsupported for loop (only 'for x in range(...)' supported in PoC)`);
}

function lowerRangeFor(left: SyntaxNode, call: SyntaxNode, body: SyntaxNode): HIRStmt[] {
  const args = call.childForFieldName("arguments")!;
  const rangeArgs: SyntaxNode[] = [];
  for (let i = 0; i < args.namedChildCount; i++) {
    rangeArgs.push(args.namedChild(i)!);
  }

  let start: HIRExpr;
  let end: HIRExpr;
  let step: HIRExpr;

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

  const initStmt: HIRStmt = { kind: "let", id, name: varName, type: I64, init: start, mutable: true };
  const condition: HIRExpr = {
    kind: "binary",
    op: "lt",
    left: { kind: "local_get", id, type: I64 },
    right: end,
    type: I1,
  };
  const update: HIRExpr = {
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
  };

  return [
    {
      kind: "for",
      init: initStmt,
      condition,
      update,
      body: lowerBlock(body),
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
      return { kind: "literal_string", value: extractStringContent(node), type: I8PTR };
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
    case "call":
      return lowerCall(node);
    case "parenthesized_expression":
      return lowerExpr(node.namedChild(0)!);
    case "not_operator":
      return {
        kind: "unary",
        op: "not",
        operand: lowerExpr(node.namedChild(0)!),
        type: I1,
      };
    default:
      throw new Error(`unsupported expression: ${node.type} "${node.text}"`);
  }
}

function lowerIdentifier(node: SyntaxNode): HIRExpr {
  const name = node.text;
  const local = locals.get(name);
  if (local) {
    return { kind: "local_get", id: local.id, type: local.type };
  }
  throw new Error(`undefined variable: ${name}`);
}

function lowerBinaryOp(node: SyntaxNode): HIRExpr {
  const left = lowerExpr(node.namedChild(0)!);
  const right = lowerExpr(node.namedChild(1)!);
  const opNode = node.child(1)!;
  const op = opNode.text;

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

  if (op === "**") {
    return {
      kind: "runtime_call",
      func: "pow",
      args: [
        coerceToF64(left),
        coerceToF64(right),
      ],
      returnType: F64,
      type: F64,
    };
  }

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

  const args: HIRExpr[] = [];
  for (let i = 0; i < argsNode.namedChildCount; i++) {
    args.push(lowerExpr(argsNode.namedChild(i)!));
  }

  const funcName = funcNode.text;

  if (funcName === "print") {
    return {
      kind: "runtime_call",
      func: "cs_console_log",
      args,
      returnType: VOID,
      type: VOID,
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

  const fnInfo = functions.get(funcName);
  if (fnInfo) {
    return {
      kind: "call",
      callee: funcName,
      args,
      returnType: fnInfo.returnType,
      type: fnInfo.returnType,
    };
  }

  return {
    kind: "call",
    callee: funcName,
    args,
    returnType: I64,
    type: I64,
  };
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
  const text = node.text;
  switch (text) {
    case "int": return I64;
    case "float": return F64;
    case "str": return I8PTR;
    case "bool": return I1;
    case "None": return VOID;
    default: return BOXED;
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
    default: return BOXED;
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
  for (let i = 0; i < node.namedChildCount; i++) {
    result.push(node.namedChild(i)!);
  }
  return result;
}
