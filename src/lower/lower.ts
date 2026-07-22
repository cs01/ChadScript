// The lower pass: tsc AST + TypeChecker → HIR. This is the ONLY module in the compiler that
// imports `typescript` and queries the checker (the frontend's job ends here). It stamps every
// HIR expression with a resolved ValueType so the backend never touches the checker.
//
// Names are RESOLVED to their tsc Symbol and given a unique HIR name here. Two different
// variables that share a source name (shadowing) get distinct HIR names, so the backend's flat
// binding map is correct by construction — no scope stack, and it stays correct for closures.
//
// The validator has already admitted only in-subset constructs, so a shape we don't recognize
// here is an ICE (a validator/lower mismatch), not a user error.

import ts from "typescript";
import { ice } from "../diagnostics.js";
import type { LoadedProgram } from "../frontend/program.js";
import type { HModule, HStmt, HExpr, HFunc, HCapture, UnaryOp, BinaryOp } from "../hir/nodes.js";
import { VT } from "../hir/types.js";
import type { ValueType } from "../hir/types.js";

interface LowerCtx {
  checker: ts.TypeChecker;
  // Symbol identity → unique HIR name. Shadowing variables have distinct symbols, so distinct
  // names. Keyed by Symbol so a reference resolves to the same name as its declaration.
  names: Map<ts.Symbol, string>;
  counter: { n: number };
  // The `this` binding while lowering a method/constructor body (null at top level / in free
  // functions). `this` lowers to a varRef of this name + the instance type.
  currentThis: { name: string; type: ValueType } | null;
  // Output list of all functions, incl. lambdas lifted from arrow/function expressions.
  functions: HFunc[];
}

// The `undefined` literal (a global identifier in TS).
function isUndefinedLiteral(e: ts.Expression): boolean {
  return ts.isIdentifier(e) && e.text === "undefined";
}

// A property whose declaration is a method (as opposed to a data field).
function isMethodSymbol(sym: ts.Symbol): boolean {
  const d = sym.valueDeclaration;
  return d !== undefined && (ts.isMethodDeclaration(d) || ts.isMethodSignature(d));
}

export function lower(loaded: LoadedProgram): HModule {
  const ctx: LowerCtx = {
    checker: loaded.checker,
    names: new Map(),
    counter: { n: 0 },
    currentThis: null,
    functions: [],
  };
  const topLevel: HStmt[] = [];
  for (const sf of loaded.sourceFiles) {
    for (const stmt of sf.statements) {
      // Type-only declarations have no runtime and are consumed by the checker, not lowered.
      if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) continue;
      if (ts.isFunctionDeclaration(stmt)) {
        ctx.functions.push(lowerFunction(stmt, ctx));
      } else if (ts.isClassDeclaration(stmt)) {
        ctx.functions.push(...lowerClass(stmt, ctx));
      } else {
        topLevel.push(...lowerStatement(stmt, ctx));
      }
    }
  }
  return { functions: ctx.functions, topLevel };
}

// A class lowers to a set of free functions: each method and the constructor become an HFunc
// taking the instance record as a hidden first parameter `this`. Field access uses the object
// member machinery. First pass: no inheritance / static / getters.
function lowerClass(decl: ts.ClassDeclaration, ctx: LowerCtx): HFunc[] {
  if (!decl.name) ice("lower: anonymous class not supported");
  const className = decl.name.text;
  const classSym = ctx.checker.getSymbolAtLocation(decl.name)!;
  const instanceType = ctx.checker.getDeclaredTypeOfSymbol(classSym);
  const thisType = valueTypeOfTsType(instanceType, decl.name, ctx.checker);

  const funcs: HFunc[] = [];
  for (const member of decl.members) {
    if (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)) {
      funcs.push(lowerMethodLike(className, member, thisType, ctx));
    } else if (ts.isPropertyDeclaration(member)) {
      if (member.initializer)
        ice("lower: class field initializers not supported yet (set in ctor)");
    } else {
      ice(`lower: unsupported class member ${ts.SyntaxKind[member.kind]}`);
    }
  }
  return funcs;
}

// A method or constructor → an HFunc `Class.name` with `this` prepended to the params.
function lowerMethodLike(
  className: string,
  member: ts.MethodDeclaration | ts.ConstructorDeclaration,
  thisType: ValueType,
  ctx: LowerCtx,
): HFunc {
  if (!member.body) ice("lower: method/constructor without a body");
  const isCtor = ts.isConstructorDeclaration(member);
  const memberName = isCtor ? "constructor" : (member.name as ts.Identifier).text;
  const thisName = `this.${ctx.counter.n++}`;

  const params = [
    { name: thisName, type: thisType },
    ...member.parameters.map((p) => {
      if (!ts.isIdentifier(p.name)) ice("lower: destructured parameter not supported");
      return { name: nameOf(p.name, ctx), type: valueTypeOf(p.name, ctx) };
    }),
  ];

  const savedThis = ctx.currentThis;
  ctx.currentThis = { name: thisName, type: thisType };
  const body = lowerStatements(member.body.statements, ctx);
  ctx.currentThis = savedThis;

  // A constructor returns nothing (the record is returned by `new`); a method returns its
  // declared type.
  const returnType = isCtor ? null : returnTypeOfSignature(member, ctx);
  return { name: `${className}.${memberName}`, params, returnType, body };
}

// An arrow function / function expression → a closure value. The body is lifted to a top-level
// HFunc that takes a hidden `env` parameter; free variables are captured into that env.
function lowerArrow(arrow: ts.ArrowFunction | ts.FunctionExpression, ctx: LowerCtx): HExpr {
  const lambdaName = `lambda.${ctx.counter.n++}`;
  const params = arrow.parameters.map((p) => {
    if (!ts.isIdentifier(p.name)) ice("lower: destructured lambda parameter not supported");
    return { name: nameOf(p.name, ctx), type: valueTypeOf(p.name, ctx) };
  });
  // Capture free variables (found by walking the body AFTER params are registered, so params
  // aren't mistaken for captures).
  const captures = findCaptures(arrow, ctx);

  const body: HStmt[] = ts.isBlock(arrow.body)
    ? lowerStatements(arrow.body.statements, ctx)
    : [{ kind: "return", value: lowerExpr(arrow.body, ctx) }];

  const sig = ctx.checker.getSignatureFromDeclaration(arrow);
  const retT = sig ? ctx.checker.getReturnTypeOfSignature(sig) : undefined;
  const returnType =
    !retT || retT.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)
      ? null
      : valueTypeOfTsType(retT, arrow, ctx.checker);

  ctx.functions.push({ name: lambdaName, params, returnType, body, captures });
  return {
    kind: "closure",
    lambdaName,
    captures,
    type: { kind: "function", params: params.map((p) => p.type), ret: returnType },
  };
}

// Free variables of an arrow: identifiers referring to a local variable/parameter declared
// OUTSIDE the arrow (i.e. captured from an enclosing scope). Top-level functions, globals, and
// the arrow's own params/locals are not captures.
function findCaptures(arrow: ts.ArrowFunction | ts.FunctionExpression, ctx: LowerCtx): HCapture[] {
  const caps = new Map<ts.Symbol, HCapture>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const sym = ctx.checker.getSymbolAtLocation(node);
      if (sym && !caps.has(sym)) {
        const kind = captureKind(sym, arrow);
        // Capture by value at closure creation. That is only SOUND for immutable (`const`)
        // bindings — a mutable capture would need capture-by-reference (heap-boxed), so reject
        // it rather than silently diverge from JS.
        if (kind === "mutable") {
          ice(`lower: closures may only capture const variables yet ('${node.text}' is mutable)`);
        }
        if (kind === "const") {
          const name = ctx.names.get(sym);
          if (name) caps.set(sym, { name, type: valueTypeOf(node, ctx) });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(arrow.body);
  return [...caps.values()];
}

// Whether a symbol referenced in an arrow is captured, and if so how. "no" = the arrow's own
// local/param, a top-level function, or a global (referenced by name, not captured).
function captureKind(sym: ts.Symbol, arrow: ts.Node): "const" | "mutable" | "no" {
  const d = sym.valueDeclaration;
  if (!d) return "no";
  if (isDescendantOf(d, arrow)) return "no"; // declared inside the arrow → local
  // Capture is by value at creation, so it must be a binding whose value is stable. `const`
  // vars are guaranteed stable; parameters are captured by value too (a parameter reassigned
  // after the closure is created would diverge — a documented limitation until capture-by-
  // reference lands). A mutable `let` is rejected outright.
  if (ts.isParameter(d)) return "const";
  if (ts.isVariableDeclaration(d)) {
    return d.parent.flags & ts.NodeFlags.Const ? "const" : "mutable";
  }
  return "no"; // functions, classes, globals
}

function isDescendantOf(node: ts.Node, ancestor: ts.Node): boolean {
  for (let p: ts.Node | undefined = node; p; p = p.parent) if (p === ancestor) return true;
  return false;
}

function lowerFunction(decl: ts.FunctionDeclaration, ctx: LowerCtx): HFunc {
  if (!decl.name) ice("lower: anonymous function declaration not supported");
  if (!decl.body) ice("lower: function without a body (overload/declare) not supported");
  const params = decl.parameters.map((p) => {
    if (!ts.isIdentifier(p.name)) ice("lower: destructured parameters not supported yet");
    if (p.dotDotDotToken) ice("lower: rest parameters not supported yet");
    if (p.questionToken || p.initializer)
      ice("lower: optional/default parameters not supported yet");
    return { name: nameOf(p.name, ctx), type: valueTypeOf(p.name, ctx) };
  });
  return {
    name: nameOf(decl.name, ctx),
    params,
    returnType: returnTypeOf(decl, ctx),
    body: lowerStatements(decl.body.statements, ctx),
  };
}

// A bare identifier in expression position is a variable reference. If the variable's DECLARED
// type is optional but it is being used here at a narrowed (non-optional) type — i.e. inside an
// `if (x !== undefined)` guard — emit an `unwrap` so codegen unboxes the stored optional.
function lowerIdentifier(ident: ts.Identifier, ctx: LowerCtx, useType: ValueType): HExpr {
  const sym = ctx.checker.getSymbolAtLocation(ident);
  if (sym?.valueDeclaration && useType.kind !== "optional") {
    const declared = valueTypeOfTsType(
      ctx.checker.getTypeOfSymbolAtLocation(sym, sym.valueDeclaration),
      ident,
      ctx.checker,
    );
    if (declared.kind === "optional") {
      return {
        kind: "unwrap",
        value: { kind: "varRef", name: nameForSymbol(sym, ident.text, ctx), type: declared },
        type: useType,
      };
    }
  }
  return { kind: "varRef", name: nameOf(ident, ctx), type: useType };
}

// The stable HIR name for the variable an identifier resolves to. Falls back to the source
// text keyed by position if the checker cannot produce a symbol (should not happen for the
// admitted subset), so distinct-but-symbolless names never collide.
function nameOf(ident: ts.Identifier, ctx: LowerCtx): string {
  const symbol = ctx.checker.getSymbolAtLocation(ident);
  if (!symbol) return ice(`lower: no symbol for identifier ${ident.text}`);
  return nameForSymbol(symbol, ident.text, ctx);
}

// The stable unique HIR name for a symbol. Used directly for shorthand object properties, where
// the property identifier's own symbol is the property — not the value variable we must bind to.
function nameForSymbol(symbol: ts.Symbol, hint: string, ctx: LowerCtx): string {
  let name = ctx.names.get(symbol);
  if (!name) {
    name = `${hint}.${ctx.counter.n++}`;
    ctx.names.set(symbol, name);
  }
  return name;
}

// Returns an array because one `let a = 1, b = 2;` lowers to several varDecls.
function lowerStatement(stmt: ts.Statement, ctx: LowerCtx): HStmt[] {
  if (ts.isExpressionStatement(stmt)) {
    if (ts.isCallExpression(stmt.expression)) return [lowerCallStatement(stmt.expression, ctx)];
    return [lowerExprStatement(stmt.expression, ctx)];
  }
  if (ts.isVariableStatement(stmt)) {
    return stmt.declarationList.declarations.map((d) => lowerVarDecl(d, ctx));
  }
  if (ts.isIfStatement(stmt)) {
    return [lowerIf(stmt, ctx)];
  }
  if (ts.isWhileStatement(stmt)) {
    return [
      {
        kind: "while",
        cond: lowerExpr(stmt.expression, ctx),
        body: lowerBranchBody(stmt.statement, ctx),
      },
    ];
  }
  if (ts.isForStatement(stmt)) {
    return [lowerFor(stmt, ctx)];
  }
  if (ts.isForOfStatement(stmt)) {
    return [lowerForOf(stmt, ctx)];
  }
  if (ts.isReturnStatement(stmt)) {
    return [{ kind: "return", value: stmt.expression ? lowerExpr(stmt.expression, ctx) : null }];
  }
  if (ts.isBreakStatement(stmt)) {
    if (stmt.label) ice("lower: labeled break not supported yet");
    return [{ kind: "break" }];
  }
  if (ts.isContinueStatement(stmt)) {
    if (stmt.label) ice("lower: labeled continue not supported yet");
    return [{ kind: "continue" }];
  }
  if (ts.isSwitchStatement(stmt)) {
    return [lowerSwitch(stmt, ctx)];
  }
  if (ts.isBlock(stmt)) {
    // A bare block just contributes its statements (flattened; scoping is enforced by tsc, and
    // shadowing is safe because names are symbol-unique).
    return lowerStatements(stmt.statements, ctx);
  }
  return ice(`lower: unsupported statement ${ts.SyntaxKind[stmt.kind]}`);
}

function lowerStatements(stmts: readonly ts.Statement[], ctx: LowerCtx): HStmt[] {
  return stmts.flatMap((s) => lowerStatement(s, ctx));
}

// The body of a branch is either a block (`{ ... }`) or a single statement (`if (c) x();`).
function lowerBranchBody(stmt: ts.Statement, ctx: LowerCtx): HStmt[] {
  return ts.isBlock(stmt) ? lowerStatements(stmt.statements, ctx) : lowerStatement(stmt, ctx);
}

function lowerIf(stmt: ts.IfStatement, ctx: LowerCtx): HStmt {
  return {
    kind: "if",
    cond: lowerExpr(stmt.expression, ctx),
    then: lowerBranchBody(stmt.thenStatement, ctx),
    otherwise: stmt.elseStatement ? lowerBranchBody(stmt.elseStatement, ctx) : null,
  };
}

function lowerSwitch(stmt: ts.SwitchStatement, ctx: LowerCtx): HStmt {
  const cases = stmt.caseBlock.clauses.map((clause) => ({
    test: ts.isCaseClause(clause) ? lowerExpr(clause.expression, ctx) : null,
    body: lowerStatements(clause.statements, ctx),
  }));
  return {
    kind: "switch",
    disc: lowerExpr(stmt.expression, ctx),
    discType: resolveType(stmt.expression, ctx),
    cases,
  };
}

function lowerForOf(stmt: ts.ForOfStatement, ctx: LowerCtx): HStmt {
  const arrayType = resolveType(stmt.expression, ctx);
  if (arrayType.kind !== "array") ice("lower: for...of is only supported over arrays yet");
  // The loop variable is `for (const x of arr)`.
  if (!ts.isVariableDeclarationList(stmt.initializer)) {
    ice("lower: for...of requires a `const`/`let` binding");
  }
  const decl = stmt.initializer.declarations[0]!;
  if (!ts.isIdentifier(decl.name)) ice("lower: for...of destructuring not supported yet");
  return {
    kind: "forOf",
    name: nameOf(decl.name, ctx),
    elementType: arrayType.element,
    array: lowerExpr(stmt.expression, ctx),
    body: lowerBranchBody(stmt.statement, ctx),
  };
}

function lowerFor(stmt: ts.ForStatement, ctx: LowerCtx): HStmt {
  let init: HStmt[] = [];
  if (stmt.initializer) {
    init = ts.isVariableDeclarationList(stmt.initializer)
      ? stmt.initializer.declarations.map((d) => lowerVarDecl(d, ctx))
      : [lowerExprStatement(stmt.initializer, ctx)];
  }
  const update = stmt.incrementor ? [lowerExprStatement(stmt.incrementor, ctx)] : [];
  return {
    kind: "for",
    init,
    cond: stmt.condition ? lowerExpr(stmt.condition, ctx) : null,
    update,
    body: lowerBranchBody(stmt.statement, ctx),
  };
}

// A statement-position expression whose value is discarded: assignment, compound assignment,
// or ++/-- (which we desugar to an assignment). Used for expression statements and for-clauses.
function lowerExprStatement(expr: ts.Expression, ctx: LowerCtx): HStmt {
  if (ts.isBinaryExpression(expr) && isAssignmentOp(expr.operatorToken.kind)) {
    return lowerAssignment(expr, ctx);
  }
  if (ts.isPostfixUnaryExpression(expr) || ts.isPrefixUnaryExpression(expr)) {
    return lowerIncDec(expr, ctx);
  }
  return ice(`lower: unsupported expression statement ${ts.SyntaxKind[expr.kind]}`);
}

// `i++` / `i--` / `++i` / `--i` in statement position → `i = i +/- 1`. The pre/post distinction
// only matters for the produced value, which statement position discards.
function lowerIncDec(
  expr: ts.PostfixUnaryExpression | ts.PrefixUnaryExpression,
  ctx: LowerCtx,
): HStmt {
  const op = expr.operator;
  if (op !== ts.SyntaxKind.PlusPlusToken && op !== ts.SyntaxKind.MinusMinusToken) {
    // A prefix +/-/! in statement position has no effect and is pointless — reject upstream.
    return ice(`lower: unsupported unary statement operator ${ts.SyntaxKind[op]}`);
  }
  const binOp = op === ts.SyntaxKind.PlusPlusToken ? "add" : "sub";
  const one: HExpr = { kind: "numberLit", value: 1, type: VT.number };

  // `obj.field++` → `obj.field = obj.field ± 1`.
  if (ts.isPropertyAccessExpression(expr.operand)) {
    const pa = expr.operand;
    const objType = resolveType(pa.expression, ctx);
    if (objType.kind !== "object") ice(`lower: ++/-- on non-object property .${pa.name.text}`);
    const slot = objType.shape.fields.findIndex((f) => f.name === pa.name.text);
    if (slot < 0) ice(`lower: object has no field ${pa.name.text}`);
    const object = lowerExpr(pa.expression, ctx);
    return {
      kind: "memberSet",
      object,
      slot,
      value: {
        kind: "binary",
        op: binOp,
        left: { kind: "memberGet", object, slot, type: VT.number },
        right: one,
        type: VT.number,
      },
    };
  }

  if (!ts.isIdentifier(expr.operand)) ice("lower: ++/-- only supported on a variable or field");
  const name = nameOf(expr.operand, ctx);
  const numberType = resolveType(expr.operand, ctx);
  return {
    kind: "assign",
    name,
    value: {
      kind: "binary",
      op: binOp,
      left: { kind: "varRef", name, type: numberType },
      right: one,
      type: numberType,
    },
  };
}

function lowerAssignment(expr: ts.BinaryExpression, ctx: LowerCtx): HStmt {
  const op = expr.operatorToken.kind;
  if (ts.isPropertyAccessExpression(expr.left)) {
    return lowerMemberAssignment(expr.left, op, expr.right, ctx);
  }
  if (!ts.isIdentifier(expr.left)) ice("lower: only `name = ...` / `obj.field = ...` supported");
  const left = expr.left as ts.Identifier;
  const name = nameOf(left, ctx);
  if (op === ts.SyntaxKind.EqualsToken) {
    return { kind: "assign", name, value: lowerExpr(expr.right, ctx) };
  }
  // Compound assignment `name <op>= rhs` desugars to `name = name <op> rhs`. The value's type
  // matches the variable (numeric compound ops on a number stay a number).
  const value: HExpr = {
    kind: "binary",
    op: compoundOp(op),
    left: lowerExpr(left, ctx),
    right: lowerExpr(expr.right, ctx),
    type: resolveType(left, ctx),
  };
  return { kind: "assign", name, value };
}

// `obj.field = rhs` / `obj.field <op>= rhs`. The object is lowered once; a compound op reads the
// current field value via a memberGet on the same object expression.
function lowerMemberAssignment(
  lhs: ts.PropertyAccessExpression,
  op: ts.SyntaxKind,
  rhs: ts.Expression,
  ctx: LowerCtx,
): HStmt {
  const objType = resolveType(lhs.expression, ctx);
  if (objType.kind !== "object") ice(`lower: assignment to .${lhs.name.text} on non-object`);
  const slot = objType.shape.fields.findIndex((f) => f.name === lhs.name.text);
  if (slot < 0) ice(`lower: object has no field ${lhs.name.text}`);
  const fieldType = objType.shape.fields[slot]!.type;
  const object = lowerExpr(lhs.expression, ctx);
  if (op === ts.SyntaxKind.EqualsToken) {
    return { kind: "memberSet", object, slot, value: lowerExpr(rhs, ctx) };
  }
  const value: HExpr = {
    kind: "binary",
    op: compoundOp(op),
    left: { kind: "memberGet", object, slot, type: fieldType },
    right: lowerExpr(rhs, ctx),
    type: fieldType,
  };
  return { kind: "memberSet", object, slot, value };
}

function lowerVarDecl(decl: ts.VariableDeclaration, ctx: LowerCtx): HStmt {
  if (!ts.isIdentifier(decl.name)) ice("lower: destructuring declarations not supported yet");
  if (!decl.initializer) ice("lower: variable declaration without initializer not supported yet");
  const init = lowerExpr(decl.initializer, ctx);
  return { kind: "varDecl", name: nameOf(decl.name, ctx), init, type: init.type };
}

function lowerCallStatement(call: ts.CallExpression, ctx: LowerCtx): HStmt {
  const target = calleeName(call.expression);

  switch (target) {
    case "console.log":
      // Variadic: zero or more values, any supported type each.
      return { kind: "consoleLog", values: call.arguments.map((a) => lowerExpr(a, ctx)) };
    case "process.exit": {
      const arg = call.arguments[0];
      if (call.arguments.length !== 1 || !arg) ice("lower: process.exit expects one argument");
      return { kind: "processExit", code: lowerExpr(arg, ctx) };
    }
    default: {
      // A method call `obj.method(...)` in statement position → evaluate for effect, discard.
      if (ts.isPropertyAccessExpression(call.expression)) {
        const pa = call.expression;
        if (isMathNamespace(pa.expression)) {
          return { kind: "exprStmt", expr: lowerMethodCall(call, ctx) };
        }
        const recvType = resolveType(pa.expression, ctx);
        // A class method (possibly void) → callStmt with `this` prepended, so void methods work.
        if (recvType.kind === "object" && recvType.className !== undefined) {
          return {
            kind: "callStmt",
            name: `${recvType.className}.${pa.name.text}`,
            args: [lowerExpr(pa.expression, ctx), ...call.arguments.map((a) => lowerExpr(a, ctx))],
            returnType: callReturnType(call, ctx),
          };
        }
        return { kind: "exprStmt", expr: lowerMethodCall(call, ctx) };
      }
      // A user-function call in statement position: evaluate for effect, discard the result.
      if (!ts.isIdentifier(call.expression)) {
        return ice(`lower: unsupported call target ${ts.SyntaxKind[call.expression.kind]}`);
      }
      return {
        kind: "callStmt",
        name: nameOf(call.expression, ctx),
        args: call.arguments.map((a) => lowerExpr(a, ctx)),
        returnType: callReturnType(call, ctx),
      };
    }
  }
}

// A call used as a value: a user function `foo(args)`, a method `obj.method(args)`, or a call
// through a function VALUE (closure) held in a variable.
function lowerCall(call: ts.CallExpression, ctx: LowerCtx): HExpr {
  if (ts.isPropertyAccessExpression(call.expression)) {
    return lowerMethodCall(call, ctx);
  }
  if (!ts.isIdentifier(call.expression)) {
    return ice(`lower: unsupported call target ${ts.SyntaxKind[call.expression.kind]}`);
  }
  // Global builtin functions (from the default lib, not user code): parseInt/parseFloat.
  const builtin = lowerGlobalBuiltin(call.expression.text, call, ctx);
  if (builtin) return builtin;
  // A call whose callee is NOT a top-level function declaration is a closure call.
  const sym = ctx.checker.getSymbolAtLocation(call.expression);
  const isTopLevelFn = sym?.valueDeclaration && ts.isFunctionDeclaration(sym.valueDeclaration);
  if (!isTopLevelFn) {
    return {
      kind: "callClosure",
      callee: lowerExpr(call.expression, ctx),
      args: call.arguments.map((a) => lowerExpr(a, ctx)),
      type: resolveType(call, ctx),
    };
  }
  return {
    kind: "call",
    name: nameOf(call.expression, ctx),
    args: call.arguments.map((a) => lowerExpr(a, ctx)),
    type: valueTypeOf(call, ctx),
  };
}

// A bare-identifier call to a global builtin (parseInt/parseFloat). Returns null if `name` is
// not a recognized builtin, so the caller falls back to user-function / closure handling. These
// come from the default lib's type signatures; the runtime backs them in C.
function lowerGlobalBuiltin(name: string, call: ts.CallExpression, ctx: LowerCtx): HExpr | null {
  if (name === "parseInt") {
    const radix = call.arguments[1];
    return {
      kind: "runtimeCall",
      fn: "cs_parse_int",
      // radix omitted → 0 sentinel (the runtime reads 0 as "default 10 with 0x auto-detect").
      args: [lowerExpr(call.arguments[0]!, ctx), radix ? lowerExpr(radix, ctx) : numLit(0)],
      type: VT.number,
    };
  }
  if (name === "parseFloat") {
    return {
      kind: "runtimeCall",
      fn: "cs_parse_float",
      args: [lowerExpr(call.arguments[0]!, ctx)],
      type: VT.number,
    };
  }
  return null;
}

// A synthetic number literal HExpr (for builtin default arguments).
function numLit(value: number): HExpr {
  return { kind: "numberLit", value, type: VT.number };
}

// Object literal → fields in SHAPE (record-slot) order, regardless of the source property order.
// tsc guarantees every required field is present. Supports `{ x: v }` and shorthand `{ x }`.
function lowerObjectLit(ole: ts.ObjectLiteralExpression, ctx: LowerCtx, type: ValueType): HExpr {
  if (type.kind !== "object") ice("lower: object literal without a resolved object shape");
  const fields = type.shape.fields.map((f): HExpr => {
    const prop = ole.properties.find(
      (p) => p.name && ts.isIdentifier(p.name) && p.name.text === f.name,
    );
    // An omitted field must be optional (tsc enforces); store the undefined sentinel.
    if (!prop) {
      if (f.type.kind !== "optional") ice(`lower: object literal missing field ${f.name}`);
      return { kind: "undefinedOpt", type: f.type };
    }
    let value: HExpr;
    if (ts.isPropertyAssignment(prop)) value = lowerExpr(prop.initializer, ctx);
    else if (ts.isShorthandPropertyAssignment(prop)) {
      // `{ a }` means field `a` = the variable `a`. Resolve the VALUE symbol (the variable),
      // not the property symbol the shorthand identifier reports.
      const valueSym = ctx.checker.getShorthandAssignmentValueSymbol(prop);
      if (!valueSym) return ice(`lower: cannot resolve shorthand property ${f.name}`);
      value = { kind: "varRef", name: nameForSymbol(valueSym, f.name, ctx), type: f.type };
    } else return ice(`lower: unsupported object member for ${f.name}`);
    // An inner value assigned to an optional field is wrapped into a present optional.
    if (f.type.kind === "optional" && value.type.kind !== "optional") {
      return { kind: "wrap", value, type: f.type };
    }
    return value;
  });
  return { kind: "objectLit", fields, type };
}

// The JS Math namespace constants, exact (evaluated in the compiler's own JS).
const MATH_CONSTS: Record<string, number> = {
  PI: Math.PI,
  E: Math.E,
  LN2: Math.LN2,
  LN10: Math.LN10,
  LOG2E: Math.LOG2E,
  LOG10E: Math.LOG10E,
  SQRT2: Math.SQRT2,
  SQRT1_2: Math.SQRT1_2,
};

// True when `expr` is the identifier `Math` (the namespace, not a user variable).
function isMathNamespace(expr: ts.Expression): boolean {
  return ts.isIdentifier(expr) && expr.text === "Math";
}

// A method call `obj.method(args)`. Dispatched on the receiver's type + method name.
function lowerMethodCall(call: ts.CallExpression, ctx: LowerCtx): HExpr {
  const pa = call.expression as ts.PropertyAccessExpression;
  // `Math.floor(x)` etc. — a builtin namespace call, not a value method. Check before resolving
  // the receiver's type (Math is not a value).
  if (isMathNamespace(pa.expression)) {
    return {
      kind: "mathCall",
      fn: pa.name.text,
      args: call.arguments.map((a) => lowerExpr(a, ctx)),
      type: VT.number,
    };
  }
  const recvType = resolveType(pa.expression, ctx);
  const method = pa.name.text;
  if (recvType.kind === "array") {
    if (method === "push") {
      return {
        kind: "arrayPush",
        array: lowerExpr(pa.expression, ctx),
        value: lowerExpr(call.arguments[0]!, ctx),
        elementType: recvType.element,
        type: VT.number,
      };
    }
    if (method === "pop" || method === "shift") {
      return {
        kind: "arrayPop",
        array: lowerExpr(pa.expression, ctx),
        fn: method === "pop" ? "cs_array_pop" : "cs_array_shift",
        type: resolveType(call, ctx), // element | undefined
      };
    }
    if (method === "join") {
      const sep = call.arguments[0];
      return {
        kind: "arrayJoin",
        array: lowerExpr(pa.expression, ctx),
        separator: sep ? lowerExpr(sep, ctx) : null,
        elementType: recvType.element,
        type: VT.string,
      };
    }
    if (method === "includes" || method === "indexOf") {
      return {
        kind: "arraySearch",
        array: lowerExpr(pa.expression, ctx),
        value: lowerExpr(call.arguments[0]!, ctx),
        elementType: recvType.element,
        wantIndex: method === "indexOf",
        type: method === "indexOf" ? VT.number : VT.boolean,
      };
    }
    const HOF_METHODS = [
      "map",
      "filter",
      "forEach",
      "reduce",
      "find",
      "findIndex",
      "some",
      "every",
    ];
    if (HOF_METHODS.includes(method)) {
      // reduce(fn, init?) — the optional seed is the 2nd argument.
      const init = method === "reduce" && call.arguments.length >= 2 ? call.arguments[1]! : null;
      return {
        kind: "arrayHof",
        op: method as
          | "map"
          | "filter"
          | "forEach"
          | "reduce"
          | "find"
          | "findIndex"
          | "some"
          | "every",
        array: lowerExpr(pa.expression, ctx),
        callback: lowerExpr(call.arguments[0]!, ctx),
        init: init ? lowerExpr(init, ctx) : null,
        elementType: recvType.element,
        // map/filter → array; forEach → undefined; find → element|undefined; findIndex → number;
        // some/every → boolean; reduce → its result. resolveType(call) covers all value cases.
        type: method === "forEach" ? VT.undefined : resolveType(call, ctx),
      };
    }
    if (method === "sort") {
      const cmp = call.arguments[0];
      return {
        kind: "arraySort",
        array: lowerExpr(pa.expression, ctx),
        comparator: cmp ? lowerExpr(cmp, ctx) : null,
        elementType: recvType.element,
        type: resolveType(call, ctx),
      };
    }
    if (method === "reverse" || method === "slice" || method === "concat") {
      const fn =
        method === "slice"
          ? call.arguments.length >= 2
            ? "cs_array_slice2"
            : "cs_array_slice1"
          : `cs_array_${method}`;
      return {
        kind: "arrayXform",
        fn,
        array: lowerExpr(pa.expression, ctx),
        args: call.arguments.map((a) => lowerExpr(a, ctx)),
        type: resolveType(call, ctx), // same array type
      };
    }
    return ice(`lower: unsupported array method .${method}`);
  }
  if (recvType.kind === "string") {
    return {
      kind: "strMethod",
      method,
      receiver: lowerExpr(pa.expression, ctx),
      args: call.arguments.map((a) => lowerExpr(a, ctx)),
      type: callReturnType(call, ctx) ?? VT.string,
    };
  }
  // Class method: `obj.m(args)` → call `Class.m(obj, args)`. Non-void (value position).
  if (recvType.kind === "object" && recvType.className !== undefined) {
    const rt = callReturnType(call, ctx);
    if (rt === null) ice(`lower: void method .${method} used as a value`);
    return {
      kind: "call",
      name: `${recvType.className}.${method}`,
      args: [lowerExpr(pa.expression, ctx), ...call.arguments.map((a) => lowerExpr(a, ctx))],
      type: rt,
    };
  }
  return ice(`lower: unsupported method .${method} on ${recvType.kind}`);
}

// The return type of a call as a ValueType, or null if void.
function callReturnType(call: ts.CallExpression, ctx: LowerCtx): ValueType | null {
  const t = ctx.checker.getTypeAtLocation(call);
  if (t.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) return null;
  return valueTypeOfTsType(t, call, ctx.checker);
}

function lowerExpr(expr: ts.Expression, ctx: LowerCtx): HExpr {
  const type = resolveType(expr, ctx);
  switch (expr.kind) {
    case ts.SyntaxKind.NumericLiteral:
      return { kind: "numberLit", value: Number((expr as ts.NumericLiteral).text), type };

    case ts.SyntaxKind.StringLiteral:
      return { kind: "stringLit", value: (expr as ts.StringLiteral).text, type };

    case ts.SyntaxKind.TrueKeyword:
      return { kind: "boolLit", value: true, type };

    case ts.SyntaxKind.FalseKeyword:
      return { kind: "boolLit", value: false, type };

    case ts.SyntaxKind.Identifier:
      return lowerIdentifier(expr as ts.Identifier, ctx, type);

    case ts.SyntaxKind.CallExpression:
      return lowerCall(expr as ts.CallExpression, ctx);

    case ts.SyntaxKind.ArrowFunction:
    case ts.SyntaxKind.FunctionExpression:
      return lowerArrow(expr as ts.ArrowFunction | ts.FunctionExpression, ctx);

    case ts.SyntaxKind.ArrayLiteralExpression:
      return {
        kind: "arrayLit",
        elements: (expr as ts.ArrayLiteralExpression).elements.map((e) => lowerExpr(e, ctx)),
        type,
      };

    case ts.SyntaxKind.ObjectLiteralExpression:
      return lowerObjectLit(expr as ts.ObjectLiteralExpression, ctx, type);

    case ts.SyntaxKind.ElementAccessExpression: {
      const ea = expr as ts.ElementAccessExpression;
      const arrType = resolveType(ea.expression, ctx);
      if (arrType.kind !== "array") ice("lower: index access only on arrays yet");
      // `type` here is `element | undefined` (noUncheckedIndexedAccess).
      return {
        kind: "index",
        array: lowerExpr(ea.expression, ctx),
        index: lowerExpr(ea.argumentExpression, ctx),
        elementType: arrType.element,
        type,
      };
    }

    case ts.SyntaxKind.ThisKeyword: {
      if (!ctx.currentThis) ice("lower: `this` outside a method");
      return { kind: "varRef", name: ctx.currentThis.name, type: ctx.currentThis.type };
    }

    case ts.SyntaxKind.NewExpression: {
      const ne = expr as ts.NewExpression;
      if (type.kind !== "object" || type.className === undefined) {
        ice("lower: `new` on a non-class type");
      }
      return {
        kind: "new",
        className: type.className,
        fieldCount: type.shape.fields.length,
        args: (ne.arguments ?? []).map((a) => lowerExpr(a, ctx)),
        type,
      };
    }

    case ts.SyntaxKind.PropertyAccessExpression: {
      const pa = expr as ts.PropertyAccessExpression;
      // `Math.PI` etc. — a numeric constant.
      if (isMathNamespace(pa.expression)) {
        const c = MATH_CONSTS[pa.name.text];
        if (c === undefined) ice(`lower: unsupported Math.${pa.name.text}`);
        return { kind: "numberLit", value: c, type: VT.number };
      }
      const objType = resolveType(pa.expression, ctx);
      if (pa.name.text === "length" && objType.kind === "array") {
        return { kind: "arrayLen", array: lowerExpr(pa.expression, ctx), type };
      }
      if (pa.name.text === "length" && objType.kind === "string") {
        return { kind: "strLen", str: lowerExpr(pa.expression, ctx), type };
      }
      if (objType.kind === "object") {
        const slot = objType.shape.fields.findIndex((f) => f.name === pa.name.text);
        if (slot < 0) ice(`lower: object has no field ${pa.name.text}`);
        return { kind: "memberGet", object: lowerExpr(pa.expression, ctx), slot, type };
      }
      return ice(`lower: unsupported property access .${pa.name.text}`);
    }

    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      // `` `plain text` `` with no interpolation — just a string.
      return { kind: "stringLit", value: (expr as ts.NoSubstitutionTemplateLiteral).text, type };

    case ts.SyntaxKind.TemplateExpression: {
      const t = expr as ts.TemplateExpression;
      const quasis = [t.head.text, ...t.templateSpans.map((s) => s.literal.text)];
      const exprs = t.templateSpans.map((s) => lowerExpr(s.expression, ctx));
      return { kind: "template", quasis, exprs, type };
    }

    case ts.SyntaxKind.ParenthesizedExpression:
      return lowerExpr((expr as ts.ParenthesizedExpression).expression, ctx);

    case ts.SyntaxKind.ConditionalExpression: {
      const c = expr as ts.ConditionalExpression;
      return {
        kind: "conditional",
        cond: lowerExpr(c.condition, ctx),
        whenTrue: lowerExpr(c.whenTrue, ctx),
        whenFalse: lowerExpr(c.whenFalse, ctx),
        type,
      };
    }

    case ts.SyntaxKind.PrefixUnaryExpression: {
      const u = expr as ts.PrefixUnaryExpression;
      return { kind: "unary", op: unaryOp(u.operator), operand: lowerExpr(u.operand, ctx), type };
    }

    case ts.SyntaxKind.BinaryExpression: {
      const b = expr as ts.BinaryExpression;
      const opKind = b.operatorToken.kind;
      // `&&` / `||` are short-circuiting with value semantics — a distinct HIR node, not a
      // plain binary (their result is an operand, not a computed value).
      if (
        opKind === ts.SyntaxKind.AmpersandAmpersandToken ||
        opKind === ts.SyntaxKind.BarBarToken
      ) {
        return {
          kind: "logical",
          op: opKind === ts.SyntaxKind.AmpersandAmpersandToken ? "and" : "or",
          left: lowerExpr(b.left, ctx),
          right: lowerExpr(b.right, ctx),
          type,
        };
      }
      // `a ?? b` — nullish coalescing. `type` is the non-optional result.
      if (opKind === ts.SyntaxKind.QuestionQuestionToken) {
        return {
          kind: "coalesce",
          left: lowerExpr(b.left, ctx),
          right: lowerExpr(b.right, ctx),
          type,
        };
      }
      // `x === undefined` / `x !== undefined` → a sentinel check (the other operand is optional).
      if (
        opKind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        opKind === ts.SyntaxKind.ExclamationEqualsEqualsToken
      ) {
        const lU = isUndefinedLiteral(b.left);
        const rU = isUndefinedLiteral(b.right);
        if (lU || rU) {
          return {
            kind: "nullCheck",
            value: lowerExpr(lU ? b.right : b.left, ctx),
            isEqual: opKind === ts.SyntaxKind.EqualsEqualsEqualsToken,
            type,
          };
        }
      }
      return {
        kind: "binary",
        op: binaryOp(opKind),
        left: lowerExpr(b.left, ctx),
        right: lowerExpr(b.right, ctx),
        type,
      };
    }

    default:
      return ice(`lower: unsupported expression ${ts.SyntaxKind[expr.kind]}`);
  }
}

// The checker is the oracle: map its resolved type to our ValueType. Anything outside the
// currently-supported domain is an ICE (the validator should have rejected it upstream).
function resolveType(expr: ts.Expression, ctx: LowerCtx): ValueType {
  const checker = ctx.checker;
  // `this` has tsc's polymorphic ThisType (a type parameter); use the bound instance type.
  if (expr.kind === ts.SyntaxKind.ThisKeyword && ctx.currentThis) return ctx.currentThis.type;

  // Array literals: prefer the literal's own inferred type (the real element type). An empty
  // `[]` is `never[]` — fall back to the contextual/declared array type. The contextual type is
  // NOT trusted blindly: as a `.concat()` argument it is `ConcatArray<T>` (an interface, not
  // Array), which must not be mistaken for an object.
  if (ts.isArrayLiteralExpression(expr)) {
    const ownElem = arrayElementType(checker.getTypeAtLocation(expr), checker);
    if (ownElem && !(ownElem.flags & ts.TypeFlags.Never)) {
      return VT.array(valueTypeOfTsType(ownElem, expr, checker));
    }
    const ctxT = checker.getContextualType(expr);
    const ctxElem = ctxT ? arrayElementType(ctxT, checker) : undefined;
    if (ctxElem) return VT.array(valueTypeOfTsType(ctxElem, expr, checker));
    return valueTypeOfTsType(checker.getTypeAtLocation(expr), expr, checker);
  }

  // Object literals take their shape from the declared type (the named interface) when present.
  if (ts.isObjectLiteralExpression(expr)) {
    const t = checker.getContextualType(expr) ?? checker.getTypeAtLocation(expr);
    return valueTypeOfTsType(t, expr, checker);
  }
  return valueTypeOf(expr, ctx);
}

// The element type of an Array<T> (null if `t` is not an array type).
function arrayElementType(t: ts.Type, checker: ts.TypeChecker): ts.Type | undefined {
  const ref = t as ts.TypeReference;
  if (ref.symbol?.name === "Array") {
    const args = checker.getTypeArguments(ref);
    if (args.length === 1) return args[0];
  }
  return undefined;
}

function valueTypeOf(node: ts.Node, ctx: LowerCtx): ValueType {
  return valueTypeOfTsType(ctx.checker.getTypeAtLocation(node), node, ctx.checker);
}

function valueTypeOfTsType(t: ts.Type, node: ts.Node, checker: ts.TypeChecker): ValueType {
  const flags = t.flags;
  if (flags & ts.TypeFlags.NumberLike) return VT.number;
  if (flags & ts.TypeFlags.StringLike) return VT.string;
  if (flags & ts.TypeFlags.BooleanLike) return VT.boolean;
  if (flags & ts.TypeFlags.Null) return VT.null;
  if (flags & ts.TypeFlags.Undefined) return VT.undefined;
  if (flags & ts.TypeFlags.Object) {
    const ref = t as ts.TypeReference;
    // A function value: an object type with a call signature.
    const callSigs = checker.getSignaturesOfType(t, ts.SignatureKind.Call);
    if (callSigs.length > 0) {
      const sig = callSigs[0]!;
      const params = sig.parameters.map((p) =>
        valueTypeOfTsType(checker.getTypeOfSymbolAtLocation(p, node), node, checker),
      );
      const retT = checker.getReturnTypeOfSignature(sig);
      const ret =
        retT.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)
          ? null
          : valueTypeOfTsType(retT, node, checker);
      return { kind: "function", params, ret };
    }
    // `T[]` / `Array<T>`: an Array object type with one type argument.
    if (ref.symbol?.name === "Array") {
      const args = checker.getTypeArguments(ref);
      if (args.length === 1) return VT.array(valueTypeOfTsType(args[0]!, node, checker));
    }
    // A closed object shape (interface / type literal / class instance). Its DATA properties
    // become record slots — methods are dispatched to functions, not stored. A class instance's
    // `className` enables method dispatch.
    const classDecl = t.symbol?.valueDeclaration;
    const isClass = classDecl !== undefined && ts.isClassDeclaration(classDecl);
    const props = checker.getPropertiesOfType(t).filter((sym) => !isMethodSymbol(sym));
    if (props.length > 0 || isClass) {
      const fields = props.map((sym) => {
        let ft = valueTypeOfTsType(checker.getTypeOfSymbolAtLocation(sym, node), node, checker);
        // With exactOptionalPropertyTypes, `x?: T` has type T; the `?` is a symbol flag. Model
        // it as optional<T> so an omitted field stores `undefined`.
        if (sym.flags & ts.SymbolFlags.Optional && ft.kind !== "optional") {
          ft = { kind: "optional", inner: ft };
        }
        return { name: sym.name, type: ft };
      });
      const className = isClass ? t.symbol!.name : undefined;
      return className !== undefined
        ? { kind: "object", shape: { fields }, className }
        : { kind: "object", shape: { fields } };
    }
  }
  // Narrowing produces unions (e.g. `switch (n) { case 0: case 1: }` narrows n to `0 | 1`). A
  // union of same-representation members collapses to that type; a union of `inner`+null/undefined
  // becomes `optional`; anything else genuinely mixed is not in the subset yet.
  if (flags & ts.TypeFlags.Union) {
    const members = (t as ts.UnionType).types.map((m) => valueTypeOfTsType(m, node, checker));
    const nullish = members.filter((m) => m.kind === "undefined" || m.kind === "null");
    const rest = members.filter((m) => m.kind !== "undefined" && m.kind !== "null");
    const restFirst = rest[0];
    if (restFirst && rest.every((m) => m.kind === restFirst.kind)) {
      // `inner | undefined | null` → optional<inner>; pure `inner | inner` → inner.
      return nullish.length > 0 ? { kind: "optional", inner: restFirst } : restFirst;
    }
    return ice(
      `lower: mixed-representation union not supported yet at ${ts.SyntaxKind[node.kind]}`,
    );
  }
  return ice(`lower: unsupported value type (flags ${flags}) at ${ts.SyntaxKind[node.kind]}`);
}

// A function's return type as a ValueType, or null for void.
function returnTypeOf(decl: ts.FunctionDeclaration, ctx: LowerCtx): ValueType | null {
  return returnTypeOfSignature(decl, ctx);
}

function returnTypeOfSignature(
  decl: ts.FunctionDeclaration | ts.MethodDeclaration | ts.ConstructorDeclaration,
  ctx: LowerCtx,
): ValueType | null {
  const sig = ctx.checker.getSignatureFromDeclaration(decl);
  if (!sig) return ice("lower: could not resolve signature");
  const ret = ctx.checker.getReturnTypeOfSignature(sig);
  if (ret.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) return null;
  return valueTypeOfTsType(ret, decl, ctx.checker);
}

function isAssignmentOp(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.EqualsToken ||
    kind === ts.SyntaxKind.PlusEqualsToken ||
    kind === ts.SyntaxKind.MinusEqualsToken ||
    kind === ts.SyntaxKind.AsteriskEqualsToken ||
    kind === ts.SyntaxKind.SlashEqualsToken ||
    kind === ts.SyntaxKind.PercentEqualsToken
  );
}

function compoundOp(kind: ts.SyntaxKind): BinaryOp {
  switch (kind) {
    case ts.SyntaxKind.PlusEqualsToken:
      return "add";
    case ts.SyntaxKind.MinusEqualsToken:
      return "sub";
    case ts.SyntaxKind.AsteriskEqualsToken:
      return "mul";
    case ts.SyntaxKind.SlashEqualsToken:
      return "div";
    case ts.SyntaxKind.PercentEqualsToken:
      return "rem";
    default:
      return ice(`lower: unsupported compound assignment ${ts.SyntaxKind[kind]}`);
  }
}

function unaryOp(op: ts.PrefixUnaryOperator): UnaryOp {
  switch (op) {
    case ts.SyntaxKind.MinusToken:
      return "neg";
    case ts.SyntaxKind.PlusToken:
      return "pos";
    case ts.SyntaxKind.ExclamationToken:
      return "not";
    case ts.SyntaxKind.TildeToken:
      return "bnot";
    default:
      return ice(`lower: unsupported unary operator ${ts.SyntaxKind[op]}`);
  }
}

function binaryOp(kind: ts.SyntaxKind): BinaryOp {
  switch (kind) {
    case ts.SyntaxKind.PlusToken:
      return "add";
    case ts.SyntaxKind.MinusToken:
      return "sub";
    case ts.SyntaxKind.AsteriskToken:
      return "mul";
    case ts.SyntaxKind.SlashToken:
      return "div";
    case ts.SyntaxKind.PercentToken:
      return "rem";
    case ts.SyntaxKind.LessThanToken:
      return "lt";
    case ts.SyntaxKind.GreaterThanToken:
      return "gt";
    case ts.SyntaxKind.LessThanEqualsToken:
      return "le";
    case ts.SyntaxKind.GreaterThanEqualsToken:
      return "ge";
    case ts.SyntaxKind.EqualsEqualsEqualsToken:
      return "eq";
    case ts.SyntaxKind.ExclamationEqualsEqualsToken:
      return "ne";
    case ts.SyntaxKind.AmpersandToken:
      return "band";
    case ts.SyntaxKind.BarToken:
      return "bor";
    case ts.SyntaxKind.CaretToken:
      return "bxor";
    case ts.SyntaxKind.LessThanLessThanToken:
      return "shl";
    case ts.SyntaxKind.GreaterThanGreaterThanToken:
      return "shr";
    case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken:
      return "ushr";
    default:
      return ice(`lower: unsupported binary operator ${ts.SyntaxKind[kind]}`);
  }
}

// "console.log" / "process.exit" for a property-access callee; bare name otherwise.
function calleeName(expr: ts.Expression): string {
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    return `${expr.expression.text}.${expr.name.text}`;
  }
  if (ts.isIdentifier(expr)) return expr.text;
  return `<${ts.SyntaxKind[expr.kind]}>`;
}
