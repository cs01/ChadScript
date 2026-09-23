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
import type { HModule, HStmt, HExpr, HFunc, HCapture } from "../hir/nodes.js";
import { VT } from "../hir/types.js";
import { binaryOp, unaryOp, isAssignmentOp, compoundOp } from "./operators.js";
import {
  coerceToTarget,
  coerceElement,
  typeofTest,
  isNullishType,
  valueCoalesce,
  bothOptional,
  optionalRead,
  nullishLit,
} from "./value-lower.js";
import { type FieldWrite, applyFieldWrites } from "./field-writes.js";
// Re-exported: statements.ts and friends import these through lower.ts.
export { isAssignmentOp, compoundOp, coerceToTarget };
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
import { calleeIdentifier, namespaceMemberOf } from "./module-refs.js";
import { lowerDefaultExport } from "./default-export.js";
import { classIdOf, constructorClassOf } from "./class-ids.js";
// Re-exported so the many existing `resolveType` import sites keep resolving through lower.ts.
import { resolveType } from "./resolve-type.js";
export { resolveType };
import { lowerStatement, lowerStatements, lowerUpdateValue, thisRef } from "./statements.js";
import { ShapeRegistry } from "./shapes.js";
import { fieldAccessAt } from "./member-access.js";
import { type LayoutAnalysis, layoutsOf } from "./layouts.js";
import { lowerObjectLit, resolveSpreads } from "./object-literal.js";
import { findCellSymbols } from "./cells.js";
import { genericSignatureOf } from "./generics.js";
import { lowerGenericArgs, lowerCallValue } from "./generic-calls.js";
import {
  buildClassTable,
  registerClassShape,
  lowerClass,
  lowerFunction,
  lowerArrow,
  lowerArrayElement,
  lowerFunctionRef,
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
  // Class id → its declaration, for questions asked about a class by id (its constructor chain).
  classDecls: Map<string, ts.ClassDeclaration>;
  // Output list of all functions, incl. lambdas lifted from arrow/function expressions.
  functions: HFunc[];
  // Every allocation layout (runtime shape) in the program.
  shapes: ShapeRegistry;
  // The whole-program layout analysis (which layouts reach which static types), the shape each
  // layout was lowered to, and the spread literals whose cases are attached at the end.
  layouts: LayoutAnalysis;
  layoutShapes: Map<number, Set<number>>;
  pendingSpreads: Map<ts.ObjectLiteralExpression, Extract<HExpr, { kind: "objectSpread" }>[]>;
  // Every `o.f = v` write, applied to the reaching shapes' field types at the end (field-writes.ts).
  fieldWrites: FieldWrite[];
  // Local bindings that live in heap cells (captured by a closure AND reassigned; lower/cells.ts).
  cells: Set<ts.Symbol>;
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
    classDecls: new Map(),
    functions: [],
    shapes: new ShapeRegistry(),
    layouts: layoutsOf(loaded),
    layoutShapes: new Map(),
    pendingSpreads: new Map(),
    fieldWrites: [],
    cells: findCellSymbols(loaded.sourceFiles, loaded.checker),
  };
  // Precompute every class's method table and shape BEFORE lowering, so a call site (which may
  // precede the class in source) can resolve a method's vtable index and a `new` its shape.
  const classDecls: ts.ClassDeclaration[] = [];
  for (const sf of loaded.initOrder) {
    for (const stmt of sf.statements) {
      if (ts.isClassDeclaration(stmt) && stmt.name) {
        buildClassTable(stmt, ctx);
        classDecls.push(stmt);
      }
    }
  }
  for (const decl of classDecls) registerClassShape(decl, ctx);
  const topLevel: HStmt[] = [];
  for (const sf of loaded.initOrder) {
    for (const stmt of sf.statements) {
      // Type-only declarations have no runtime and are consumed by the checker, not lowered.
      if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) continue;
      if (ts.isExportAssignment(stmt)) {
        topLevel.push(...lowerDefaultExport(stmt, ctx));
        continue;
      }
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
  applyFieldWrites(ctx);
  resolveSpreads(ctx);
  applyFieldWrites(ctx);
  return { functions: ctx.functions, topLevel, shapes: ctx.shapes.shapes };
}

// A bare identifier in expression position is a variable reference. If the variable's DECLARED
// type is optional but it is being used here at a narrowed (non-optional) type — i.e. inside an
// `if (x !== undefined)` guard — emit an `unwrap` so codegen unboxes the stored optional.
function lowerIdentifier(ident: ts.Identifier, ctx: LowerCtx, useType: ValueType): HExpr {
  const sym = symbolOf(ident, ctx);
  // A `function` declaration referenced as a VALUE. Function declarations are not variables — they
  // have no storage slot to load — so this synthesizes a wrapper taking the hidden `env` pointer a
  // closure value is called through, and returns an ordinary closure over it. Everything
  // downstream (callClosure, array HOFs, setTimeout) then treats it like any other closure.
  const fnDecl = sym?.valueDeclaration;
  if (fnDecl && ts.isFunctionDeclaration(fnDecl) && useType.kind === "function") {
    return lowerFunctionRef(ident, fnDecl, useType, ctx);
  }
  if (sym?.valueDeclaration && useType.kind !== "optional") {
    const declared = valueTypeOfTsType(
      ctx.checker.getTypeOfSymbolAtLocation(sym, sym.valueDeclaration),
      ident,
      ctx.checker,
    );
    // A Value-union variable read where tsc narrowed it to one representation (`typeof x ===
    // "number" ? x + 1 : 0`): the slot holds a Value word, the site wants the concrete type.
    // Narrowed to exactly `null`/`undefined`, there is no machine value to unbox to; tsc proved the
    // value, and reading a variable has no effect, so the read IS that literal, which every
    // consumer (printing, a flow into an optional or a union) already handles.
    if (declared.kind === "value" && useType.kind !== "value") {
      if (isNullishType(useType)) return nullishLit(useType);
      const read: HExpr = {
        kind: "varRef",
        name: nameForSymbol(sym, ident.text, ctx),
        type: declared,
      };
      return { kind: "unbox", value: read, type: useType };
    }
    if (declared.kind === "optional") {
      return {
        kind: "unwrap",
        value: { kind: "varRef", name: nameForSymbol(sym, ident.text, ctx), type: declared },
        type: useType,
      };
    }
  }
  if (sym?.valueDeclaration && useType.kind === "optional") {
    const declared = valueTypeOfTsType(
      ctx.checker.getTypeOfSymbolAtLocation(sym, sym.valueDeclaration),
      ident,
      ctx.checker,
    );
    if (declared.kind === "value") {
      return {
        kind: "unbox",
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
  // `f(...)`, or `m.f(...)` through a module namespace, which is the same static call.
  const callee = calleeIdentifier(call, ctx.checker);
  if (!callee) {
    if (ts.isPropertyAccessExpression(call.expression)) return lowerMethodCall(call, ctx);
    // Any other callee (`make()()`, `(cond ? f : g)(x)`) is a function value.
    return lowerCallValue(call, resolveType(call, ctx), ctx, (type) => ({
      kind: "callClosure",
      callee: lowerExpr(call.expression, ctx),
      args: lowerCallArgs(call, ctx),
      type,
    }));
  }
  const intercepted = lowerInterceptedCall(call, ctx);
  if (intercepted) return intercepted;
  // A call whose callee is NOT a top-level function declaration is a closure call.
  const sym = symbolOf(callee, ctx);
  const isTopLevelFn = sym?.valueDeclaration && ts.isFunctionDeclaration(sym.valueDeclaration);
  if (!isTopLevelFn) {
    return lowerCallValue(call, resolveType(call, ctx), ctx, (type) => ({
      kind: "callClosure",
      callee: lowerExpr(call.expression, ctx),
      args: lowerCallArgs(call, ctx),
      type,
    }));
  }
  // A call to an `async function` spawns a fiber (result is Promise<T>) instead of running it now.
  const fnDecl = sym!.valueDeclaration as ts.FunctionDeclaration;
  const isAsync = fnDecl.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
  if (isAsync) {
    return {
      kind: "asyncCall",
      name: nameOf(callee, ctx),
      args: lowerCallArgs(call, ctx),
      type: valueTypeOf(call, ctx), // Promise<T>
    };
  }
  return lowerCallValue(call, valueTypeOf(call, ctx), ctx, (type) => ({
    kind: "call",
    name: nameOf(callee, ctx),
    args: lowerCallArgs(call, ctx),
    type,
  }));
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
  // A generic callee returns its erased type; value positions convert it (lowerCallValue).
  const generic = genericSignatureOf(call, ctx.checker);
  if (generic) return generic.erasedRet;
  const t = ctx.checker.getTypeAtLocation(call);
  if (t.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) return null;
  return valueTypeOfTsType(t, call, ctx.checker);
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
export function lowerCallArgs(call: ts.CallExpression | ts.NewExpression, ctx: LowerCtx): HExpr[] {
  const generic = genericSignatureOf(call, ctx.checker);
  if (generic) return lowerGenericArgs(call, generic, ctx);
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

  const args = call.arguments ?? [];
  if (!isRest) {
    return args.map((a, i) => coerceArg(a, params[i]));
  }
  // Rest parameter: fixed args pass through; trailing args (with `...spread` support) are packed
  // into the rest array, so a rest function is a normal fixed-arity call taking one array param.
  const fixedCount = params.length - 1;
  const fixed = args.slice(0, fixedCount).map((a, i) => coerceArg(a, params[i]));
  const restType = valueTypeOfTsType(
    ctx.checker.getTypeOfSymbolAtLocation(last!, call),
    call,
    ctx.checker,
  );
  const restArray: HExpr = {
    kind: "arrayLit",
    elements: args.slice(fixedCount).map((a) => coerceElement(lowerArrayElement(a, ctx), restType)),
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
          coerceElement(lowerArrayElement(e, ctx), type),
        ),
        type,
      };

    case ts.SyntaxKind.ObjectLiteralExpression:
      return lowerObjectLit(expr as ts.ObjectLiteralExpression, ctx, type);

    case ts.SyntaxKind.ElementAccessExpression: {
      const ea = expr as ts.ElementAccessExpression;
      const arrType = resolveType(ea.expression, ctx);
      if (arrType.kind !== "array") ice("lower: index access only on arrays yet");
      // `type` here is `element | undefined` (noUncheckedIndexedAccess). A Value or optional element
      // is read as a word (undefined when out of range) and unboxed if tsc narrowed the access
      // (`if (typeof xs[0] === "string") xs[0].length`); see optionalRead.
      const read: HExpr = {
        kind: "index",
        array: lowerExpr(ea.expression, ctx),
        index: lowerExpr(ea.argumentExpression, ctx),
        elementType: arrType.element,
        type,
      };
      return optionalRead(read, arrType.element, type);
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
        shape: ctx.shapes.classShape(type.className),
        ctorClass: constructorClassOf(type.className, ctx),
        args: lowerCallArgs(ne, ctx),
        type,
      };
    }

    case ts.SyntaxKind.PropertyAccessExpression: {
      const pa = expr as ts.PropertyAccessExpression;
      // `m.x` through a module namespace is a static reference to the exported `x`.
      const member = namespaceMemberOf(pa, ctx.checker);
      if (member) return lowerIdentifier(member, ctx, type);
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
      // `x?.f` on a nullable object (validate admits only a chain of one link).
      if (pa.questionDotToken && objType.kind === "optional" && objType.inner.kind === "object") {
        if (type.kind !== "optional") ice("lower: `?.` read without an optional result type");
        return {
          kind: "optionalMember",
          object: lowerExpr(pa.expression, ctx),
          access: fieldAccessAt(pa.expression, pa.name.text, ctx),
          type,
        };
      }
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
        // A field slot holds a self-describing Value, so a read unboxes straight to the type the
        // site uses: an optional field narrowed by tsc (`if (n.next !== null) n.next.v`) reads as
        // its inner type with no optional box in between.
        const fieldType = objType.shape.fields[slot]!.type;
        const narrowed =
          (fieldType.kind === "optional" && type.kind !== "optional") || fieldType.kind === "value";
        // tsc narrows only reference chains (no calls), so the read has no effect to keep.
        if (fieldType.kind === "value" && isNullishType(type)) return nullishLit(type);
        return {
          kind: "memberGet",
          object: lowerExpr(pa.expression, ctx),
          access: fieldAccessAt(pa.expression, pa.name.text, ctx),
          type: narrowed && type.kind !== "undefined" && type.kind !== "null" ? type : fieldType,
        };
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

    // Admitted only where both sides are one Value word (validate/rules.ts), so the assertion has
    // no run-time effect, exactly as in JS: an erased `T | undefined` read passes through as is.
    case ts.SyntaxKind.NonNullExpression:
      return lowerExpr((expr as ts.NonNullExpression).expression, ctx);

    case ts.SyntaxKind.TypeOfExpression:
      return {
        kind: "typeOf",
        value: lowerExpr((expr as ts.TypeOfExpression).expression, ctx),
        type: VT.string,
      };

    case ts.SyntaxKind.ConditionalExpression: {
      const c = expr as ts.ConditionalExpression;
      const cond = lowerExpr(c.condition, ctx);
      const whenTrue = lowerExpr(c.whenTrue, ctx);
      const whenFalse = lowerExpr(c.whenFalse, ctx);
      // Arms of different representations meet in the result's: a Value union (`flag ? "str" : 42`)
      // or an optional (`flag ? "str" : undefined`, where a bare `undefined` arm has no machine
      // value of its own).
      const arm = (h: HExpr): HExpr =>
        type.kind === "value" || type.kind === "optional" ? coerceToTarget(h, type) : h;
      return {
        kind: "conditional",
        cond,
        whenTrue: arm(whenTrue),
        whenFalse: arm(whenFalse),
        type,
      };
    }

    case ts.SyntaxKind.PostfixUnaryExpression:
      return lowerUpdateValue(expr as ts.PostfixUnaryExpression, ctx);

    case ts.SyntaxKind.PrefixUnaryExpression: {
      const u = expr as ts.PrefixUnaryExpression;
      if (
        u.operator === ts.SyntaxKind.PlusPlusToken ||
        u.operator === ts.SyntaxKind.MinusMinusToken
      ) {
        return lowerUpdateValue(u, ctx);
      }
      return { kind: "unary", op: unaryOp(u.operator), operand: lowerExpr(u.operand, ctx), type };
    }

    case ts.SyntaxKind.BinaryExpression: {
      const b = expr as ts.BinaryExpression;
      const opKind = b.operatorToken.kind;
      // `x instanceof C` → the receiver's vtable equals C's or any subclass's vtable.
      if (opKind === ts.SyntaxKind.InstanceOfKeyword) {
        // The class is named directly or through a module namespace (`x instanceof m.C`).
        const classRef = ts.isIdentifier(b.right)
          ? b.right
          : (namespaceMemberOf(b.right, ctx.checker) ??
            ice("lower: instanceof right side must be a class name"));
        const left = lowerExpr(b.left, ctx);
        // `e instanceof Error` for a caught (unknown) value → the CsThrown's isError tag. (Error is
        // a builtin, not a user class, so it isn't in the vtable hierarchy.)
        if (classRef.text === "Error" && left.type.kind === "unknown") {
          return { kind: "thrownIsError", value: left, type };
        }
        const classDecl = symbolOf(classRef, ctx)?.valueDeclaration;
        if (!classDecl || !ts.isClassDeclaration(classDecl)) {
          return ice(`lower: instanceof ${classRef.text} is not a class`);
        }
        const target = classIdOf(classDecl);
        const matches = [...ctx.classAncestors]
          .filter(([, anc]) => anc.has(target))
          .map(([name]) => name);
        if (matches.length === 0) ice(`lower: instanceof unknown class ${target}`);
        const shapes = matches.map((c) => ctx.shapes.classShape(c));
        return { kind: "instanceofCheck", value: left, shapes, type };
      }
      // `&&` / `||` are short-circuiting with value semantics — a distinct HIR node, not a
      // plain binary (their result is an operand, not a computed value).
      if (
        opKind === ts.SyntaxKind.AmpersandAmpersandToken ||
        opKind === ts.SyntaxKind.BarBarToken
      ) {
        const left = lowerExpr(b.left, ctx);
        const right = lowerExpr(b.right, ctx);
        // The result is one of the operands, so operands of different representations meet in a
        // Value union; the truth test then runs on the boxed left word, which has the same answer.
        const operand = (h: HExpr): HExpr => (type.kind === "value" ? coerceToTarget(h, type) : h);
        return {
          kind: "logical",
          op: opKind === ts.SyntaxKind.AmpersandAmpersandToken ? "and" : "or",
          left: operand(left),
          right: operand(right),
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
        if (
          left.type.kind === "value" ||
          (left.type.kind === "optional" && type.kind === "value")
        ) {
          return valueCoalesce(left, lowerExpr(b.right, ctx), type);
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
      if (
        opKind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        opKind === ts.SyntaxKind.ExclamationEqualsEqualsToken
      ) {
        const isEq = opKind === ts.SyntaxKind.EqualsEqualsEqualsToken;
        const test = typeofTest(b, ctx);
        if (test)
          return isEq ? test : { kind: "unary", op: "not", operand: test, type: VT.boolean };
        const left = lowerExpr(b.left, ctx);
        const right = lowerExpr(b.right, ctx);
        // `===` with a Value side compares words: box the other side into the same union. Two
        // optionals (`a === b` with both `string | null`) compare as words too, which gets the
        // nullish cases right without a four-way branch.
        const vt =
          left.type.kind === "value"
            ? left.type
            : right.type.kind === "value" || left.type.kind !== "optional"
              ? right.type
              : right.type.kind === "optional"
                ? bothOptional(left.type, right.type)
                : right.type;
        if (vt.kind === "value") {
          return {
            kind: "binary",
            op: isEq ? "eq" : "ne",
            left: coerceToTarget(left, vt),
            right: coerceToTarget(right, vt),
            type,
          };
        }
        return { kind: "binary", op: isEq ? "eq" : "ne", left, right, type };
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

// "console.log" / "process.exit" for a property-access callee; bare name otherwise.
export function calleeName(expr: ts.Expression): string {
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    return `${expr.expression.text}.${expr.name.text}`;
  }
  if (ts.isIdentifier(expr)) return expr.text;
  return `<${ts.SyntaxKind[expr.kind]}>`;
}
