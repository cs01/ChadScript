import type { SyntaxNode } from "../parser-php.js";
import type {
  HIRModule,
  HIRFunction,
  HIRStmt,
  HIRExpr,
  HIRType,
  HIRParam,
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

export function lowerPhpModule(
  root: SyntaxNode,
  source: string,
  filename: string,
): HIRModule {
  nextId = 0;
  locals = new Map();
  functions = new Map();

  const hirFunctions: HIRFunction[] = [];
  const initStmts: HIRStmt[] = [];

  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i)!;
    switch (child.type) {
      case "php_tag":
        break;
      case "function_definition":
        hirFunctions.push(lowerFunction(child));
        break;
      case "expression_statement":
      case "echo_statement":
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

  return {
    functions: hirFunctions,
    classes: [],
    interfaces: [],
    globals: [],
    init: [],
    sourceInfo: {
      filename,
      directory: filename.replace(/\/[^/]+$/, ""),
      source,
    },
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
    if (p.type === "simple_parameter") {
      const typeNode = p.childForFieldName("type");
      const nameNode = p.childForFieldName("name")!;
      const pName = extractVarName(nameNode);
      const pType = typeNode ? resolveType(typeNode) : BOXED;
      const id = freshId();
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
    case "expression_statement":
      return lowerExpressionStatement(node);
    case "echo_statement":
      return lowerEcho(node);
    case "return_statement":
      return lowerReturn(node);
    case "if_statement":
      return [lowerIf(node)];
    case "while_statement":
      return [lowerWhile(node)];
    case "for_statement":
      return lowerForStmt(node);
    case "break_statement":
      return [{ kind: "break" }];
    case "continue_statement":
      return [{ kind: "continue" }];
    default:
      throw new Error(`unsupported statement: ${node.type}`);
  }
}

function lowerExpressionStatement(node: SyntaxNode): HIRStmt[] {
  const inner = node.namedChild(0)!;
  if (inner.type === "assignment_expression") {
    return lowerAssignment(inner);
  }
  return [{ kind: "expr", expr: lowerExpr(inner) }];
}

function lowerEcho(node: SyntaxNode): HIRStmt[] {
  const args: HIRExpr[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    args.push(lowerExpr(node.namedChild(i)!));
  }
  return [{
    kind: "expr",
    expr: {
      kind: "runtime_call",
      func: "cs_console_log",
      args,
      returnType: VOID,
      type: VOID,
    },
  }];
}

function lowerReturn(node: SyntaxNode): HIRStmt[] {
  const valNode = node.namedChild(0);
  return [{
    kind: "return",
    value: valNode ? lowerExpr(valNode) : undefined,
  }];
}

function lowerAssignment(node: SyntaxNode): HIRStmt[] {
  const leftNode = node.childForFieldName("left")!;
  const rightNode = node.childForFieldName("right")!;
  const name = extractVarName(leftNode);
  const value = lowerExpr(rightNode);

  const existing = locals.get(name);
  if (existing) {
    return [{ kind: "expr", expr: { kind: "local_set", id: existing.id, value, type: existing.type } }];
  }

  const type = inferExprType(rightNode, value);
  const id = freshId();
  locals.set(name, { id, name, type });
  return [{ kind: "let", id, name, type, init: value, mutable: true }];
}

function lowerIf(node: SyntaxNode): HIRStmt {
  const condNode = node.childForFieldName("condition")!;
  const condition = lowerExpr(unwrapParens(condNode));
  const thenBlock = lowerBlock(node.childForFieldName("body")!);

  const alts = node.childrenForFieldName("alternative");
  let elseBlock: HIRStmt[] | undefined;
  if (alts.length > 0) {
    elseBlock = buildElseIfChain(alts, 0);
  }

  return { kind: "if", condition, then: thenBlock, else: elseBlock };
}

function buildElseIfChain(alts: SyntaxNode[], idx: number): HIRStmt[] | undefined {
  if (idx >= alts.length) return undefined;
  const alt = alts[idx];

  if (alt.type === "else_clause") {
    return lowerBlock(alt.childForFieldName("body")!);
  }

  if (alt.type === "else_if_clause") {
    const condition = lowerExpr(unwrapParens(alt.childForFieldName("condition")!));
    const thenBlock = lowerBlock(alt.childForFieldName("body")!);
    const elseBlock = buildElseIfChain(alts, idx + 1);
    return [{ kind: "if", condition, then: thenBlock, else: elseBlock }];
  }

  return undefined;
}

function lowerWhile(node: SyntaxNode): HIRStmt {
  const condition = lowerExpr(unwrapParens(node.childForFieldName("condition")!));
  const body = lowerBlock(node.childForFieldName("body")!);
  return { kind: "while", condition, body };
}

function lowerForStmt(node: SyntaxNode): HIRStmt[] {
  const initNode = node.childForFieldName("initialize");
  const condNode = node.childForFieldName("condition");
  const updateNode = node.childForFieldName("update");
  const body = node.childForFieldName("body")!;

  let initStmt: HIRStmt | undefined;
  if (initNode) {
    const stmts = lowerForInit(initNode);
    if (stmts.length > 0) initStmt = stmts[0];
  }

  const condition = condNode ? lowerExpr(condNode) : undefined;
  const update = updateNode ? lowerForUpdate(updateNode) : undefined;

  return [{
    kind: "for",
    init: initStmt,
    condition,
    update,
    body: lowerBlock(body),
  }];
}

function lowerForInit(node: SyntaxNode): HIRStmt[] {
  if (node.type === "assignment_expression") {
    return lowerAssignment(node);
  }
  return [{ kind: "expr", expr: lowerExpr(node) }];
}

function lowerForUpdate(node: SyntaxNode): HIRExpr {
  if (node.type === "update_expression") {
    const argNode = node.childForFieldName("argument")!;
    const name = extractVarName(argNode);
    const local = locals.get(name);
    if (!local) throw new Error(`undefined variable: ${name}`);
    const op = node.childForFieldName("operator")!.text;
    const delta: HIRExpr = { kind: "literal_i64", value: 1, type: I64 };
    const binOp = op === "++" ? "add" : "sub";
    return {
      kind: "local_set",
      id: local.id,
      value: {
        kind: "binary",
        op: binOp as any,
        left: { kind: "local_get", id: local.id, type: local.type },
        right: delta,
        type: local.type,
      },
      type: local.type,
    };
  }
  return lowerExpr(node);
}

function lowerExpr(node: SyntaxNode): HIRExpr {
  switch (node.type) {
    case "integer":
      return { kind: "literal_i64", value: parseInt(node.text, 10), type: I64 };
    case "float":
      return { kind: "literal_f64", value: parseFloat(node.text), type: F64 };
    case "string":
    case "encapsed_string":
      return { kind: "literal_string", value: extractStringContent(node), type: I8PTR };
    case "boolean":
      return { kind: "literal_i1", value: node.text.toLowerCase() === "true", type: I1 };
    case "null":
      return { kind: "literal_null", type: VOID };
    case "variable_name":
      return lowerVariable(node);
    case "binary_expression":
      return lowerBinaryExpr(node);
    case "unary_op_expression":
      return lowerUnaryExpr(node);
    case "function_call_expression":
      return lowerFunctionCall(node);
    case "parenthesized_expression":
      return lowerExpr(unwrapParens(node));
    case "update_expression":
      return lowerUpdateExpr(node);
    default:
      throw new Error(`unsupported expression: ${node.type} "${node.text}"`);
  }
}

function lowerVariable(node: SyntaxNode): HIRExpr {
  const name = extractVarName(node);
  const local = locals.get(name);
  if (local) return { kind: "local_get", id: local.id, type: local.type };
  throw new Error(`undefined variable: $${name}`);
}

function lowerBinaryExpr(node: SyntaxNode): HIRExpr {
  const left = lowerExpr(node.childForFieldName("left")!);
  const right = lowerExpr(node.childForFieldName("right")!);
  const op = node.childForFieldName("operator")!.text;

  if (op === ".") {
    return {
      kind: "runtime_call",
      func: "cs_string_concat",
      args: [coerceToStr(left), coerceToStr(right)],
      returnType: I8PTR,
      type: I8PTR,
    };
  }

  const compOps: Record<string, string> = {
    "==": "eq", "===": "eq", "!=": "ne", "!==": "ne",
    "<": "lt", "<=": "le", ">": "gt", ">=": "ge",
  };
  if (op in compOps) {
    const commonType = resolveArithType(left.type, right.type);
    return {
      kind: "binary",
      op: compOps[op] as any,
      left: coerceTo(left, commonType),
      right: coerceTo(right, commonType),
      type: I1,
    };
  }

  const arithOps: Record<string, string> = {
    "+": "add", "-": "sub", "*": "mul", "/": "div", "%": "rem",
    "<<": "shl", ">>": "shr", "&": "bit_and", "|": "bit_or", "^": "bit_xor",
  };
  if (op in arithOps) {
    const resultType = resolveArithType(left.type, right.type);
    return {
      kind: "binary",
      op: arithOps[op] as any,
      left: coerceTo(left, resultType),
      right: coerceTo(right, resultType),
      type: resultType,
    };
  }

  if (op === "&&" || op === "and") {
    return { kind: "binary", op: "and", left, right, type: left.type };
  }
  if (op === "||" || op === "or") {
    return { kind: "binary", op: "or", left, right, type: left.type };
  }

  if (op === "**") {
    return {
      kind: "runtime_call",
      func: "pow",
      args: [coerceTo(left, F64), coerceTo(right, F64)],
      returnType: F64,
      type: F64,
    };
  }

  throw new Error(`unsupported operator: ${op}`);
}

function lowerUnaryExpr(node: SyntaxNode): HIRExpr {
  const op = node.child(0)!.text;
  const operand = lowerExpr(node.namedChild(0)!);
  switch (op) {
    case "-": return { kind: "unary", op: "neg", operand, type: operand.type };
    case "!": return { kind: "unary", op: "not", operand, type: I1 };
    case "~": return { kind: "unary", op: "bit_not", operand, type: operand.type };
    default: throw new Error(`unsupported unary operator: ${op}`);
  }
}

function lowerFunctionCall(node: SyntaxNode): HIRExpr {
  const funcNode = node.childForFieldName("function")!;
  const argsNode = node.childForFieldName("arguments")!;
  const funcName = funcNode.text;

  const args: HIRExpr[] = [];
  for (let i = 0; i < argsNode.namedChildCount; i++) {
    const arg = argsNode.namedChild(i)!;
    if (arg.type === "argument") {
      args.push(lowerExpr(arg.namedChild(0)!));
    } else {
      args.push(lowerExpr(arg));
    }
  }

  if (funcName === "intval" || funcName === "(int)") {
    if (args.length === 1) return coerceTo(args[0], I64);
    return { kind: "literal_i64", value: 0, type: I64 };
  }

  if (funcName === "floatval") {
    if (args.length === 1) return coerceTo(args[0], F64);
    return { kind: "literal_f64", value: 0, type: F64 };
  }

  if (funcName === "abs") {
    return {
      kind: "runtime_call",
      func: "cs_math_abs",
      args: [coerceTo(args[0], F64)],
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

function lowerUpdateExpr(node: SyntaxNode): HIRExpr {
  const argNode = node.childForFieldName("argument")!;
  const name = extractVarName(argNode);
  const local = locals.get(name);
  if (!local) throw new Error(`undefined variable: $${name}`);
  const op = node.childForFieldName("operator")!.text;
  return {
    kind: "local_set",
    id: local.id,
    value: {
      kind: "binary",
      op: op === "++" ? "add" : "sub" as any,
      left: { kind: "local_get", id: local.id, type: local.type },
      right: { kind: "literal_i64", value: 1, type: I64 },
      type: local.type,
    },
    type: local.type,
  };
}

function extractVarName(node: SyntaxNode): string {
  if (node.type === "variable_name") {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)!;
      if (child.type === "name") return child.text;
    }
    return node.text.replace(/^\$/, "");
  }
  return node.text.replace(/^\$/, "");
}

function extractStringContent(node: SyntaxNode): string {
  if (node.type === "string" || node.type === "encapsed_string") {
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
  return node.text.replace(/^['"]|['"]$/g, "");
}

function interpretEscape(esc: string): string {
  switch (esc) {
    case "\\n": return "\n";
    case "\\t": return "\t";
    case "\\\\": return "\\";
    case '\\"': return '"';
    case "\\'": return "'";
    case "\\0": return "\0";
    case "\\$": return "$";
    default: return esc;
  }
}

function unwrapParens(node: SyntaxNode): SyntaxNode {
  if (node.type === "parenthesized_expression") return node.namedChild(0)!;
  return node;
}

function resolveType(node: SyntaxNode): HIRType {
  const text = node.text;
  switch (text) {
    case "int": return I64;
    case "float": return F64;
    case "string": return I8PTR;
    case "bool": return I1;
    case "void": return VOID;
    default: return BOXED;
  }
}

function inferExprType(node: SyntaxNode, expr: HIRExpr): HIRType {
  return expr.type;
}

function resolveArithType(a: HIRType, b: HIRType): HIRType {
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

function coerceToStr(expr: HIRExpr): HIRExpr {
  return expr;
}
