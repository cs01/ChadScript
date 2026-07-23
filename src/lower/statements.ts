// Statement lowering: TS statements → HStmt lists (declarations, control flow, assignments,
// throws, call statements). Split out of lower.ts; the expression lowering and helpers it uses are
// imported back (circular, resolved at call time).

import ts from "typescript";
import { ice } from "../diagnostics.js";
import type { HStmt, HExpr, BinaryOp } from "../hir/nodes.js";
import { VT } from "../hir/types.js";
import type { ValueType } from "../hir/types.js";
import {
  type LowerCtx,
  lowerExpr,
  resolveType,
  coerceToTarget,
  callReturnType,
  constructorClassOf,
  superMethodClassOf,
  vtableIndexOf,
  calleeName,
  compoundOp,
  declaredTypeOfIdent,
  isAssignmentOp,
  lowerCallArgs,
  nameOf,
} from "./lower.js";
import { isMathNamespace } from "./declarations.js";
import { valueTypeOf } from "./type-translation.js";
import { lowerMethodCall } from "./method-call.js";

// Returns an array because one `let a = 1, b = 2;` lowers to several varDecls.
export function lowerStatement(stmt: ts.Statement, ctx: LowerCtx): HStmt[] {
  if (ts.isExpressionStatement(stmt)) {
    if (ts.isCallExpression(stmt.expression)) return [lowerCallStatement(stmt.expression, ctx)];
    return [lowerExprStatement(stmt.expression, ctx)];
  }
  if (ts.isVariableStatement(stmt)) {
    return stmt.declarationList.declarations.flatMap((d) => lowerVarDecl(d, ctx));
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
    if (!stmt.expression) return [{ kind: "return", value: null }];
    const value = coerceToTarget(
      lowerExpr(stmt.expression, ctx),
      ctx.currentReturnType ?? VT.undefined,
    );
    return [{ kind: "return", value }];
  }
  if (ts.isThrowStatement(stmt)) {
    return [lowerThrow(stmt.expression, ctx)];
  }
  if (ts.isTryStatement(stmt)) {
    if (!stmt.catchClause && !stmt.finallyBlock) ice("lower: try needs a catch or finally");
    // `catch (e)` binds `e` (type `unknown`) to the caught CsThrown. A destructured binding is not
    // supported.
    const cc = stmt.catchClause;
    let catchParam: string | null = null;
    if (cc?.variableDeclaration) {
      if (!ts.isIdentifier(cc.variableDeclaration.name)) {
        ice("lower: destructured catch binding not supported");
      }
      catchParam = nameOf(cc.variableDeclaration.name as ts.Identifier, ctx);
    }
    return [
      {
        kind: "tryCatch",
        tryBody: lowerStatements(stmt.tryBlock.statements, ctx),
        catchBody: cc ? lowerStatements(cc.block.statements, ctx) : null,
        catchParam,
        finallyBody: stmt.finallyBlock ? lowerStatements(stmt.finallyBlock.statements, ctx) : null,
      },
    ];
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

// `throw expr`. The subset supports `throw new Error(msg)` (isError) and `throw <string>`; a
// re-throw of a caught value (`throw e`) carries it through unchanged. Other thrown types are
// rejected (they'd need general value boxing we don't do).
export function lowerThrow(expr: ts.Expression, ctx: LowerCtx): HStmt {
  // `new Error(msg)` — Error is a builtin; take its first argument as the message.
  if (
    ts.isNewExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === "Error"
  ) {
    const arg = expr.arguments?.[0];
    return { kind: "throwError", isError: true, message: arg ? lowerExpr(arg, ctx) : null };
  }
  const t = ctx.checker.getTypeAtLocation(expr);
  // `throw e` where e is a caught (unknown) value → re-throw it unchanged.
  if (t.flags & ts.TypeFlags.Unknown) {
    return { kind: "rethrowValue", value: lowerExpr(expr, ctx) };
  }
  if (t.flags & ts.TypeFlags.StringLike) {
    return { kind: "throwError", isError: false, message: lowerExpr(expr, ctx) };
  }
  return ice(
    "lower: throw only supports `new Error(msg)`, a string, or re-throwing a caught value",
  );
}

export function lowerStatements(stmts: readonly ts.Statement[], ctx: LowerCtx): HStmt[] {
  return stmts.flatMap((s) => lowerStatement(s, ctx));
}

// The body of a branch is either a block (`{ ... }`) or a single statement (`if (c) x();`).
export function lowerBranchBody(stmt: ts.Statement, ctx: LowerCtx): HStmt[] {
  return ts.isBlock(stmt) ? lowerStatements(stmt.statements, ctx) : lowerStatement(stmt, ctx);
}

export function lowerIf(stmt: ts.IfStatement, ctx: LowerCtx): HStmt {
  return {
    kind: "if",
    cond: lowerExpr(stmt.expression, ctx),
    then: lowerBranchBody(stmt.thenStatement, ctx),
    otherwise: stmt.elseStatement ? lowerBranchBody(stmt.elseStatement, ctx) : null,
  };
}

export function lowerSwitch(stmt: ts.SwitchStatement, ctx: LowerCtx): HStmt {
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

export function lowerForOf(stmt: ts.ForOfStatement, ctx: LowerCtx): HStmt {
  // Lower the iterable FIRST and read its lowered type — `m.keys()` / `s.values()` are typed as
  // iterators by tsc but lower to a materialized array here, so trust the lowered type.
  const array = lowerExpr(stmt.expression, ctx);
  if (array.type.kind !== "array") ice("lower: for...of is only supported over arrays yet");
  // The loop variable is `for (const x of arr)`.
  if (!ts.isVariableDeclarationList(stmt.initializer)) {
    ice("lower: for...of requires a `const`/`let` binding");
  }
  const decl = stmt.initializer.declarations[0]!;
  const elementType = array.type.element;
  // `for (const { x, y } of pts)` — bind each element to a synthetic loop var, then a prelude at the
  // top of the body binds its fields (reuses the object-destructuring binder).
  if (ts.isObjectBindingPattern(decl.name)) {
    const loopName = `__elem.${ctx.counter.n++}`;
    const prelude = bindObjectPattern(
      decl.name,
      { kind: "varRef", name: loopName, type: elementType },
      ctx,
    );
    return {
      kind: "forOf",
      name: loopName,
      elementType,
      array,
      body: [...prelude, ...lowerBranchBody(stmt.statement, ctx)],
    };
  }
  if (!ts.isIdentifier(decl.name)) ice("lower: array-destructured for...of binding not supported");
  return {
    kind: "forOf",
    name: nameOf(decl.name, ctx),
    elementType,
    array,
    body: lowerBranchBody(stmt.statement, ctx),
  };
}

export function lowerFor(stmt: ts.ForStatement, ctx: LowerCtx): HStmt {
  let init: HStmt[] = [];
  if (stmt.initializer) {
    init = ts.isVariableDeclarationList(stmt.initializer)
      ? stmt.initializer.declarations.flatMap((d) => lowerVarDecl(d, ctx))
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
export function lowerExprStatement(expr: ts.Expression, ctx: LowerCtx): HStmt {
  if (ts.isBinaryExpression(expr) && isAssignmentOp(expr.operatorToken.kind)) {
    return lowerAssignment(expr, ctx);
  }
  if (ts.isPostfixUnaryExpression(expr) || ts.isPrefixUnaryExpression(expr)) {
    return lowerIncDec(expr, ctx);
  }
  // A bare `await e;` — the awaited value is discarded but the suspend/throw-on-reject still happens.
  if (ts.isAwaitExpression(expr)) {
    return { kind: "exprStmt", expr: lowerExpr(expr, ctx) };
  }
  return ice(`lower: unsupported expression statement ${ts.SyntaxKind[expr.kind]}`);
}

// `i++` / `i--` / `++i` / `--i` in statement position → `i = i +/- 1`. The pre/post distinction
// only matters for the produced value, which statement position discards.
export function lowerIncDec(
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

export function lowerAssignment(expr: ts.BinaryExpression, ctx: LowerCtx): HStmt {
  const op = expr.operatorToken.kind;
  if (ts.isPropertyAccessExpression(expr.left)) {
    return lowerMemberAssignment(expr.left, op, expr.right, ctx);
  }
  if (!ts.isIdentifier(expr.left)) ice("lower: only `name = ...` / `obj.field = ...` supported");
  const left = expr.left as ts.Identifier;
  const name = nameOf(left, ctx);
  if (op === ts.SyntaxKind.EqualsToken) {
    const value = coerceToTarget(lowerExpr(expr.right, ctx), declaredTypeOfIdent(left, ctx));
    return { kind: "assign", name, value };
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
export function lowerMemberAssignment(
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

export function lowerVarDecl(decl: ts.VariableDeclaration, ctx: LowerCtx): HStmt[] {
  if (!decl.initializer) ice("lower: variable declaration without initializer not supported yet");
  if (ts.isObjectBindingPattern(decl.name))
    return lowerObjectDestructuring(decl.name, decl.initializer, ctx);
  if (!ts.isIdentifier(decl.name)) ice("lower: array destructuring not supported yet");
  // The slot type is the variable's DECLARED type (its annotation, or the widened init type) so
  // an `x: T | null` var stores the optional rep even when initialized with a present value.
  const declaredType = valueTypeOf(decl.name, ctx);
  const init = coerceToTarget(lowerExpr(decl.initializer, ctx), declaredType);
  return [{ kind: "varDecl", name: nameOf(decl.name, ctx), init, type: declaredType }];
}

// `const { a, b: renamed } = obj` → bind the object to a temp (evaluated ONCE) then one varDecl per
// field. The temp keeps the initializer's side effects to a single evaluation.
function lowerObjectDestructuring(
  pattern: ts.ObjectBindingPattern,
  initializer: ts.Expression,
  ctx: LowerCtx,
): HStmt[] {
  const init = lowerExpr(initializer, ctx);
  if (init.type.kind !== "object") ice("lower: object destructuring of a non-object value");
  const tempName = `__destr.${ctx.counter.n++}`;
  const tempRef: HExpr = { kind: "varRef", name: tempName, type: init.type };
  return [
    { kind: "varDecl", name: tempName, init, type: init.type },
    ...bindObjectPattern(pattern, tempRef, ctx),
  ];
}

// Bind each field of an object `source` (an already-lowered, object-typed HExpr that is cheap to
// re-reference — a varRef) to a fresh local per the pattern, via memberGet. Shared by variable and
// parameter destructuring. Nested patterns, defaults (`{a = 1}`), and rest (`{...r}`) are not in the
// subset (validate admits only ObjectBindingPattern + a plain BindingElement).
export function bindObjectPattern(
  pattern: ts.ObjectBindingPattern,
  source: HExpr,
  ctx: LowerCtx,
): HStmt[] {
  if (source.type.kind !== "object") ice("lower: object destructuring of a non-object value");
  const shape = source.type.shape;
  const stmts: HStmt[] = [];
  for (const el of pattern.elements) {
    if (el.dotDotDotToken) ice("lower: rest in object destructuring not supported yet");
    if (el.initializer) ice("lower: default in object destructuring not supported yet");
    if (!ts.isIdentifier(el.name)) ice("lower: nested destructuring not supported yet");
    // `{ a }` → source prop is `a`; `{ a: x }` → propertyName `a`, binds `x`.
    const srcProp =
      el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
    const slot = shape.fields.findIndex((f) => f.name === srcProp);
    if (slot < 0) ice(`lower: destructured object has no field ${srcProp}`);
    const fieldType = shape.fields[slot]!.type;
    stmts.push({
      kind: "varDecl",
      name: nameOf(el.name, ctx),
      init: { kind: "memberGet", object: source, slot, type: fieldType },
      type: fieldType,
    });
  }
  return stmts;
}

// The class that DEFINES a method (walks to its declaring class), so an inherited method
// dispatches to the base class that implements it. Falls back to the static receiver class.
export function methodDefiningClass(name: ts.MemberName, ctx: LowerCtx, fallback: string): string {
  const sym = ctx.checker.getSymbolAtLocation(name);
  const d = sym?.valueDeclaration ?? sym?.declarations?.[0];
  if (d && (ts.isMethodDeclaration(d) || ts.isMethodSignature(d))) {
    const parent = d.parent;
    if (parent && ts.isClassDeclaration(parent) && parent.name) return parent.name.text;
  }
  return fallback;
}

// A `varRef` to the current `this` — the receiver used for `super(...)` / `super.m(...)` calls.
export function thisRef(ctx: LowerCtx): HExpr {
  if (!ctx.currentThis) return ice("lower: `super`/`this` used outside a method");
  return { kind: "varRef", name: ctx.currentThis.name, type: ctx.currentThis.type };
}

export function lowerCallStatement(call: ts.CallExpression, ctx: LowerCtx): HStmt {
  const target = calleeName(call.expression);
  // `super(...)` — delegate to the base constructor with `this` prepended.
  if (call.expression.kind === ts.SyntaxKind.SuperKeyword) {
    if (!ctx.currentBaseClass) return ice("lower: `super()` with no base class");
    // The nearest ancestor that actually emits a constructor — the immediate base may declare
    // neither a constructor nor a field initializer, in which case it has no HFunc to call.
    const ctorClass = constructorClassOf(ctx.currentBaseClass, call, ctx);
    const args = [thisRef(ctx), ...call.arguments.map((a) => lowerExpr(a, ctx))];
    return ctorClass === null
      ? { kind: "exprStmt", expr: thisRef(ctx) } // base is field-less: `super()` is a no-op
      : { kind: "callStmt", name: `${ctorClass}.constructor`, args, returnType: null };
  }

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
        // `super.m(...)` → non-virtual call into the base class with `this` as the receiver.
        if (pa.expression.kind === ts.SyntaxKind.SuperKeyword) {
          if (!ctx.currentBaseClass) return ice("lower: `super` with no base class");
          return {
            kind: "callStmt",
            name: `${superMethodClassOf(ctx.currentBaseClass, pa.name.text, ctx)}.${pa.name.text}`,
            args: [thisRef(ctx), ...call.arguments.map((a) => lowerExpr(a, ctx))],
            returnType: callReturnType(call, ctx),
          };
        }
        const recvType = resolveType(pa.expression, ctx);
        // A class method (possibly void) → callStmt with `this` prepended, so void methods work.
        // Dispatch to the class that DEFINES the method (an inherited method lives on the base).
        if (recvType.kind === "object" && recvType.className !== undefined) {
          // VIRTUAL dispatch (statement position; handles void methods too).
          return {
            kind: "virtualCallStmt",
            receiver: lowerExpr(pa.expression, ctx),
            vtableIndex: vtableIndexOf(recvType.className, pa.name.text, ctx),
            args: call.arguments.map((a) => lowerExpr(a, ctx)),
            returnType: callReturnType(call, ctx),
          };
        }
        return { kind: "exprStmt", expr: lowerMethodCall(call, ctx) };
      }
      // A user-function call in statement position: evaluate for effect, discard the result.
      if (!ts.isIdentifier(call.expression)) {
        return ice(`lower: unsupported call target ${ts.SyntaxKind[call.expression.kind]}`);
      }
      // An async call in statement position must SPAWN a fiber (and discard the promise), not call
      // the body directly — route through lowerExpr so it becomes an asyncCall.
      const fnDecl = ctx.checker.getSymbolAtLocation(call.expression)?.valueDeclaration;
      const isAsync =
        fnDecl !== undefined &&
        ts.isFunctionDeclaration(fnDecl) &&
        (fnDecl.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false);
      if (isAsync) return { kind: "exprStmt", expr: lowerExpr(call, ctx) };
      return {
        kind: "callStmt",
        name: nameOf(call.expression, ctx),
        args: lowerCallArgs(call, ctx),
        returnType: callReturnType(call, ctx),
      };
    }
  }
}
