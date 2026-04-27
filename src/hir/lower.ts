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
import { F64, I64, I1, I8PTR, VOID, BOXED } from "./types.js";
import { compileError } from "../errors.js";

let nextId = 0;
const locals = new Map<string, { id: number; type: HIRType; mutable: boolean }>();
const globals = new Map<string, { type: HIRType; mutable: boolean }>();
const functionRegistry = new Map<string, { params: HIRParam[]; returnType: HIRType }>();
const classRegistry = new Map<
  string,
  {
    fields: { name: string; type: HIRType }[];
    methods: Map<string, { params: HIRParam[]; returnType: HIRType }>;
    parent?: string;
  }
>();
let isModuleScope = true;
let expectedArrayElementType: HIRType | null = null;
let currentClassName: string | null = null;

function freshId(): number {
  return nextId++;
}

function resetState(): void {
  nextId = 0;
  locals.clear();
}

export function lowerModule(ast: Module): HIRModule {
  const functions: HIRFunction[] = [];
  const hirClasses: import("./types.js").HIRClass[] = [];
  const hirGlobals: import("./types.js").HIRGlobal[] = [];
  const init: HIRStmt[] = [];

  functionRegistry.clear();
  classRegistry.clear();
  globals.clear();
  isModuleScope = true;

  for (const item of ast.body) {
    if (item.type === "ClassDeclaration") {
      registerClass(item as any);
    }
  }

  for (const item of ast.body) {
    if (item.type === "FunctionDeclaration") {
      registerFunction(item);
    }
  }

  for (const item of ast.body) {
    if (item.type === "ClassDeclaration") {
      const { hirClass, fns } = lowerClassDecl(item as any);
      hirClasses.push(hirClass);
      functions.push(...fns);
    } else if (item.type === "FunctionDeclaration") {
      isModuleScope = false;
      functions.push(lowerFunctionDecl(item));
      isModuleScope = true;
    } else if (item.type === "VariableDeclaration") {
      for (const d of item.declarations) {
        if (d.id.type === "Identifier") {
          const mutable = item.kind === "let" || item.kind === "var";
          const declType = resolveTypeAnnotation(d.id.typeAnnotation);
          if (declType.kind === "array")
            expectedArrayElementType = (declType as { kind: "array"; element: HIRType }).element;
          const rawInit = d.init ? lowerExpr(d.init) : undefined;
          expectedArrayElementType = null;
          const type = declType.kind !== "boxed" ? declType : rawInit ? rawInit.type : BOXED;
          const coercedInit =
            rawInit && rawInit.type.kind !== type.kind ? coerce(rawInit, type) : rawInit;

          globals.set(d.id.value, { type, mutable });
          hirGlobals.push({ name: d.id.value, type, mutable });

          if (coercedInit) {
            init.push({
              kind: "expr",
              expr: { kind: "global_set", name: d.id.value, value: coercedInit, type },
            });
          }
        }
      }
    } else {
      const stmts = lowerModuleItem(item);
      init.push(...stmts);
    }
  }

  return { functions, classes: hirClasses, globals: hirGlobals, init };
}

function registerFunction(decl: FunctionDeclaration): void {
  const params: HIRParam[] = decl.params.map((p, i) => {
    const type = p.pat.type === "Identifier" ? resolveTypeAnnotation(p.pat.typeAnnotation) : BOXED;
    return { id: i, name: p.pat.type === "Identifier" ? p.pat.value : `p${i}`, type };
  });
  const returnType = decl.returnType ? resolveTypeAnnotation(decl.returnType) : VOID;
  functionRegistry.set(decl.identifier.value, { params, returnType });
}

function registerClass(decl: any): void {
  const name = decl.identifier.value;
  const parentName = decl.superClass?.type === "Identifier" ? decl.superClass.value : undefined;
  const fields: { name: string; type: HIRType }[] = [];
  const methods = new Map<string, { params: HIRParam[]; returnType: HIRType }>();

  if (parentName) {
    const parentInfo = classRegistry.get(parentName);
    if (parentInfo) {
      fields.push(...parentInfo.fields);
      for (const [mName, mInfo] of parentInfo.methods) {
        methods.set(mName, mInfo);
      }
    }
  }

  for (const member of decl.body) {
    if (member.type === "ClassProperty" && member.key?.type === "Identifier") {
      fields.push({
        name: member.key.value,
        type: resolveTypeAnnotation(member.typeAnnotation),
      });
    }
    if (member.type === "ClassMethod" && member.key?.type === "Identifier") {
      const fn = member.function;
      const params: HIRParam[] = fn.params.map((p: any, i: number) => ({
        id: i + 1,
        name: p.pat?.value || `p${i}`,
        type: resolveTypeAnnotation(p.pat?.typeAnnotation),
      }));
      const returnType = fn.returnType ? resolveTypeAnnotation(fn.returnType) : VOID;
      methods.set(member.key.value, { params, returnType });
      functionRegistry.set(`${name}_${member.key.value}`, {
        params: [{ id: 0, name: "this", type: { kind: "ptr", pointee: name } }, ...params],
        returnType,
      });
    }
  }

  classRegistry.set(name, { fields, methods, parent: parentName });
  functionRegistry.set(`${name}_constructor`, {
    params: [],
    returnType: { kind: "ptr", pointee: name },
  });
}

function lowerClassDecl(decl: any): {
  hirClass: import("./types.js").HIRClass;
  fns: HIRFunction[];
} {
  const name = decl.identifier.value;
  const classInfo = classRegistry.get(name)!;
  const parentName = classInfo.parent;
  const fns: HIRFunction[] = [];

  const hirFields = classInfo.fields.map((f) => ({ name: f.name, type: f.type }));

  for (const member of decl.body) {
    if (member.type === "Constructor") {
      const { constructor, init } = lowerConstructorPair(name, member, classInfo);
      fns.push(init);
      fns.push(constructor);
    }
    if (member.type === "ClassMethod" && member.key?.type === "Identifier") {
      fns.push(lowerMethod(name, member, classInfo));
    }
  }

  if (!decl.body.some((m: any) => m.type === "Constructor")) {
    const { constructor, init } = generateDefaultConstructorPair(name, classInfo);
    fns.push(init);
    fns.push(constructor);
  }

  return {
    hirClass: { name, fields: hirFields, methods: fns, parent: parentName },
    fns,
  };
}

function lowerConstructorPair(
  className: string,
  ctor: any,
  classInfo: { fields: { name: string; type: HIRType }[] },
): { constructor: HIRFunction; init: HIRFunction } {
  const savedLocals = new Map(locals);
  const savedNextId = nextId;
  locals.clear();
  nextId = 0;

  const thisType: HIRType = { kind: "ptr", pointee: className };
  const thisId = freshId();
  locals.set("this", { id: thisId, type: thisType, mutable: false });

  const ctorParams: HIRParam[] = [];
  for (const p of ctor.params) {
    const pat = p.pat || p;
    if (pat.type === "Identifier") {
      const id = freshId();
      const type = resolveTypeAnnotation(pat.typeAnnotation);
      ctorParams.push({ id, name: pat.value, type });
      locals.set(pat.value, { id, type, mutable: true });
    }
  }

  functionRegistry.set(`${className}_constructor`, { params: ctorParams, returnType: thisType });
  functionRegistry.set(`${className}_init`, {
    params: [{ id: thisId, name: "this", type: thisType }, ...ctorParams],
    returnType: VOID,
  });

  currentClassName = className;
  isModuleScope = false;
  const initBody: HIRStmt[] = ctor.body ? lowerBlock(ctor.body) : [];
  isModuleScope = true;
  currentClassName = null;

  locals.clear();
  for (const [k, v] of savedLocals) locals.set(k, v);
  nextId = savedNextId;

  const initParams: HIRParam[] = [{ id: 0, name: "this", type: thisType }, ...ctorParams];
  const init: HIRFunction = {
    name: `${className}_init`,
    params: initParams,
    returnType: VOID,
    body: initBody,
    isAsync: false,
    captures: [],
  };

  const allocExpr: HIRExpr = {
    kind: "alloc_struct",
    structName: className,
    fields: classInfo.fields.map((f) => defaultValue(f.type)),
    type: thisType,
  };
  const initCallArgs: HIRExpr[] = [
    { kind: "local_get", id: 0, type: thisType },
    ...ctorParams.map((p) => ({ kind: "local_get" as const, id: p.id, type: p.type })),
  ];
  const constructorBody: HIRStmt[] = [
    { kind: "let", id: 0, name: "this", type: thisType, init: allocExpr, mutable: false },
    {
      kind: "expr",
      expr: {
        kind: "call",
        callee: `${className}_init`,
        args: initCallArgs,
        returnType: VOID,
        type: VOID,
      },
    },
    { kind: "return", value: { kind: "local_get", id: 0, type: thisType } },
  ];

  const constructor: HIRFunction = {
    name: `${className}_constructor`,
    params: ctorParams,
    returnType: thisType,
    body: constructorBody,
    isAsync: false,
    captures: [],
  };

  return { constructor, init };
}

function lowerMethod(
  className: string,
  method: any,
  classInfo: { fields: { name: string; type: HIRType }[] },
): HIRFunction {
  const savedLocals = new Map(locals);
  const savedNextId = nextId;
  locals.clear();
  nextId = 0;

  const thisType: HIRType = { kind: "ptr", pointee: className };
  const thisId = freshId();
  locals.set("this", { id: thisId, type: thisType, mutable: false });

  const params: HIRParam[] = [{ id: thisId, name: "this", type: thisType }];
  const fn = method.function;
  for (const p of fn.params) {
    if (p.pat?.type === "Identifier") {
      const id = freshId();
      const type = resolveTypeAnnotation(p.pat.typeAnnotation);
      params.push({ id, name: p.pat.value, type });
      locals.set(p.pat.value, { id, type, mutable: true });
    }
  }

  const returnType = fn.returnType ? resolveTypeAnnotation(fn.returnType) : VOID;

  currentClassName = className;
  isModuleScope = false;
  const body = fn.body ? lowerBlock(fn.body) : [];
  isModuleScope = true;
  currentClassName = null;

  locals.clear();
  for (const [k, v] of savedLocals) locals.set(k, v);
  nextId = savedNextId;

  return {
    name: `${className}_${method.key.value}`,
    params,
    returnType,
    body,
    isAsync: fn.async || false,
    captures: [],
  };
}

function generateDefaultConstructorPair(
  className: string,
  classInfo: { fields: { name: string; type: HIRType }[] },
): { constructor: HIRFunction; init: HIRFunction } {
  const thisType: HIRType = { kind: "ptr", pointee: className };

  functionRegistry.set(`${className}_init`, {
    params: [{ id: 0, name: "this", type: thisType }],
    returnType: VOID,
  });

  const init: HIRFunction = {
    name: `${className}_init`,
    params: [{ id: 0, name: "this", type: thisType }],
    returnType: VOID,
    body: [],
    isAsync: false,
    captures: [],
  };

  const allocExpr: HIRExpr = {
    kind: "alloc_struct",
    structName: className,
    fields: classInfo.fields.map((f) => defaultValue(f.type)),
    type: thisType,
  };
  const constructor: HIRFunction = {
    name: `${className}_constructor`,
    params: [],
    returnType: thisType,
    body: [
      { kind: "let", id: 0, name: "this", type: thisType, init: allocExpr, mutable: false },
      {
        kind: "expr",
        expr: {
          kind: "call",
          callee: `${className}_init`,
          args: [{ kind: "local_get", id: 0, type: thisType }],
          returnType: VOID,
          type: VOID,
        },
      },
      { kind: "return", value: { kind: "local_get", id: 0, type: thisType } },
    ],
    isAsync: false,
    captures: [],
  };

  return { constructor, init };
}

function defaultValue(type: HIRType): HIRExpr {
  switch (type.kind) {
    case "f64":
      return { kind: "literal_f64", value: 0, type: F64 };
    case "i64":
      return { kind: "literal_i64", value: 0, type: I64 };
    case "i1":
      return { kind: "literal_i1", value: false, type: I1 };
    case "i8ptr":
      return { kind: "literal_string", value: "", type: I8PTR };
    default:
      return { kind: "literal_null", type: { kind: "ptr", pointee: "" } };
  }
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

  if (ta.type === "TsArrayType") {
    const elem = resolveTypeAnnotation(ta.elemType);
    return { kind: "array", element: elem };
  }

  if (ta.type === "TsTypeReference" && ta.typeName?.type === "Identifier") {
    const name = ta.typeName.value;
    if (classRegistry.has(name)) {
      return { kind: "ptr", pointee: name };
    }
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
    case "BreakStatement":
      return [{ kind: "break" }];
    case "ContinueStatement":
      return [{ kind: "continue" }];
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
      if (declType.kind === "array")
        expectedArrayElementType = (declType as { kind: "array"; element: HIRType }).element;
      const init = d.init ? lowerExpr(d.init) : undefined;
      expectedArrayElementType = null;
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
    case "ArrayExpression":
      return lowerArrayLiteral(expr);
    case "NewExpression":
      return lowerNewExpr(expr as any);
    case "ThisExpression": {
      const thisLocal = locals.get("this");
      if (!thisLocal) compileError("'this' used outside class", expr.span);
      return { kind: "local_get", id: thisLocal.id, type: thisLocal.type };
    }
    default:
      compileError(`unsupported expression type: ${expr.type}`, expr.span);
  }
}

function lowerNumericLiteral(lit: NumericLiteral): HIRExpr {
  if (Number.isInteger(lit.value) && Math.abs(lit.value) <= Number.MAX_SAFE_INTEGER) {
    return { kind: "literal_i64", value: lit.value, type: I64 };
  }
  return { kind: "literal_f64", value: lit.value, type: F64 };
}

function lowerIdentifier(id: Identifier): HIRExpr {
  const local = locals.get(id.value);
  if (local) {
    return { kind: "local_get", id: local.id, type: local.type };
  }
  const global = globals.get(id.value);
  if (global) {
    return { kind: "global_get", name: id.value, type: global.type };
  }
  return { kind: "global_get", name: id.value, type: BOXED };
}

const BITWISE_OPS: BinaryOp[] = ["bit_and", "bit_or", "bit_xor", "shl", "shr", "ushr"];

function lowerBinary(expr: BinaryExpression): HIRExpr {
  let left = lowerExpr(expr.left);
  let right = lowerExpr(expr.right);
  const op = mapBinaryOp(expr.operator);

  if (op === "add" && (left.type.kind === "i8ptr" || right.type.kind === "i8ptr")) {
    return {
      kind: "runtime_call",
      func: "cs_string_concat",
      args: [left, right],
      returnType: I8PTR,
      type: I8PTR,
    };
  }

  if (BITWISE_OPS.includes(op)) {
    if (left.type.kind !== "i64") left = coerce(left, I64);
    if (right.type.kind !== "i64") right = coerce(right, I64);
    return { kind: "binary", op, left, right, type: I64 };
  }

  if (op === "div") {
    if (left.type.kind !== "f64") left = coerce(left, F64);
    if (right.type.kind !== "f64") right = coerce(right, F64);
    return { kind: "binary", op, left, right, type: F64 };
  }

  if (op === "and" || op === "or") {
    return { kind: "binary", op, left, right, type: I1 };
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
  if (expr.type.kind === "i64" && target.kind === "f64") {
    return { kind: "widen_f64", value: expr, type: F64 };
  }
  if (expr.type.kind === "f64" && target.kind === "i64") {
    return { kind: "narrow_i64", value: expr, type: I64 };
  }
  return expr;
}

function resolveArithType(a: HIRType, b: HIRType): HIRType {
  if (a.kind === "i64" && b.kind === "i64") return I64;
  if (a.kind === "f64" || b.kind === "f64") return F64;
  if (a.kind === "i64" || b.kind === "i64") return I64;
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
  if (arg.kind !== "local_get" && arg.kind !== "global_get") {
    throw new Error("update expression on non-local/global");
  }
  const one: HIRExpr =
    arg.type.kind === "i64"
      ? { kind: "literal_i64", value: 1, type: I64 }
      : { kind: "literal_f64", value: 1, type: F64 };
  const op: BinaryOp = expr.operator === "++" ? "add" : "sub";
  const newVal: HIRExpr = {
    kind: "binary",
    op,
    left: arg,
    right: one,
    type: arg.type,
  };
  if (arg.kind === "global_get") {
    return {
      kind: "global_set",
      name: arg.name,
      value: newVal,
      type: arg.type,
    };
  }
  return {
    kind: "local_set",
    id: arg.id,
    value: newVal,
    type: arg.type,
  };
}

function lowerArrayLiteral(expr: any): HIRExpr {
  const elements = (expr.elements || [])
    .filter((e: any) => e !== null)
    .map((e: any) => lowerExpr(e.expression));

  let elementType: HIRType = expectedArrayElementType || F64;
  if (elements.length > 0) {
    if (elements.some((e: HIRExpr) => e.type.kind === "i8ptr")) elementType = I8PTR;
    else elementType = F64;
  }

  const coercedElements = elements.map((e: HIRExpr) =>
    e.type.kind !== elementType.kind ? coerce(e, elementType) : e,
  );

  return {
    kind: "alloc_array",
    elementType,
    initialValues: coercedElements,
    type: { kind: "array", element: elementType },
  };
}

function lowerAssignment(expr: AssignmentExpression): HIRExpr {
  const op = expr.operator;
  let value: HIRExpr;

  if (op !== "=" && expr.left.type === "Identifier") {
    const left = lowerIdentifier(expr.left);
    const right = lowerExpr(expr.right);
    const binOp = compoundOpMap[op];
    if (!binOp) compileError(`unsupported assignment operator: ${op}`, expr.span);
    value = lowerBinaryWithOp(binOp, left, right);
  } else {
    value = lowerExpr(expr.right);
  }

  if (expr.left.type === "Identifier") {
    const local = locals.get(expr.left.value);
    if (local) {
      if (value.type.kind !== local.type.kind) value = coerce(value, local.type);
      return { kind: "local_set", id: local.id, value, type: local.type };
    }
    const global = globals.get(expr.left.value);
    if (global) {
      if (value.type.kind !== global.type.kind) value = coerce(value, global.type);
      return { kind: "global_set", name: expr.left.value, value, type: global.type };
    }
    return { kind: "global_set", name: expr.left.value, value, type: value.type };
  }

  if (expr.left.type === "MemberExpression") {
    const member = expr.left as MemberExpression;

    if (member.property.type === "Identifier") {
      const obj = lowerExpr(member.object);
      if (obj.type.kind === "ptr") {
        const className = (obj.type as { kind: "ptr"; pointee: string }).pointee;
        const classInfo = classRegistry.get(className);
        if (classInfo) {
          const fieldIdx = classInfo.fields.findIndex((f) => f.name === member.property.value);
          if (fieldIdx >= 0) {
            const field = classInfo.fields[fieldIdx];
            const coercedValue =
              value.type.kind !== field.type.kind ? coerce(value, field.type) : value;
            return {
              kind: "field_set",
              object: obj,
              fieldName: member.property.value,
              index: fieldIdx,
              value: coercedValue,
              type: field.type,
            };
          }
        }
      }
    }

    if ((member.property as any).type === "Computed") {
      const obj = lowerExpr(member.object);
      const index = lowerExpr((member.property as any).expression);
      if (obj.type.kind === "array") {
        const elemType = (obj.type as { kind: "array"; element: HIRType }).element;
        const coercedValue = value.type.kind !== elemType.kind ? coerce(value, elemType) : value;
        const idxCoerced = index.type.kind !== "i64" ? coerce(index, I64) : index;
        return {
          kind: "index_set",
          array: obj,
          index: idxCoerced,
          value: coercedValue,
          type: elemType,
        };
      }
    }
  }

  return value;
}

const compoundOpMap: Record<string, BinaryOp> = {
  "+=": "add",
  "-=": "sub",
  "*=": "mul",
  "/=": "div",
  "%=": "rem",
  "&=": "bit_and",
  "|=": "bit_or",
  "^=": "bit_xor",
  "<<=": "shl",
  ">>=": "shr",
  ">>>=": "ushr",
};

function lowerBinaryWithOp(op: BinaryOp, left: HIRExpr, right: HIRExpr): HIRExpr {
  if (BITWISE_OPS.includes(op)) {
    if (left.type.kind !== "i64") left = coerce(left, I64);
    if (right.type.kind !== "i64") right = coerce(right, I64);
    return { kind: "binary", op, left, right, type: I64 };
  }
  if (op === "div") {
    if (left.type.kind !== "f64") left = coerce(left, F64);
    if (right.type.kind !== "f64") right = coerce(right, F64);
    return { kind: "binary", op, left, right, type: F64 };
  }
  const operandType = resolveArithType(left.type, right.type);
  if (left.type.kind !== operandType.kind) left = coerce(left, operandType);
  if (right.type.kind !== operandType.kind) right = coerce(right, operandType);
  return { kind: "binary", op, left, right, type: operandType };
}

function lowerCall(expr: CallExpression): HIRExpr {
  if ((expr.callee as any).type === "Super") {
    if (!currentClassName) compileError("super() called outside constructor", expr.span);
    const classInfo = classRegistry.get(currentClassName);
    const parentName = classInfo?.parent;
    if (!parentName) compileError("super() called in class without parent", expr.span);

    const thisLocal = locals.get("this")!;
    const initFnName = `${parentName}_init`;
    const initInfo = functionRegistry.get(initFnName);
    const args: HIRExpr[] = [{ kind: "local_get", id: thisLocal.id, type: thisLocal.type }];
    for (let i = 0; i < expr.arguments.length; i++) {
      let arg = lowerExpr(expr.arguments[i].expression);
      if (initInfo && initInfo.params[i + 1]) {
        arg = coerce(arg, initInfo.params[i + 1].type);
      }
      args.push(arg);
    }
    return { kind: "call", callee: initFnName, args, returnType: VOID, type: VOID };
  }

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

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "String" &&
    expr.callee.property.type === "Identifier" &&
    expr.callee.property.value === "fromCharCode"
  ) {
    const args = expr.arguments.map((a) => coerce(lowerExpr(a.expression), I64));
    return {
      kind: "runtime_call",
      func: "cs2_str_from_char_code",
      args,
      returnType: I8PTR,
      type: I8PTR,
    };
  }

  if (expr.callee.type === "MemberExpression") {
    const obj = lowerExpr(expr.callee.object);
    if (obj.type.kind === "i8ptr") {
      return lowerStringMethodCall(expr, obj);
    }
    if (obj.type.kind === "array") {
      return lowerArrayMethodCall(expr, obj);
    }
    if (obj.type.kind === "ptr") {
      return lowerClassMethodCall(expr, obj);
    }
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

function lowerNewExpr(expr: any): HIRExpr {
  if (expr.callee.type !== "Identifier") {
    compileError("new expression requires identifier callee", expr.span);
  }
  const className = expr.callee.value;
  const classInfo = classRegistry.get(className);
  if (!classInfo) {
    compileError(`new expression for unknown class '${className}'`, expr.span);
  }

  const ctorInfo = functionRegistry.get(`${className}_constructor`);
  const args = (expr.arguments || []).map((a: any, i: number) => {
    let arg = lowerExpr(a.expression);
    if (ctorInfo && ctorInfo.params[i]) {
      arg = coerce(arg, ctorInfo.params[i].type);
    }
    return arg;
  });

  const resultType: HIRType = { kind: "ptr", pointee: className };
  return {
    kind: "call",
    callee: `${className}_constructor`,
    args,
    returnType: resultType,
    type: resultType,
  };
}

function lowerMathCall(expr: CallExpression): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;
  const args = expr.arguments.map((a) => lowerExpr(a.expression));

  if (method === "random") {
    return { kind: "runtime_call", func: "cs2_math_random", args: [], returnType: F64, type: F64 };
  }

  const func = `cs_math_${method}`;
  return {
    kind: "runtime_call",
    func,
    args,
    returnType: F64,
    type: F64,
  };
}

function lowerStringMethodCall(expr: CallExpression, obj: HIRExpr): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;
  const args = expr.arguments.map((a) => lowerExpr(a.expression));

  const strMethodMap: Record<string, { func: string; returnType: HIRType; argTypes?: HIRType[] }> =
    {
      charAt: { func: "cs2_str_char_at", returnType: I8PTR, argTypes: [I64] },
      indexOf: { func: "cs2_str_index_of", returnType: I64, argTypes: [I8PTR] },
      includes: { func: "cs2_str_includes", returnType: I1, argTypes: [I8PTR] },
      startsWith: { func: "cs2_str_starts_with", returnType: I1, argTypes: [I8PTR] },
      endsWith: { func: "cs2_str_ends_with", returnType: I1, argTypes: [I8PTR] },
      slice: { func: "cs2_str_slice", returnType: I8PTR, argTypes: [I64, I64] },
      substring: { func: "cs2_str_substring", returnType: I8PTR, argTypes: [I64, I64] },
      toUpperCase: { func: "cs2_str_to_upper", returnType: I8PTR },
      toLowerCase: { func: "cs2_str_to_lower", returnType: I8PTR },
      trim: { func: "cs2_str_trim", returnType: I8PTR },
      repeat: { func: "cs2_str_repeat", returnType: I8PTR, argTypes: [I64] },
      replace: { func: "cs2_str_replace", returnType: I8PTR, argTypes: [I8PTR, I8PTR] },
      charCodeAt: { func: "cs2_str_char_code_at", returnType: I64, argTypes: [I64] },
    };

  const info = strMethodMap[method];
  if (!info) {
    compileError(`unsupported string method: ${method}`, expr.span);
  }

  const coercedArgs = info.argTypes ? args.map((a, i) => coerce(a, info.argTypes![i])) : [];

  const bridgeRetType = info.returnType;
  const rtCall: HIRExpr = {
    kind: "runtime_call",
    func: info.func,
    args: [obj, ...coercedArgs],
    returnType: bridgeRetType,
    type: bridgeRetType,
  };

  if (
    info.func === "cs2_str_includes" ||
    info.func === "cs2_str_starts_with" ||
    info.func === "cs2_str_ends_with"
  ) {
    return {
      kind: "binary",
      op: "ne" as BinaryOp,
      left: rtCall,
      right: { kind: "literal_i64", value: 0, type: I64 },
      type: I1,
    };
  }

  return rtCall;
}

function lowerArrayMethodCall(expr: CallExpression, obj: HIRExpr): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;
  const args = expr.arguments.map((a) => lowerExpr(a.expression));
  const arrType = obj.type as { kind: "array"; element: HIRType };
  const isStr = arrType.element.kind === "i8ptr";
  const prefix = isStr ? "cs2_str_array" : "cs2_num_array";

  type MethodInfo = { func: string; returnType: HIRType; argTypes?: HIRType[] };
  let info: MethodInfo | undefined;

  if (method === "push") {
    info = { func: `${prefix}_push`, returnType: VOID, argTypes: [arrType.element] };
  } else if (method === "pop") {
    info = { func: `${prefix}_pop`, returnType: arrType.element };
  } else if (method === "join") {
    info = { func: `${prefix}_join`, returnType: I8PTR, argTypes: [I8PTR] };
  } else if (!isStr) {
    const numMethods: Record<string, MethodInfo> = {
      indexOf: { func: "cs2_num_array_index_of", returnType: I64, argTypes: [F64] },
      includes: { func: "cs2_num_array_includes", returnType: I64, argTypes: [F64] },
      slice: { func: "cs2_num_array_slice", returnType: obj.type, argTypes: [I64, I64] },
      reverse: { func: "cs2_num_array_reverse", returnType: VOID },
    };
    info = numMethods[method];
  }

  if (!info) compileError(`unsupported array method: ${method}`, expr.span);

  const coercedArgs = info.argTypes ? args.map((a, i) => coerce(a, info!.argTypes![i])) : [];

  const rtCall: HIRExpr = {
    kind: "runtime_call",
    func: info.func,
    args: [obj, ...coercedArgs],
    returnType: info.returnType,
    type: info.returnType,
  };

  if (method === "includes") {
    return {
      kind: "binary",
      op: "ne" as BinaryOp,
      left: rtCall,
      right: { kind: "literal_i64", value: 0, type: I64 },
      type: I1,
    };
  }

  return rtCall;
}

function resolveMethod(
  className: string,
  method: string,
): { fnName: string; fnInfo: { params: HIRParam[]; returnType: HIRType } } | undefined {
  let cls: string | undefined = className;
  while (cls) {
    const fnName = `${cls}_${method}`;
    const fnInfo = functionRegistry.get(fnName);
    if (fnInfo) return { fnName, fnInfo };
    const classInfo = classRegistry.get(cls);
    cls = classInfo?.parent;
  }
  return undefined;
}

function lowerClassMethodCall(expr: CallExpression, obj: HIRExpr): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;
  const className = (obj.type as { kind: "ptr"; pointee: string }).pointee;

  const resolved = resolveMethod(className, method);
  if (!resolved) {
    compileError(`unknown method '${method}' on class '${className}'`, expr.span);
  }

  const args: HIRExpr[] = [obj];
  for (let i = 0; i < expr.arguments.length; i++) {
    let arg = lowerExpr(expr.arguments[i].expression);
    if (resolved.fnInfo.params[i + 1]) {
      arg = coerce(arg, resolved.fnInfo.params[i + 1].type);
    }
    args.push(arg);
  }

  return {
    kind: "call",
    callee: resolved.fnName,
    args,
    returnType: resolved.fnInfo.returnType,
    type: resolved.fnInfo.returnType,
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

  if ((expr.property as any).type === "Computed") {
    const obj = lowerExpr(expr.object);
    const index = lowerExpr((expr.property as any).expression);
    if (obj.type.kind === "array") {
      const elemType = (obj.type as { kind: "array"; element: HIRType }).element;
      const idxCoerced = index.type.kind !== "i64" ? coerce(index, I64) : index;
      return { kind: "index_get", array: obj, index: idxCoerced, type: elemType };
    }
    compileError("unsupported computed member access", expr.span);
  }

  if (expr.property.type === "Identifier") {
    const propName = expr.property.value;

    if (propName === "length") {
      const obj = lowerExpr(expr.object);
      if (obj.type.kind === "i8ptr") {
        return {
          kind: "runtime_call",
          func: "cs2_str_length",
          args: [obj],
          returnType: I64,
          type: I64,
        };
      }
      if (obj.type.kind === "array") {
        const elemType = (obj.type as { kind: "array"; element: HIRType }).element;
        const lenFn = elemType.kind === "i8ptr" ? "cs2_str_array_length" : "cs2_num_array_length";
        return { kind: "runtime_call", func: lenFn, args: [obj], returnType: I64, type: I64 };
      }
    }

    const obj = lowerExpr(expr.object);
    if (obj.type.kind === "ptr") {
      const className = (obj.type as { kind: "ptr"; pointee: string }).pointee;
      const classInfo = classRegistry.get(className);
      if (classInfo) {
        const fieldIdx = classInfo.fields.findIndex((f) => f.name === propName);
        if (fieldIdx >= 0) {
          const field = classInfo.fields[fieldIdx];
          return {
            kind: "field_get",
            object: obj,
            fieldName: propName,
            index: fieldIdx,
            type: field.type,
          };
        }
      }
    }
  }

  const obj = expr.object.type === "Identifier" ? expr.object.value : expr.object.type;
  const prop = expr.property.type === "Identifier" ? expr.property.value : expr.property.type;
  compileError(`unsupported member access: ${obj}.${prop}`, expr.span);
}
