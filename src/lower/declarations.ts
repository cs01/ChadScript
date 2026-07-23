// Declaration lowering: classes (method tables, field-initializer constructors, methods) and
// function/arrow lifting to HFuncs (with closure capture analysis). Split out of lower.ts; the
// statement + expression lowering and helpers it uses are imported back (circular, call-time).

import ts from "typescript";
import { ice } from "../diagnostics.js";
import type { HExpr, HStmt, HFunc, HCapture } from "../hir/nodes.js";
import { VT } from "../hir/types.js";
import type { ValueType } from "../hir/types.js";
import { type LowerCtx, lowerExpr, coerceToTarget, nameOf, nameForSymbol } from "./lower.js";
import { lowerStatements, thisRef, bindObjectPattern } from "./statements.js";
import {
  valueTypeOf,
  valueTypeOfTsType,
  returnTypeOf,
  returnTypeOfSignature,
} from "./type-translation.js";

// Build a class's method table: walk the heritage chain BASE-FIRST, recording each declared
// method's implementing class. An override re-`set`s an existing name — keeping its slot position
// (Map preserves insertion order on update) but pointing the slot at the derived implementation.
export function buildClassTable(decl: ts.ClassDeclaration, ctx: LowerCtx): void {
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
export function lowerClass(decl: ts.ClassDeclaration, ctx: LowerCtx): HFunc[] {
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
export function fieldInitStmts(
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
export function synthesizeFieldInitCtor(
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
export function lowerMethodLike(
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

  // Destructured object params are received under a synthetic name; a prelude binds their fields
  // (same as free functions). See lowerFunction.
  const paramPrelude: HStmt[] = [];
  const params = [
    { name: thisName, type: thisType },
    ...member.parameters.map((p) => {
      if (ts.isObjectBindingPattern(p.name)) {
        const ptype = valueTypeOf(p, ctx);
        const tempName = `__param.${ctx.counter.n++}`;
        paramPrelude.push(
          ...bindObjectPattern(p.name, { kind: "varRef", name: tempName, type: ptype }, ctx),
        );
        return { name: tempName, type: ptype };
      }
      if (!ts.isIdentifier(p.name)) ice("lower: array-destructured parameter not supported");
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
  let body = [...paramPrelude, ...lowerStatements(member.body.statements, ctx)];
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
export function lowerArrow(arrow: ts.ArrowFunction | ts.FunctionExpression, ctx: LowerCtx): HExpr {
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
export function findCaptures(
  arrow: ts.ArrowFunction | ts.FunctionExpression,
  ctx: LowerCtx,
): HCapture[] {
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
export function captureKind(sym: ts.Symbol, arrow: ts.Node): "const" | "mutable" | "no" {
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

export function isDescendantOf(node: ts.Node, ancestor: ts.Node): boolean {
  for (let p: ts.Node | undefined = node; p; p = p.parent) if (p === ancestor) return true;
  return false;
}

export function lowerFunction(decl: ts.FunctionDeclaration, ctx: LowerCtx): HFunc {
  if (!decl.name) ice("lower: anonymous function declaration not supported");
  if (!decl.body) ice("lower: function without a body (overload/declare) not supported");
  // A destructured object parameter `f({ x, y }: P)` is received as one object param under a
  // synthetic name; its fields are then bound by a prelude prepended to the body (so `x`/`y` are
  // ordinary locals). This reuses the variable-destructuring field binder.
  const paramPrelude: HStmt[] = [];
  const params = decl.parameters.map((p) => {
    if (ts.isObjectBindingPattern(p.name)) {
      if (p.questionToken || p.initializer)
        ice("lower: optional/default destructured parameters not supported yet");
      const ptype = valueTypeOf(p, ctx);
      const tempName = `__param.${ctx.counter.n++}`;
      paramPrelude.push(
        ...bindObjectPattern(p.name, { kind: "varRef", name: tempName, type: ptype }, ctx),
      );
      return { name: tempName, type: ptype };
    }
    if (!ts.isIdentifier(p.name)) ice("lower: array-destructured parameters not supported yet");
    if (p.questionToken || p.initializer)
      ice("lower: optional/default parameters not supported yet");
    // A rest parameter `...xs: T[]` is received as a single array param — the call site packs
    // the trailing arguments into it, so the callee treats it like any array parameter.
    return { name: nameOf(p.name, ctx), type: valueTypeOf(p.name, ctx) };
  });
  const isAsync = decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
  // An async function's declared return is `Promise<T>`; the BODY returns T (the value cs_fiber_return
  // resolves the promise with), so lower the body against the inner type.
  const declaredRet = returnTypeOf(decl, ctx);
  let returnType = declaredRet;
  if (isAsync && declaredRet?.kind === "promise") {
    // Promise<void> unwraps to the `undefined` value type, but a void async body returns no value —
    // normalize to null so the backend treats it like any other void function (no return slot in
    // try/catch, fall-through resolves the promise via cs_fiber_return(0)), rather than trying to
    // give `undefined` a storage representation.
    returnType = declaredRet.inner.kind === "undefined" ? null : declaredRet.inner;
  }
  const saved = ctx.currentReturnType;
  ctx.currentReturnType = returnType;
  const body = [...paramPrelude, ...lowerStatements(decl.body.statements, ctx)];
  ctx.currentReturnType = saved;
  return { name: nameOf(decl.name, ctx), params, returnType, body, async: isAsync };
}

// Object literal → fields in SHAPE (record-slot) order, regardless of source property order.
// Properties are processed LEFT-TO-RIGHT into a name→value map so a later property or `...spread`
// overrides an earlier one (JS object-spread precedence). Supports `{ x: v }`, shorthand `{ x }`,
// and `{ ...src }`. A spread source's field is read with a `memberGet` (source re-evaluated per
// field — fine for the common `...variable` case).
export function lowerObjectLit(
  ole: ts.ObjectLiteralExpression,
  ctx: LowerCtx,
  type: ValueType,
): HExpr {
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
export const MATH_CONSTS: Record<string, number> = {
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

// `Number.X` numeric constants — the compiler's own (exact) Number values, emitted as number
// literals (fimm carries the full f64 bits, so ±Infinity and NaN round-trip). `Number.isInteger`
// etc. are calls, handled in method-call.ts, not here.
export const NUMBER_CONSTS: Record<string, number> = {
  MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
  MIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER,
  MAX_VALUE: Number.MAX_VALUE,
  MIN_VALUE: Number.MIN_VALUE,
  EPSILON: Number.EPSILON,
  POSITIVE_INFINITY: Number.POSITIVE_INFINITY,
  NEGATIVE_INFINITY: Number.NEGATIVE_INFINITY,
  NaN: Number.NaN,
};

export function isNumberNamespace(expr: ts.Expression): boolean {
  return ts.isIdentifier(expr) && expr.text === "Number";
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
export function lowerArrayElement(
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
