import type {
  Module,
  ModuleItem,
  Statement,
  Expression,
  CallExpression,
  MemberExpression,
  StringLiteral,
  NumericLiteral,
  Identifier,
  VariableDeclaration,
  FunctionDeclaration,
  ReturnStatement,
  IfStatement,
  WhileStatement,
  ForStatement,
  BinaryExpression,
  UnaryExpression,
  AssignmentExpression,
  UpdateExpression,
  ExpressionStatement,
  BlockStatement,
  ParenthesisExpression,
} from "@swc/core";

import type {
  HIRModule,
  HIRFunction,
  HIRStmt,
  HIRExpr,
  HIRType,
  HIRParam,
  BinaryOp,
  UnaryOp,
} from "./types.js";
import { F64, I32, I1, I8PTR, VOID, BOXED } from "./types.js";
import { compileError } from "../errors.js";

let nextId = 0;
const locals = new Map<string, { id: number; type: HIRType; mutable: boolean }>();
const functionRegistry = new Map<string, { params: HIRParam[]; returnType: HIRType }>();

function freshId(): number {
  return nextId++;
}

function resetState(): void {
  nextId = 0;
  locals.clear();
}

export function lowerModule(ast: Module): HIRModule {
  const functions: HIRFunction[] = [];
  const init: HIRStmt[] = [];

  functionRegistry.clear();
  for (const item of ast.body) {
    if (item.type === "FunctionDeclaration") {
      registerFunction(item);
    }
  }

  for (const item of ast.body) {
    if (item.type === "FunctionDeclaration") {
      functions.push(lowerFunctionDecl(item));
    } else {
      const stmts = lowerModuleItem(item);
      init.push(...stmts);
    }
  }

  return { functions, classes: [], globals: [], init };
}

function registerFunction(decl: FunctionDeclaration): void {
  const params: HIRParam[] = decl.params.map((p, i) => {
    const type = p.pat.type === "Identifier" ? resolveTypeAnnotation(p.pat.typeAnnotation) : BOXED;
    return { id: i, name: p.pat.type === "Identifier" ? p.pat.value : `p${i}`, type };
  });
  const returnType = decl.returnType ? resolveTypeAnnotation(decl.returnType) : VOID;
  functionRegistry.set(decl.identifier.value, { params, returnType });
}

function lowerFunctionDecl(decl: FunctionDeclaration): HIRFunction {
  const savedLocals = new Map(locals);
  const savedNextId = nextId;

  const params: HIRParam[] = [];
  for (const param of decl.params) {
    if (param.pat.type === "Identifier") {
      const id = freshId();
      const type = resolveTypeAnnotation(param.pat.typeAnnotation);
      params.push({ id, name: param.pat.value, type });
      locals.set(param.pat.value, { id, type, mutable: true });
    }
  }

  const returnType = decl.returnType ? resolveTypeAnnotation(decl.returnType) : VOID;

  const body = decl.body ? lowerBlock(decl.body) : [];

  const fn: HIRFunction = {
    name: decl.identifier.value,
    params,
    returnType,
    body,
    isAsync: decl.async,
    captures: [],
  };

  locals.clear();
  for (const [k, v] of savedLocals) locals.set(k, v);
  nextId = savedNextId + params.length;

  return fn;
}

function resolveTypeAnnotation(ann: any): HIRType {
  if (!ann) return BOXED;

  const ta = ann.typeAnnotation || ann;
  if (!ta) return BOXED;

  if (ta.type === "TsKeywordType") {
    switch (ta.kind) {
      case "number":
        return F64;
      case "string":
        return I8PTR;
      case "boolean":
        return I1;
      case "void":
        return VOID;
      default:
        return BOXED;
    }
  }

  if (ta.type === "TsTypeAnnotation") {
    return resolveTypeAnnotation(ta.typeAnnotation);
  }

  return BOXED;
}

function lowerModuleItem(item: ModuleItem): HIRStmt[] {
  switch (item.type) {
    case "VariableDeclaration":
      return lowerVarDecl(item);
    case "ExpressionStatement":
      return [{ kind: "expr", expr: lowerExpr(item.expression) }];
    case "ReturnStatement":
      return [lowerReturn(item)];
    case "IfStatement":
      return [lowerIf(item)];
    case "WhileStatement":
      return [lowerWhile(item)];
    case "ForStatement":
      return [lowerFor(item)];
    case "BlockStatement":
      return lowerBlock(item);
    default:
      compileError(`unsupported statement type: ${item.type}`);
  }
}

function lowerBlock(block: BlockStatement): HIRStmt[] {
  const stmts: HIRStmt[] = [];
  for (const stmt of block.stmts) {
    stmts.push(...lowerModuleItem(stmt as ModuleItem));
  }
  return stmts;
}

function lowerVarDecl(decl: VariableDeclaration): HIRStmt[] {
  const stmts: HIRStmt[] = [];
  const mutable = decl.kind === "let" || decl.kind === "var";

  for (const d of decl.declarations) {
    if (d.id.type === "Identifier") {
      const id = freshId();
      const declType = resolveTypeAnnotation(d.id.typeAnnotation);
      const init = d.init ? lowerExpr(d.init) : undefined;
      const type = declType.kind !== "boxed" ? declType : init ? init.type : BOXED;
      const coercedInit = init && init.type.kind !== type.kind ? coerce(init, type) : init;

      locals.set(d.id.value, { id, type, mutable });
      stmts.push({ kind: "let", id, name: d.id.value, type, init: coercedInit, mutable });
    }
  }

  return stmts;
}

function lowerReturn(stmt: ReturnStatement): HIRStmt {
  return {
    kind: "return",
    value: stmt.argument ? lowerExpr(stmt.argument) : undefined,
  };
}

function lowerIf(stmt: IfStatement): HIRStmt {
  return {
    kind: "if",
    condition: lowerExpr(stmt.test),
    then: lowerConsequent(stmt.consequent),
    else: stmt.alternate ? lowerConsequent(stmt.alternate) : undefined,
  };
}

function lowerConsequent(stmt: Statement): HIRStmt[] {
  if (stmt.type === "BlockStatement") return lowerBlock(stmt);
  return lowerModuleItem(stmt as ModuleItem);
}

function lowerWhile(stmt: WhileStatement): HIRStmt {
  return {
    kind: "while",
    condition: lowerExpr(stmt.test),
    body: lowerConsequent(stmt.body),
  };
}

function lowerFor(stmt: ForStatement): HIRStmt {
  const init = stmt.init
    ? stmt.init.type === "VariableDeclaration"
      ? lowerVarDecl(stmt.init)[0]
      : { kind: "expr" as const, expr: lowerExpr(stmt.init as Expression) }
    : undefined;

  return {
    kind: "for",
    init,
    condition: stmt.test ? lowerExpr(stmt.test) : undefined,
    update: stmt.update ? lowerExpr(stmt.update) : undefined,
    body: lowerConsequent(stmt.body),
  };
}

function lowerExpr(expr: Expression): HIRExpr {
  switch (expr.type) {
    case "NumericLiteral":
      return lowerNumericLiteral(expr);
    case "StringLiteral":
      return {
        kind: "literal_string",
        value: expr.value,
        type: I8PTR,
      };
    case "BooleanLiteral":
      return {
        kind: "literal_i1",
        value: expr.value,
        type: I1,
      };
    case "NullExpression":
      return { kind: "literal_null", type: BOXED };
    case "Identifier":
      return lowerIdentifier(expr);
    case "BinaryExpression":
      return lowerBinary(expr);
    case "UnaryExpression":
      return lowerUnary(expr);
    case "UpdateExpression":
      return lowerUpdate(expr);
    case "AssignmentExpression":
      return lowerAssignment(expr);
    case "CallExpression":
      return lowerCall(expr);
    case "MemberExpression":
      return lowerMember(expr);
    case "ParenthesisExpression":
      return lowerExpr(expr.expression);
    case "ConditionalExpression":
      return {
        kind: "conditional",
        condition: lowerExpr(expr.test),
        then: lowerExpr(expr.consequent),
        else: lowerExpr(expr.alternate),
        type: lowerExpr(expr.consequent).type,
      };
    default:
      compileError(`unsupported expression type: ${expr.type}`, expr.span);
  }
}

function lowerNumericLiteral(lit: NumericLiteral): HIRExpr {
  if (Number.isInteger(lit.value) && Math.abs(lit.value) <= 2147483647) {
    return { kind: "literal_i32", value: lit.value, type: I32 };
  }
  return { kind: "literal_f64", value: lit.value, type: F64 };
}

function lowerIdentifier(id: Identifier): HIRExpr {
  const local = locals.get(id.value);
  if (local) {
    return { kind: "local_get", id: local.id, type: local.type };
  }
  return { kind: "global_get", name: id.value, type: BOXED };
}

const BITWISE_OPS: BinaryOp[] = ["bit_and", "bit_or", "bit_xor", "shl", "shr", "ushr"];

function lowerBinary(expr: BinaryExpression): HIRExpr {
  let left = lowerExpr(expr.left);
  let right = lowerExpr(expr.right);
  const op = mapBinaryOp(expr.operator);

  if (BITWISE_OPS.includes(op)) {
    if (left.type.kind !== "i32") left = coerce(left, I32);
    if (right.type.kind !== "i32") right = coerce(right, I32);
    return { kind: "binary", op, left, right, type: I32 };
  }

  if (op === "div") {
    if (left.type.kind !== "f64") left = coerce(left, F64);
    if (right.type.kind !== "f64") right = coerce(right, F64);
    return { kind: "binary", op, left, right, type: F64 };
  }

  const operandType = resolveArithType(left.type, right.type);
  if (left.type.kind !== operandType.kind) left = coerce(left, operandType);
  if (right.type.kind !== operandType.kind) right = coerce(right, operandType);

  const isComparison = ["eq", "ne", "lt", "le", "gt", "ge"].includes(op);
  const resultType = isComparison ? I1 : operandType;

  return { kind: "binary", op, left, right, type: resultType };
}

function coerce(expr: HIRExpr, target: HIRType): HIRExpr {
  if (expr.type.kind === target.kind) return expr;
  if (expr.type.kind === "i32" && target.kind === "f64") {
    return { kind: "widen_f64", value: expr, type: F64 };
  }
  if (expr.type.kind === "f64" && target.kind === "i32") {
    return { kind: "narrow_i32", value: expr, type: I32 };
  }
  return expr;
}

function resolveArithType(a: HIRType, b: HIRType): HIRType {
  if (a.kind === "i32" && b.kind === "i32") return I32;
  if (a.kind === "f64" || b.kind === "f64") return F64;
  if (a.kind === "i32" || b.kind === "i32") return I32;
  return F64;
}

function mapBinaryOp(op: string): BinaryOp {
  switch (op) {
    case "+":
      return "add";
    case "-":
      return "sub";
    case "*":
      return "mul";
    case "/":
      return "div";
    case "%":
      return "rem";
    case "===":
    case "==":
      return "eq";
    case "!==":
    case "!=":
      return "ne";
    case "<":
      return "lt";
    case "<=":
      return "le";
    case ">":
      return "gt";
    case ">=":
      return "ge";
    case "&&":
      return "and";
    case "||":
      return "or";
    case "&":
      return "bit_and";
    case "|":
      return "bit_or";
    case "^":
      return "bit_xor";
    case "<<":
      return "shl";
    case ">>":
      return "shr";
    case ">>>":
      return "ushr";
    default:
      throw new Error(`unsupported binary operator: ${op}`);
  }
}

function lowerUnary(expr: UnaryExpression): HIRExpr {
  const operand = lowerExpr(expr.argument);
  let op: UnaryOp;
  switch (expr.operator) {
    case "-":
      op = "neg";
      break;
    case "!":
      op = "not";
      break;
    case "~":
      op = "bit_not";
      break;
    case "typeof":
      op = "typeof";
      break;
    default:
      throw new Error(`unsupported unary operator: ${expr.operator}`);
  }
  const type = op === "not" ? I1 : op === "typeof" ? I8PTR : operand.type;
  return { kind: "unary", op, operand, type };
}

function lowerUpdate(expr: UpdateExpression): HIRExpr {
  const arg = lowerExpr(expr.argument);
  if (arg.kind !== "local_get") {
    throw new Error("update expression on non-local");
  }
  const one: HIRExpr =
    arg.type.kind === "i32"
      ? { kind: "literal_i32", value: 1, type: I32 }
      : { kind: "literal_f64", value: 1, type: F64 };
  const op: BinaryOp = expr.operator === "++" ? "add" : "sub";
  const newVal: HIRExpr = {
    kind: "binary",
    op,
    left: arg,
    right: one,
    type: arg.type,
  };
  return {
    kind: "local_set",
    id: arg.id,
    value: newVal,
    type: arg.type,
  };
}

function lowerAssignment(expr: AssignmentExpression): HIRExpr {
  const value = lowerExpr(expr.right);
  if (expr.left.type === "Identifier") {
    const local = locals.get(expr.left.value);
    if (local) {
      return { kind: "local_set", id: local.id, value, type: local.type };
    }
    return {
      kind: "global_set",
      name: expr.left.value,
      value,
      type: value.type,
    };
  }
  return value;
}

function lowerCall(expr: CallExpression): HIRExpr {
  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "console" &&
    expr.callee.property.type === "Identifier" &&
    expr.callee.property.value === "log"
  ) {
    const args = expr.arguments.map((a) => lowerExpr(a.expression));
    return {
      kind: "runtime_call",
      func: "cs_console_log",
      args,
      returnType: VOID,
      type: VOID,
    };
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "Math"
  ) {
    return lowerMathCall(expr);
  }

  if (expr.callee.type === "Identifier") {
    const fnInfo = functionRegistry.get(expr.callee.value);
    if (!fnInfo) {
      compileError(`call to undeclared function '${expr.callee.value}'`, expr.span);
    }
    const args = expr.arguments.map((a, i) => {
      let arg = lowerExpr(a.expression);
      if (fnInfo.params[i]) {
        arg = coerce(arg, fnInfo.params[i].type);
      }
      return arg;
    });
    return {
      kind: "call",
      callee: expr.callee.value,
      args,
      returnType: fnInfo.returnType,
      type: fnInfo.returnType,
    };
  }

  compileError(`unsupported call expression: callee is ${expr.callee.type}`, expr.span);
}

function lowerMathCall(expr: CallExpression): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;
  const args = expr.arguments.map((a) => lowerExpr(a.expression));

  const func = `cs_math_${method}`;
  return {
    kind: "runtime_call",
    func,
    args,
    returnType: F64,
    type: F64,
  };
}

function lowerMember(expr: MemberExpression): HIRExpr {
  if (
    expr.object.type === "Identifier" &&
    expr.object.value === "process" &&
    expr.property.type === "Identifier" &&
    expr.property.value === "exit"
  ) {
    return { kind: "global_get", name: "process_exit", type: BOXED };
  }

  const obj = expr.object.type === "Identifier" ? expr.object.value : expr.object.type;
  const prop = expr.property.type === "Identifier" ? expr.property.value : expr.property.type;
  compileError(`unsupported member access: ${obj}.${prop}`, expr.span);
}
