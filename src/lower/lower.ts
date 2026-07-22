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
import type { HModule, HStmt, HExpr, HFunc, UnaryOp, BinaryOp } from "../hir/nodes.js";
import { VT } from "../hir/types.js";
import type { ValueType } from "../hir/types.js";

interface LowerCtx {
  checker: ts.TypeChecker;
  // Symbol identity → unique HIR name. Shadowing variables have distinct symbols, so distinct
  // names. Keyed by Symbol so a reference resolves to the same name as its declaration.
  names: Map<ts.Symbol, string>;
  counter: { n: number };
}

export function lower(loaded: LoadedProgram): HModule {
  const ctx: LowerCtx = { checker: loaded.checker, names: new Map(), counter: { n: 0 } };
  const functions: HFunc[] = [];
  const topLevel: HStmt[] = [];
  for (const sf of loaded.sourceFiles) {
    for (const stmt of sf.statements) {
      // Type-only declarations have no runtime and are consumed by the checker, not lowered.
      if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) continue;
      if (ts.isFunctionDeclaration(stmt)) {
        functions.push(lowerFunction(stmt, ctx));
      } else {
        topLevel.push(...lowerStatement(stmt, ctx));
      }
    }
  }
  return { functions, topLevel };
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

// A call used as a value: a user function `foo(args)` or a method `obj.method(args)`.
function lowerCall(call: ts.CallExpression, ctx: LowerCtx): HExpr {
  if (ts.isPropertyAccessExpression(call.expression)) {
    return lowerMethodCall(call, ctx);
  }
  if (!ts.isIdentifier(call.expression)) {
    return ice(`lower: unsupported call target ${ts.SyntaxKind[call.expression.kind]}`);
  }
  return {
    kind: "call",
    name: nameOf(call.expression, ctx),
    args: call.arguments.map((a) => lowerExpr(a, ctx)),
    type: valueTypeOf(call, ctx),
  };
}

// Object literal → fields in SHAPE (record-slot) order, regardless of the source property order.
// tsc guarantees every required field is present. Supports `{ x: v }` and shorthand `{ x }`.
function lowerObjectLit(ole: ts.ObjectLiteralExpression, ctx: LowerCtx, type: ValueType): HExpr {
  if (type.kind !== "object") ice("lower: object literal without a resolved object shape");
  const fields = type.shape.fields.map((f): HExpr => {
    const prop = ole.properties.find(
      (p) => p.name && ts.isIdentifier(p.name) && p.name.text === f.name,
    );
    if (!prop) ice(`lower: object literal missing field ${f.name}`);
    if (ts.isPropertyAssignment(prop)) return lowerExpr(prop.initializer, ctx);
    if (ts.isShorthandPropertyAssignment(prop)) {
      // `{ a }` means field `a` = the variable `a`. Resolve the VALUE symbol (the variable),
      // not the property symbol the shorthand identifier reports.
      const valueSym = ctx.checker.getShorthandAssignmentValueSymbol(prop);
      if (!valueSym) return ice(`lower: cannot resolve shorthand property ${f.name}`);
      return { kind: "varRef", name: nameForSymbol(valueSym, f.name, ctx), type: f.type };
    }
    return ice(`lower: unsupported object member for ${f.name}`);
  });
  return { kind: "objectLit", fields, type };
}

// A method call `obj.method(args)`. Dispatched on the receiver's type + method name.
function lowerMethodCall(call: ts.CallExpression, ctx: LowerCtx): HExpr {
  const pa = call.expression as ts.PropertyAccessExpression;
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
    return ice(`lower: unsupported array method .${method}`);
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
      // A bare identifier in expression position is a variable reference (callees like
      // console.log are handled separately in calleeName, never through lowerExpr).
      return { kind: "varRef", name: nameOf(expr as ts.Identifier, ctx), type };

    case ts.SyntaxKind.CallExpression:
      return lowerCall(expr as ts.CallExpression, ctx);

    case ts.SyntaxKind.ArrayLiteralExpression:
      return {
        kind: "arrayLit",
        elements: (expr as ts.ArrayLiteralExpression).elements.map((e) => lowerExpr(e, ctx)),
        type,
      };

    case ts.SyntaxKind.ObjectLiteralExpression:
      return lowerObjectLit(expr as ts.ObjectLiteralExpression, ctx, type);

    case ts.SyntaxKind.PropertyAccessExpression: {
      const pa = expr as ts.PropertyAccessExpression;
      const objType = resolveType(pa.expression, ctx);
      if (pa.name.text === "length" && objType.kind === "array") {
        return { kind: "arrayLen", array: lowerExpr(pa.expression, ctx), type };
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
  // An empty array literal is typed `never[]` on its own; its element type comes from context
  // (the declared/expected type, e.g. `const e: number[] = []`). Object literals likewise take
  // their shape from the declared type (the named interface) when present.
  if (ts.isArrayLiteralExpression(expr) || ts.isObjectLiteralExpression(expr)) {
    const t = ctx.checker.getContextualType(expr) ?? ctx.checker.getTypeAtLocation(expr);
    return valueTypeOfTsType(t, expr, ctx.checker);
  }
  return valueTypeOf(expr, ctx);
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
    // `T[]` / `Array<T>`: an Array object type with one type argument.
    if (ref.symbol?.name === "Array") {
      const args = checker.getTypeArguments(ref);
      if (args.length === 1) return VT.array(valueTypeOfTsType(args[0]!, node, checker));
    }
    // A closed object shape (interface / type literal): its ordered properties become record
    // slots. tsc guarantees the fields; we resolve each field type recursively.
    const props = checker.getPropertiesOfType(t);
    if (props.length > 0) {
      const fields = props.map((sym) => ({
        name: sym.name,
        type: valueTypeOfTsType(checker.getTypeOfSymbolAtLocation(sym, node), node, checker),
      }));
      return { kind: "object", shape: { fields } };
    }
  }
  // Narrowing produces unions (e.g. `switch (n) { case 0: case 1: }` narrows n to `0 | 1`). A
  // union whose members all share one representation collapses to it; a genuinely mixed union
  // (different reps) is not in the subset yet.
  if (flags & ts.TypeFlags.Union) {
    const members = (t as ts.UnionType).types.map((m) => valueTypeOfTsType(m, node, checker));
    const first = members[0]!;
    if (members.every((m) => m.kind === first.kind)) return first;
    return ice(
      `lower: mixed-representation union not supported yet at ${ts.SyntaxKind[node.kind]}`,
    );
  }
  return ice(`lower: unsupported value type (flags ${flags}) at ${ts.SyntaxKind[node.kind]}`);
}

// A function's return type as a ValueType, or null for void.
function returnTypeOf(decl: ts.FunctionDeclaration, ctx: LowerCtx): ValueType | null {
  const sig = ctx.checker.getSignatureFromDeclaration(decl);
  if (!sig) return ice("lower: could not resolve function signature");
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
