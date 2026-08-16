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
import {
  valueTypeOf,
  valueTypeOfTsType,
  arrayElementType,
  returnTypeOf,
  returnTypeOfSignature,
} from "./type-translation.js";
import { lowerMethodCall } from "./method-call.js";
import { lowerInterceptedCall } from "./globals.js";
// Re-exported so the many existing `resolveType` import sites keep resolving through lower.ts.
import { resolveType } from "./resolve-type.js";
export { resolveType };
import { lowerStatement, lowerStatements, thisRef } from "./statements.js";
import {
  buildClassTable,
  lowerClass,
  lowerFunction,
  lowerArrow,
  lowerObjectLit,
  lowerArrayElement,
  keyKindOf,
  isMathNamespace,
  isNumberNamespace,
  MATH_CONSTS,
  NUMBER_CONSTS,
} from "./declarations.js";

export interface LowerCtx {
  checker: ts.TypeChecker;
  // Symbol identity → unique HIR name. Shadowing variables have distinct symbols, so distinct
  // names. Keyed by Symbol so a reference resolves to the same name as its declaration.
  names: Map<ts.Symbol, string>;
  counter: { n: number };
  // The `this` binding while lowering a method/constructor body (null at top level / in free
  // functions). `this` lowers to a varRef of this name + the instance type.
  currentThis: { name: string; type: ValueType } | null;
  // The declared return type of the function whose body is being lowered — used to coerce a
  // returned value into an optional slot. null = void / top level.
  currentReturnType: ValueType | null;
  // The base class name while lowering a subclass's members, for `super(...)` / `super.m(...)`
  // dispatch. null when the class has no `extends` (or outside a class).
  currentBaseClass: string | null;
  // Per-class method table: method names in vtable-slot order (base-first, override keeps slot)
  // → the class implementing each. Built up-front so a call site can look up the vtable index of
  // a method from its static receiver class.
  classTables: Map<string, { order: string[]; impls: Map<string, string> }>;
  // Each class → its ancestor class names INCLUDING itself. `x instanceof C` matches every class
  // whose ancestor set contains C (i.e. C and all its descendants).
  classAncestors: Map<string, Set<string>>;
  // Output list of all functions, incl. lambdas lifted from arrow/function expressions.
  functions: HFunc[];
}

// The `undefined` literal (a global identifier in TS).
function isUndefinedLiteral(e: ts.Expression): boolean {
  return ts.isIdentifier(e) && e.text === "undefined";
}

// A property whose declaration is a method (as opposed to a data field).
export function isMethodSymbol(sym: ts.Symbol): boolean {
  const d = sym.valueDeclaration;
  return d !== undefined && (ts.isMethodDeclaration(d) || ts.isMethodSignature(d));
}

export function lower(loaded: LoadedProgram): HModule {
  const ctx: LowerCtx = {
    checker: loaded.checker,
    names: new Map(),
    counter: { n: 0 },
    currentThis: null,
    currentReturnType: null,
    currentBaseClass: null,
    classTables: new Map(),
    classAncestors: new Map(),
    functions: [],
  };
  // Precompute every class's method table BEFORE lowering, so a call site (which may precede the
  // class in source) can resolve a method's vtable index.
  for (const sf of loaded.sourceFiles) {
    for (const stmt of sf.statements) {
      if (ts.isClassDeclaration(stmt) && stmt.name) buildClassTable(stmt, ctx);
    }
  }
  const topLevel: HStmt[] = [];
  for (const sf of loaded.sourceFiles) {
    for (const stmt of sf.statements) {
      // Type-only declarations have no runtime and are consumed by the checker, not lowered.
      if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) continue;
      // Imports and bare `export { ... }` lists are name resolution only: tsc has already bound
      // every reference to its symbol, and lowering names bindings by symbol, so a cross-file
      // reference needs no more work than a local one. The imported file's own statements are
      // lowered when its turn comes (dependency-ordered by frontend/module-graph.ts).
      if (ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt)) continue;
      if (ts.isFunctionDeclaration(stmt)) {
        ctx.functions.push(lowerFunction(stmt, ctx));
      } else if (ts.isClassDeclaration(stmt)) {
        ctx.functions.push(...lowerClass(stmt, ctx));
      } else {
        topLevel.push(...lowerStatement(stmt, ctx));
      }
    }
  }
  // Class descriptors: the vtable is the implementing fn for each method slot.
  const classes = [...ctx.classTables].map(([name, tbl]) => ({
    name,
    vtable: tbl.order.map((m) => `${tbl.impls.get(m)}.${m}`),
  }));
  return { functions: ctx.functions, topLevel, classes };
}

// A bare identifier in expression position is a variable reference. If the variable's DECLARED
// type is optional but it is being used here at a narrowed (non-optional) type — i.e. inside an
// `if (x !== undefined)` guard — emit an `unwrap` so codegen unboxes the stored optional.
function lowerIdentifier(ident: ts.Identifier, ctx: LowerCtx, useType: ValueType): HExpr {
  const sym = symbolOf(ident, ctx);
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

// An imported name resolves to an ALIAS symbol — a distinct symbol from the declaration it refers
// to. Every decision keyed on a symbol (its HIR name, whether it declares a function, its declared
// type) must therefore see through the alias, or the same binding gets two identities and a
// cross-file reference reads a variable nothing ever wrote.
export function resolveAlias(symbol: ts.Symbol, ctx: LowerCtx): ts.Symbol {
  return symbol.flags & ts.SymbolFlags.Alias ? ctx.checker.getAliasedSymbol(symbol) : symbol;
}

// The symbol an identifier resolves to, with imports followed through to the declaration.
export function symbolOf(node: ts.Node, ctx: LowerCtx): ts.Symbol | undefined {
  const sym = ctx.checker.getSymbolAtLocation(node);
  return sym ? resolveAlias(sym, ctx) : undefined;
}

// The stable HIR name for the variable an identifier resolves to. Falls back to the source
// text keyed by position if the checker cannot produce a symbol (should not happen for the
// admitted subset), so distinct-but-symbolless names never collide.
export function nameOf(ident: ts.Identifier, ctx: LowerCtx): string {
  const symbol = ctx.checker.getSymbolAtLocation(ident);
  if (!symbol) return ice(`lower: no symbol for identifier ${ident.text}`);
  return nameForSymbol(symbol, ident.text, ctx);
}

// The stable unique HIR name for a symbol. Used directly for shorthand object properties, where
// the property identifier's own symbol is the property — not the value variable we must bind to.
export function nameForSymbol(symbol: ts.Symbol, hint: string, ctx: LowerCtx): string {
  const target = resolveAlias(symbol, ctx);
  let name = ctx.names.get(target);
  if (!name) {
    name = `${hint}.${ctx.counter.n++}`;
    ctx.names.set(target, name);
  }
  return name;
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
  const intercepted = lowerInterceptedCall(call, ctx);
  if (intercepted) return intercepted;
  // A call whose callee is NOT a top-level function declaration is a closure call.
  const sym = symbolOf(call.expression, ctx);
  const isTopLevelFn = sym?.valueDeclaration && ts.isFunctionDeclaration(sym.valueDeclaration);
  if (!isTopLevelFn) {
    return {
      kind: "callClosure",
      callee: lowerExpr(call.expression, ctx),
      args: lowerCallArgs(call, ctx),
      type: resolveType(call, ctx),
    };
  }
  // A call to an `async function` spawns a fiber (result is Promise<T>) instead of running it now.
  const fnDecl = sym!.valueDeclaration as ts.FunctionDeclaration;
  const isAsync = fnDecl.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
  if (isAsync) {
    return {
      kind: "asyncCall",
      name: nameOf(call.expression, ctx),
      args: lowerCallArgs(call, ctx),
      type: valueTypeOf(call, ctx), // Promise<T>
    };
  }
  return {
    kind: "call",
    name: nameOf(call.expression, ctx),
    args: lowerCallArgs(call, ctx),
    type: valueTypeOf(call, ctx),
  };
}

// `Object.keys(o)` / `Object.values(o)` over a closed object shape. keys → the field names as a
// string[] (statically known); values → the field values as an array (only when the fields share
// one representation, since a homogeneous array can't hold a mixed union). entries needs tuples.
export function lowerObjectNamespace(method: string, argExpr: ts.Expression, ctx: LowerCtx): HExpr {
  const objType = resolveType(argExpr, ctx);
  if (objType.kind !== "object") ice(`lower: Object.${method} on non-object ${objType.kind}`);
  const fields = objType.shape.fields;
  if (method === "keys") {
    return {
      kind: "arrayLit",
      elements: fields.map((f) => ({
        spread: false,
        value: { kind: "stringLit", value: f.name, type: VT.string } as HExpr,
      })),
      type: VT.array(VT.string),
    };
  }
  if (method === "values") {
    const first = fields[0]?.type;
    if (first && !fields.every((f) => f.type.kind === first.kind)) {
      ice("lower: Object.values on a mixed-type object is not supported (homogeneous only)");
    }
    const obj = lowerExpr(argExpr, ctx);
    return {
      kind: "arrayLit",
      elements: fields.map((f, i) => ({
        spread: false,
        value: { kind: "memberGet", object: obj, slot: i, type: f.type } as HExpr,
      })),
      type: VT.array(first ?? VT.number),
    };
  }
  return ice(`lower: Object.${method} not supported yet`);
}

// The class whose `Class.constructor` HFunc a `new`/`super()` must actually call. A class that
// declares neither a constructor nor a field initializer emits no constructor at all, so naming
// the immediate base blindly produces a call to a function that was never emitted.
export function constructorClassOf(className: string, node: ts.Node, ctx: LowerCtx): string | null {
  const sym = ctx.checker.resolveName(className, node, ts.SymbolFlags.Class, false);
  let t = sym ? ctx.checker.getDeclaredTypeOfSymbol(sym) : undefined;
  while (t) {
    const d = t.symbol?.valueDeclaration;
    if (d && ts.isClassDeclaration(d)) {
      // A class runs its own constructor if it declares one, OR if it has field initializers (which
      // are lowered into a synthesized constructor — see lowerClass).
      const hasCtorWork = d.members.some(
        (m) =>
          (ts.isConstructorDeclaration(m) && m.body) ||
          (ts.isPropertyDeclaration(m) && m.initializer !== undefined),
      );
      if (hasCtorWork) return d.name!.text;
      const bases = ctx.checker.getBaseTypes(t as ts.InterfaceType);
      t = bases.find((b) => {
        const bd = b.symbol?.valueDeclaration;
        return bd && ts.isClassDeclaration(bd);
      });
    } else break;
  }
  return null;
}

// The class that implements `method` for a `super.method(...)` call from a subclass of `baseClass`
// — i.e. the non-virtual target. `baseClass` may not declare the method itself (it can be inherited
// from further up), and only the declaring class emits an HFunc for it.
export function superMethodClassOf(baseClass: string, method: string, ctx: LowerCtx): string {
  const impl = ctx.classTables.get(baseClass)?.impls.get(method);
  if (impl === undefined) ice(`lower: super.${method}() has no implementation on ${baseClass}`);
  return impl;
}

// The vtable slot index of `method` on class `className` (from the class's method table).
export function vtableIndexOf(className: string, method: string, ctx: LowerCtx): number {
  const table = ctx.classTables.get(className);
  const idx = table ? table.order.indexOf(method) : -1;
  if (idx < 0) ice(`lower: no vtable slot for ${className}.${method}`);
  return idx;
}

// The return type of a call as a ValueType, or null if void.
export function callReturnType(call: ts.CallExpression, ctx: LowerCtx): ValueType | null {
  const t = ctx.checker.getTypeAtLocation(call);
  if (t.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) return null;
  return valueTypeOfTsType(t, call, ctx.checker);
}

// Coerce a lowered value into a target optional slot: a bare `null`/`undefined` becomes the
// matching sentinel; an already-optional value passes through; any other value is boxed (`wrap`).
// A non-optional target is a no-op. This is applied EXPLICITLY at the boundaries that feed a
// real optional slot (return / optional var decl / assignment / user-function argument) — never
// blanket-applied, because many builtin params are `T | undefined` yet take raw values.
export function coerceToTarget(h: HExpr, target: ValueType): HExpr {
  if (target.kind !== "optional" || h.type.kind === "optional") return h;
  if (h.type.kind === "null") return { kind: "nullOpt", type: target };
  if (h.type.kind === "undefined") return { kind: "undefinedOpt", type: target };
  return { kind: "wrap", value: h, type: target };
}

// The DECLARED type of the variable an identifier resolves to (its slot type, not the narrowed
// use-type) — for coercing an assignment's RHS into an optional slot.
export function declaredTypeOfIdent(ident: ts.Identifier, ctx: LowerCtx): ValueType {
  const sym = symbolOf(ident, ctx);
  if (sym?.valueDeclaration) {
    return valueTypeOfTsType(
      ctx.checker.getTypeOfSymbolAtLocation(sym, sym.valueDeclaration),
      ident,
      ctx.checker,
    );
  }
  return valueTypeOf(ident, ctx);
}

// Lower a user call's arguments, coercing each into its parameter's (possibly optional) type.
// Only user functions/closures reach here — builtin methods/globals have their own lowering — so
// resolving the signature's parameter types is safe.
export function lowerCallArgs(call: ts.CallExpression, ctx: LowerCtx): HExpr[] {
  const sig = ctx.checker.getResolvedSignature(call);
  const params = sig?.parameters ?? [];
  const last = params[params.length - 1];
  const restDecl = last?.valueDeclaration;
  const isRest = restDecl !== undefined && ts.isParameter(restDecl) && restDecl.dotDotDotToken;

  const coerceArg = (a: ts.Expression, paramSym: ts.Symbol | undefined): HExpr => {
    const h = lowerExpr(a, ctx);
    if (!paramSym) return h;
    return coerceToTarget(
      h,
      valueTypeOfTsType(ctx.checker.getTypeOfSymbolAtLocation(paramSym, a), a, ctx.checker),
    );
  };

  if (!isRest) {
    return call.arguments.map((a, i) => coerceArg(a, params[i]));
  }
  // Rest parameter: fixed args pass through; trailing args (with `...spread` support) are packed
  // into the rest array, so a rest function is a normal fixed-arity call taking one array param.
  const fixedCount = params.length - 1;
  const fixed = call.arguments.slice(0, fixedCount).map((a, i) => coerceArg(a, params[i]));
  const restType = valueTypeOfTsType(
    ctx.checker.getTypeOfSymbolAtLocation(last!, call),
    call,
    ctx.checker,
  );
  const restArray: HExpr = {
    kind: "arrayLit",
    elements: call.arguments.slice(fixedCount).map((a) => lowerArrayElement(a, ctx)),
    type: restType,
  };
  return [...fixed, restArray];
}

export function lowerExpr(expr: ts.Expression, ctx: LowerCtx): HExpr {
  // Calls compute their own result type (and some, like `map.keys()`, have a tsc type — an
  // iterator — that is outside the subset), so lower them before resolving the tsc type eagerly.
  if (ts.isCallExpression(expr)) return lowerCall(expr, ctx);
  if (ts.isAwaitExpression(expr)) {
    // `await p` → suspend until p settles, yield its inner value. resolveType unwraps the promise.
    // `await` of a Promise<void> yields void, which has no storage representation — represent it as
    // undefined (the value is discarded anyway), like a void call result.
    const awaited = ctx.checker.getTypeAtLocation(expr);
    const type =
      awaited.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)
        ? VT.undefined
        : resolveType(expr, ctx);
    return { kind: "await", value: lowerExpr(expr.expression, ctx), type };
  }
  const type = resolveType(expr, ctx);
  switch (expr.kind) {
    case ts.SyntaxKind.NullKeyword:
      return { kind: "nullLit", type: VT.null };

    case ts.SyntaxKind.NumericLiteral:
      return { kind: "numberLit", value: Number((expr as ts.NumericLiteral).text), type };

    case ts.SyntaxKind.StringLiteral:
      return { kind: "stringLit", value: (expr as ts.StringLiteral).text, type };

    case ts.SyntaxKind.TrueKeyword:
      return { kind: "boolLit", value: true, type };

    case ts.SyntaxKind.FalseKeyword:
      return { kind: "boolLit", value: false, type };

    case ts.SyntaxKind.Identifier: {
      if (isUndefinedLiteral(expr)) return { kind: "undefinedLit", type: VT.undefined };
      // NaN / Infinity are global number identifiers, not user variables.
      const idText = (expr as ts.Identifier).text;
      if (idText === "NaN") return { kind: "numberLit", value: NaN, type: VT.number };
      if (idText === "Infinity") return { kind: "numberLit", value: Infinity, type: VT.number };
      return lowerIdentifier(expr as ts.Identifier, ctx, type);
    }

    case ts.SyntaxKind.CallExpression:
      return lowerCall(expr as ts.CallExpression, ctx);

    case ts.SyntaxKind.ArrowFunction:
    case ts.SyntaxKind.FunctionExpression:
      return lowerArrow(expr as ts.ArrowFunction | ts.FunctionExpression, ctx);

    case ts.SyntaxKind.ArrayLiteralExpression:
      return {
        kind: "arrayLit",
        elements: (expr as ts.ArrayLiteralExpression).elements.map((e) =>
          lowerArrayElement(e, ctx),
        ),
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
      if (type.kind === "map") {
        if (ne.arguments && ne.arguments.length > 0) {
          ice("lower: `new Map(entries)` not supported yet — build an empty Map and .set()");
        }
        return { kind: "mapNew", type };
      }
      if (type.kind === "set") {
        const arg = ne.arguments?.[0];
        if (arg) {
          return {
            kind: "setFromArray",
            array: lowerExpr(arg, ctx),
            keyKind: keyKindOf(type.element),
            type,
          };
        }
        return { kind: "setNew", type };
      }
      if (type.kind !== "object" || type.className === undefined) {
        ice("lower: `new` on a non-class type");
      }
      return {
        kind: "new",
        className: type.className,
        ctorClass: constructorClassOf(type.className, ne, ctx),
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
      // `process.pid` — read from the OS, not a constant: the compiled binary and the oracle are
      // different processes, which is the entire point of having it (collision-free paths).
      if (
        ts.isIdentifier(pa.expression) &&
        pa.expression.text === "process" &&
        pa.name.text === "pid"
      ) {
        return { kind: "runtimeCall", fn: "cs_process_pid", args: [], type: VT.number };
      }
      // `Number.MAX_SAFE_INTEGER` etc. — a numeric constant (use `in`, since NaN's value is NaN).
      if (isNumberNamespace(pa.expression)) {
        if (!(pa.name.text in NUMBER_CONSTS)) ice(`lower: unsupported Number.${pa.name.text}`);
        return { kind: "numberLit", value: NUMBER_CONSTS[pa.name.text]!, type: VT.number };
      }
      const objType = resolveType(pa.expression, ctx);
      if (pa.name.text === "length" && objType.kind === "array") {
        return { kind: "arrayLen", array: lowerExpr(pa.expression, ctx), type };
      }
      if (pa.name.text === "length" && objType.kind === "string") {
        return { kind: "strLen", str: lowerExpr(pa.expression, ctx), type };
      }
      if (pa.name.text === "size" && objType.kind === "map") {
        return { kind: "mapSize", map: lowerExpr(pa.expression, ctx), type };
      }
      if (pa.name.text === "size" && objType.kind === "set") {
        return { kind: "setSize", set: lowerExpr(pa.expression, ctx), type };
      }
      if (objType.kind === "object") {
        const slot = objType.shape.fields.findIndex((f) => f.name === pa.name.text);
        if (slot < 0) ice(`lower: object has no field ${pa.name.text}`);
        // The slot is read at the FIELD's declared representation, which is what is actually
        // stored there. tsc may have narrowed the use to the inner type (`if (n.next !== null)`),
        // but the slot still holds a box or a sentinel — so narrowing becomes an explicit unwrap,
        // exactly as lowerIdentifier does for a narrowed variable. Reading the box as the value
        // itself yields garbage (a box pointer printed as a float).
        const fieldType = objType.shape.fields[slot]!.type;
        const get: HExpr = {
          kind: "memberGet",
          object: lowerExpr(pa.expression, ctx),
          slot,
          type: fieldType,
        };
        if (fieldType.kind === "optional" && type.kind !== "optional") {
          return { kind: "unwrap", value: get, type };
        }
        return get;
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
      // `x instanceof C` → the receiver's vtable equals C's or any subclass's vtable.
      if (opKind === ts.SyntaxKind.InstanceOfKeyword) {
        if (!ts.isIdentifier(b.right)) ice("lower: instanceof right side must be a class name");
        const target = b.right.text;
        const left = lowerExpr(b.left, ctx);
        // `e instanceof Error` for a caught (unknown) value → the CsThrown's isError tag. (Error is
        // a builtin, not a user class, so it isn't in the vtable hierarchy.)
        if (target === "Error" && left.type.kind === "unknown") {
          return { kind: "thrownIsError", value: left, type };
        }
        const matches = [...ctx.classAncestors]
          .filter(([, anc]) => anc.has(target))
          .map(([name]) => name);
        if (matches.length === 0) ice(`lower: instanceof unknown class ${target}`);
        return { kind: "instanceofCheck", value: left, vtableClasses: matches, type };
      }
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
      // `a ?? b` — nullish coalescing. `type` is the non-optional result. tsc may have already
      // narrowed the left: if it is definitely nullish → `b`; definitely present → `a`; only a
      // still-optional left needs the runtime sentinel check.
      if (opKind === ts.SyntaxKind.QuestionQuestionToken) {
        const left = lowerExpr(b.left, ctx);
        if (left.type.kind === "null" || left.type.kind === "undefined") {
          return lowerExpr(b.right, ctx);
        }
        if (left.type.kind !== "optional") return left;
        return { kind: "coalesce", left, right: lowerExpr(b.right, ctx), type };
      }
      // `x === undefined`/`x === null` (and `!==`) → a sentinel check against the optional value.
      if (
        opKind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        opKind === ts.SyntaxKind.ExclamationEqualsEqualsToken
      ) {
        const lU = isUndefinedLiteral(b.left);
        const rU = isUndefinedLiteral(b.right);
        const lN = b.left.kind === ts.SyntaxKind.NullKeyword;
        const rN = b.right.kind === ts.SyntaxKind.NullKeyword;
        if (lU || rU || lN || rN) {
          const valueSide = lU || lN ? b.right : b.left;
          return {
            kind: "nullCheck",
            value: lowerExpr(valueSide, ctx),
            isEqual: opKind === ts.SyntaxKind.EqualsEqualsEqualsToken,
            sentinel: lN || rN ? "null" : "undefined",
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

// The element type of an Array<T> (null if `t` is not an array type).
export function isAssignmentOp(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.EqualsToken ||
    kind === ts.SyntaxKind.PlusEqualsToken ||
    kind === ts.SyntaxKind.MinusEqualsToken ||
    kind === ts.SyntaxKind.AsteriskEqualsToken ||
    kind === ts.SyntaxKind.SlashEqualsToken ||
    kind === ts.SyntaxKind.PercentEqualsToken
  );
}

export function compoundOp(kind: ts.SyntaxKind): BinaryOp {
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
export function calleeName(expr: ts.Expression): string {
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    return `${expr.expression.text}.${expr.name.text}`;
  }
  if (ts.isIdentifier(expr)) return expr.text;
  return `<${ts.SyntaxKind[expr.kind]}>`;
}
