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
import { lowerStatement, lowerStatements, thisRef } from "./statements.js";

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

// Build a class's method table: walk the heritage chain BASE-FIRST, recording each declared
// method's implementing class. An override re-`set`s an existing name — keeping its slot position
// (Map preserves insertion order on update) but pointing the slot at the derived implementation.
function buildClassTable(decl: ts.ClassDeclaration, ctx: LowerCtx): void {
  const className = decl.name!.text;
  if (ctx.classTables.has(className)) return;
  const classType = ctx.checker.getDeclaredTypeOfSymbol(
    ctx.checker.getSymbolAtLocation(decl.name!)!,
  );
  const impls = new Map<string, string>();
  const visit = (t: ts.Type): void => {
    for (const base of ctx.checker.getBaseTypes(t as ts.InterfaceType)) {
      const bd = base.symbol?.valueDeclaration;
      if (bd && ts.isClassDeclaration(bd)) visit(base);
    }
    const d = t.symbol?.valueDeclaration;
    if (d && ts.isClassDeclaration(d) && d.name) {
      for (const m of d.members) {
        if (ts.isMethodDeclaration(m) && ts.isIdentifier(m.name)) {
          impls.set(m.name.text, d.name.text);
        }
      }
    }
  };
  visit(classType);
  ctx.classTables.set(className, { order: [...impls.keys()], impls });

  // Ancestor set (self + every class-declared base, transitively) for instanceof.
  const ancestors = new Set<string>([className]);
  const collectAncestors = (t: ts.Type): void => {
    for (const base of ctx.checker.getBaseTypes(t as ts.InterfaceType)) {
      const bd = base.symbol?.valueDeclaration;
      if (bd && ts.isClassDeclaration(bd) && bd.name) {
        ancestors.add(bd.name.text);
        collectAncestors(base);
      }
    }
  };
  collectAncestors(classType);
  ctx.classAncestors.set(className, ancestors);
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

  // Base class (single inheritance): the name backs `super(...)` and inherited-method dispatch.
  const baseTypes = ctx.checker.getBaseTypes(instanceType as ts.InterfaceType);
  const baseType = baseTypes.find((b) => {
    const d = b.symbol?.valueDeclaration;
    return d && ts.isClassDeclaration(d);
  });
  const baseClassName = baseType?.symbol?.name ?? null;

  const savedBase = ctx.currentBaseClass;
  ctx.currentBaseClass = baseClassName;

  // Field initializers (`x = expr`) run at construction, after `super()` returns. They are lowered
  // into the constructor as `this.field = expr` stores — injected into an explicit constructor, or
  // into a synthesized one when the class declares none. (`constructorClassOf` mirrors this so
  // `new` dispatches to the synthesized ctor.)
  const fieldInits = decl.members.filter(
    (m): m is ts.PropertyDeclaration => ts.isPropertyDeclaration(m) && m.initializer !== undefined,
  );

  const funcs: HFunc[] = [];
  let sawCtor = false;
  for (const member of decl.members) {
    if (ts.isMethodDeclaration(member)) {
      funcs.push(lowerMethodLike(className, member, thisType, ctx, []));
    } else if (ts.isConstructorDeclaration(member)) {
      sawCtor = true;
      funcs.push(lowerMethodLike(className, member, thisType, ctx, fieldInits));
    } else if (ts.isPropertyDeclaration(member)) {
      // initializer handled via constructor injection above; a bare declaration is layout-only.
    } else {
      ice(`lower: unsupported class member ${ts.SyntaxKind[member.kind]}`);
    }
  }
  if (!sawCtor && fieldInits.length > 0) {
    funcs.push(synthesizeFieldInitCtor(className, thisType, fieldInits, ctx));
  }
  ctx.currentBaseClass = savedBase;
  return funcs;
}

// Build the `this.field = initializer` stores for a class's field initializers, in declaration
// order. Must run with `ctx.currentThis` bound (i.e. inside a constructor's lowering scope).
function fieldInitStmts(
  fieldInits: readonly ts.PropertyDeclaration[],
  thisType: ValueType,
  ctx: LowerCtx,
): HStmt[] {
  if (thisType.kind !== "object") ice("lower: field initializer on non-object class type");
  return fieldInits.map((pd) => {
    if (!ts.isIdentifier(pd.name)) return ice("lower: computed field name not supported");
    const fname = pd.name.text;
    const slot = thisType.shape.fields.findIndex((f) => f.name === fname);
    if (slot < 0) ice(`lower: class field ${fname} has no record slot`);
    return {
      kind: "memberSet",
      object: thisRef(ctx),
      slot,
      value: lowerExpr(pd.initializer!, ctx),
    };
  });
}

// A class with field initializers but no explicit constructor gets a synthesized one: `super()`
// (arg-less; only reached for a parameterless base) followed by the field stores.
function synthesizeFieldInitCtor(
  className: string,
  thisType: ValueType,
  fieldInits: readonly ts.PropertyDeclaration[],
  ctx: LowerCtx,
): HFunc {
  const thisName = `this.${ctx.counter.n++}`;
  const savedThis = ctx.currentThis;
  const savedRet = ctx.currentReturnType;
  ctx.currentThis = { name: thisName, type: thisType };
  ctx.currentReturnType = null;
  const body: HStmt[] = [];
  if (ctx.currentBaseClass) {
    body.push({
      kind: "callStmt",
      name: `${ctx.currentBaseClass}.constructor`,
      args: [thisRef(ctx)],
      returnType: null,
    });
  }
  body.push(...fieldInitStmts(fieldInits, thisType, ctx));
  ctx.currentThis = savedThis;
  ctx.currentReturnType = savedRet;
  return {
    name: `${className}.constructor`,
    params: [{ name: thisName, type: thisType }],
    returnType: null,
    body,
  };
}

// A method or constructor → an HFunc `Class.name` with `this` prepended to the params.
function lowerMethodLike(
  className: string,
  member: ts.MethodDeclaration | ts.ConstructorDeclaration,
  thisType: ValueType,
  ctx: LowerCtx,
  fieldInits: readonly ts.PropertyDeclaration[],
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

  // A constructor returns nothing (the record is returned by `new`); a method returns its
  // declared type.
  const returnType = isCtor ? null : returnTypeOfSignature(member, ctx);
  const savedThis = ctx.currentThis;
  const savedRet = ctx.currentReturnType;
  ctx.currentThis = { name: thisName, type: thisType };
  ctx.currentReturnType = returnType;
  let body = lowerStatements(member.body.statements, ctx);
  // Field initializers run after `super()` returns (derived) or at the top (base class).
  if (isCtor && fieldInits.length > 0) {
    const inits = fieldInitStmts(fieldInits, thisType, ctx);
    const superIdx = ctx.currentBaseClass
      ? body.findIndex(
          (s) => s.kind === "callStmt" && s.name === `${ctx.currentBaseClass}.constructor`,
        )
      : -1;
    body =
      superIdx >= 0
        ? [...body.slice(0, superIdx + 1), ...inits, ...body.slice(superIdx + 1)]
        : [...inits, ...body];
  }
  ctx.currentThis = savedThis;
  ctx.currentReturnType = savedRet;
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

  const sig = ctx.checker.getSignatureFromDeclaration(arrow);
  const retT = sig ? ctx.checker.getReturnTypeOfSignature(sig) : undefined;
  const returnType =
    !retT || retT.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)
      ? null
      : valueTypeOfTsType(retT, arrow, ctx.checker);

  const savedRet = ctx.currentReturnType;
  ctx.currentReturnType = returnType;
  const body: HStmt[] = ts.isBlock(arrow.body)
    ? lowerStatements(arrow.body.statements, ctx)
    : [
        {
          kind: "return",
          value: coerceToTarget(lowerExpr(arrow.body, ctx), returnType ?? VT.undefined),
        },
      ];
  ctx.currentReturnType = savedRet;

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
    if (p.questionToken || p.initializer)
      ice("lower: optional/default parameters not supported yet");
    // A rest parameter `...xs: T[]` is received as a single array param — the call site packs
    // the trailing arguments into it, so the callee treats it like any array parameter.
    return { name: nameOf(p.name, ctx), type: valueTypeOf(p.name, ctx) };
  });
  const returnType = returnTypeOf(decl, ctx);
  const saved = ctx.currentReturnType;
  ctx.currentReturnType = returnType;
  const body = lowerStatements(decl.body.statements, ctx);
  ctx.currentReturnType = saved;
  return { name: nameOf(decl.name, ctx), params, returnType, body };
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
export function nameOf(ident: ts.Identifier, ctx: LowerCtx): string {
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
      args: lowerCallArgs(call, ctx),
      type: resolveType(call, ctx),
    };
  }
  return {
    kind: "call",
    name: nameOf(call.expression, ctx),
    args: lowerCallArgs(call, ctx),
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
  if (name === "String" || name === "Number" || name === "Boolean") {
    const arg = call.arguments[0];
    if (!arg) ice(`lower: ${name}() with no argument not supported`);
    const resultType = name === "String" ? VT.string : name === "Number" ? VT.number : VT.boolean;
    return { kind: "convert", op: name, value: lowerExpr(arg, ctx), type: resultType };
  }
  return null;
}

// A synthetic number literal HExpr (for builtin default arguments).
function numLit(value: number): HExpr {
  return { kind: "numberLit", value, type: VT.number };
}

// Object literal → fields in SHAPE (record-slot) order, regardless of source property order.
// Properties are processed LEFT-TO-RIGHT into a name→value map so a later property or `...spread`
// overrides an earlier one (JS object-spread precedence). Supports `{ x: v }`, shorthand `{ x }`,
// and `{ ...src }`. A spread source's field is read with a `memberGet` (source re-evaluated per
// field — fine for the common `...variable` case).
function lowerObjectLit(ole: ts.ObjectLiteralExpression, ctx: LowerCtx, type: ValueType): HExpr {
  if (type.kind !== "object") ice("lower: object literal without a resolved object shape");
  const byName = new Map<string, HExpr>();
  for (const p of ole.properties) {
    if (ts.isSpreadAssignment(p)) {
      const src = lowerExpr(p.expression, ctx);
      if (src.type.kind !== "object") ice(`lower: spread of ${src.type.kind} in object literal`);
      src.type.shape.fields.forEach((sf, i) => {
        byName.set(sf.name, { kind: "memberGet", object: src, slot: i, type: sf.type });
      });
    } else if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) {
      byName.set(p.name.text, lowerExpr(p.initializer, ctx));
    } else if (ts.isShorthandPropertyAssignment(p)) {
      // `{ a }` = field `a` from the variable `a`. Resolve the VALUE symbol (the variable).
      const valueSym = ctx.checker.getShorthandAssignmentValueSymbol(p);
      if (!valueSym) return ice(`lower: cannot resolve shorthand property ${p.name.text}`);
      byName.set(p.name.text, {
        kind: "varRef",
        name: nameForSymbol(valueSym, p.name.text, ctx),
        type: valueTypeOf(p.name, ctx),
      });
    } else return ice(`lower: unsupported object member ${ts.SyntaxKind[p.kind]}`);
  }
  const fields = type.shape.fields.map((f): HExpr => {
    const value = byName.get(f.name);
    if (!value) {
      // An omitted field must be optional (tsc enforces); store the undefined sentinel.
      if (f.type.kind !== "optional") return ice(`lower: object literal missing field ${f.name}`);
      return { kind: "undefinedOpt", type: f.type };
    }
    return coerceToTarget(value, f.type); // optional-wrap / null-sentinel a present value
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
export function isMathNamespace(expr: ts.Expression): boolean {
  return ts.isIdentifier(expr) && expr.text === "Math";
}

// The runtime key-kind tag for a Map key type, selecting its equality function. Map keys must be
// primitive (object identity keys are a later feature).
export function keyKindOf(keyType: ValueType): number {
  switch (keyType.kind) {
    case "number":
      return 0;
    case "string":
      return 1;
    case "boolean":
      return 2;
    default:
      return ice(`lower: Map key type ${keyType.kind} not supported (use number/string/boolean)`);
  }
}

// One element of an array literal: a single value, or `...src` spread of an array/set source.
function lowerArrayElement(
  e: ts.Expression,
  ctx: LowerCtx,
): import("../hir/nodes.js").ArrayElement {
  if (ts.isSpreadElement(e)) {
    let value = lowerExpr(e.expression, ctx);
    // A Set spreads its elements — materialize to an array first. (Map → entries needs tuples.)
    if (value.type.kind === "set") {
      value = {
        kind: "collectionToArray",
        fn: "cs_set_values",
        receiver: value,
        type: VT.array(value.type.element),
      };
    }
    if (value.type.kind !== "array") {
      ice(`lower: spread of ${value.type.kind} not supported in an array literal`);
    }
    return { spread: true, value };
  }
  return { spread: false, value: lowerExpr(e, ctx) };
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

function constructorClassOf(className: string, node: ts.Node, ctx: LowerCtx): string | null {
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
  const sym = ctx.checker.getSymbolAtLocation(ident);
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

// The checker is the oracle: map its resolved type to our ValueType. Anything outside the
// currently-supported domain is an ICE (the validator should have rejected it upstream).
export function resolveType(expr: ts.Expression, ctx: LowerCtx): ValueType {
  const checker = ctx.checker;
  // `this` has tsc's polymorphic ThisType (a type parameter); use the bound instance type.
  if (expr.kind === ts.SyntaxKind.ThisKeyword && ctx.currentThis) return ctx.currentThis.type;

  // Array literals: prefer the literal's own inferred type (the real element type). An empty
  // `[]` is `never[]` — fall back to the contextual/declared array type. The contextual type is
  // NOT trusted blindly: as a `.concat()` argument it is `ConcatArray<T>` (an interface, not
  // Array), which must not be mistaken for an object.
  if (ts.isArrayLiteralExpression(expr)) {
    // Ignore an element type that carries no representation (never/unknown/any) — e.g. from an
    // `unknown[]` contextual type (console.log's parameter).
    const usable = (t: ts.Type | undefined): boolean =>
      t !== undefined &&
      !(t.flags & (ts.TypeFlags.Never | ts.TypeFlags.Unknown | ts.TypeFlags.Any));
    const ownElem = arrayElementType(checker.getTypeAtLocation(expr), checker);
    if (usable(ownElem)) return VT.array(valueTypeOfTsType(ownElem!, expr, checker));
    const ctxT = checker.getContextualType(expr);
    const ctxElem = ctxT ? arrayElementType(ctxT, checker) : undefined;
    if (usable(ctxElem)) return VT.array(valueTypeOfTsType(ctxElem!, expr, checker));
    // An empty literal with no usable element type: the element type is irrelevant (nothing is
    // stored or formatted), so a harmless placeholder keeps `console.log([])` compiling.
    if (expr.elements.length === 0) return VT.array(VT.number);
    return valueTypeOfTsType(checker.getTypeAtLocation(expr), expr, checker);
  }

  // Object literals take their shape from the declared type (the named interface) when present,
  // but ignore an unknown/any contextual type (console.log's parameter) — use the literal's own
  // inferred shape then.
  if (ts.isObjectLiteralExpression(expr)) {
    const ct = checker.getContextualType(expr);
    const t =
      ct && !(ct.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any))
        ? ct
        : checker.getTypeAtLocation(expr);
    return valueTypeOfTsType(t, expr, checker);
  }
  return valueTypeOf(expr, ctx);
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
