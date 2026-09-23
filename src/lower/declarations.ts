// Declaration lowering: classes (method tables, field-initializer constructors, methods) and
// function/arrow lifting to HFuncs (with closure capture analysis). Split out of lower.ts; the
// statement + expression lowering and helpers it uses are imported back (circular, call-time).

import ts from "typescript";
import { ice } from "../diagnostics.js";
import type { HExpr, HStmt, HFunc, HCapture } from "../hir/nodes.js";
import { VT } from "../hir/types.js";
import type { ValueType } from "../hir/types.js";
import { type LowerCtx, lowerExpr, coerceToTarget, nameOf, nameForSymbol } from "./lower.js";
import {
  lowerStatements,
  lowerExprStatement,
  lowerCallStatement,
  thisRef,
  bindObjectPattern,
} from "./statements.js";
import { functionDeclSymbol } from "./default-export.js";
import { classDeclOfType, classIdOf, constructorClassOf } from "./class-ids.js";
import { accessIn } from "./member-access.js";
import { cellFlag, isModuleVariable } from "./cells.js";
import { isGenericDeclaration } from "./generics.js";
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
  const className = classIdOf(decl);
  if (ctx.classTables.has(className)) return;
  ctx.classDecls.set(className, decl);
  const classType = ctx.checker.getDeclaredTypeOfSymbol(
    ctx.checker.getSymbolAtLocation(decl.name!)!,
  );
  const impls = new Map<string, string>();
  const visit = (t: ts.Type): void => {
    for (const base of ctx.checker.getBaseTypes(t as ts.InterfaceType)) {
      const bd = base.symbol?.valueDeclaration;
      if (bd && ts.isClassDeclaration(bd)) visit(base);
    }
    const d = classDeclOfType(t);
    if (d) {
      for (const m of d.members) {
        if (ts.isMethodDeclaration(m) && ts.isIdentifier(m.name)) {
          impls.set(m.name.text, classIdOf(d));
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
      const bd = classDeclOfType(base);
      if (bd) {
        ancestors.add(classIdOf(bd));
        collectAncestors(base);
      }
    }
  };
  collectAncestors(classType);
  ctx.classAncestors.set(className, ancestors);
}

// A class's runtime shape: its data fields base-first (the instance ValueType's order) and its
// method table in vtable-slot order. Needs buildClassTable to have run for the class.
export function registerClassShape(decl: ts.ClassDeclaration, ctx: LowerCtx): void {
  const className = classIdOf(decl);
  const instanceType = ctx.checker.getDeclaredTypeOfSymbol(
    ctx.checker.getSymbolAtLocation(decl.name!)!,
  );
  const vt = valueTypeOfTsType(instanceType, decl.name!, ctx.checker);
  if (vt.kind !== "object") return ice(`lower: class ${className} is not an object type`);
  const table = ctx.classTables.get(className) ?? ice(`lower: class ${className} has no table`);
  const methods = table.order.map((m) => ({ name: m, fn: `${table.impls.get(m)}.${m}` }));
  const shape = ctx.shapes.defineClass(className, vt.shape.fields, methods);
  ctx.layoutShapes.set(ctx.layouts.classLayout(className).id, new Set([shape]));
}

// A class lowers to a set of free functions: each method and the constructor become an HFunc
// taking the instance record as a hidden first parameter `this`. Field access uses the object
// member machinery. First pass: no inheritance / static / getters.
export function lowerClass(decl: ts.ClassDeclaration, ctx: LowerCtx): HFunc[] {
  if (!decl.name) ice("lower: anonymous class not supported");
  const className = classIdOf(decl);
  const classSym = ctx.checker.getSymbolAtLocation(decl.name)!;
  const instanceType = ctx.checker.getDeclaredTypeOfSymbol(classSym);
  const thisType = valueTypeOfTsType(instanceType, decl.name, ctx.checker);

  // Base class (single inheritance): the name backs `super(...)` and inherited-method dispatch.
  const baseTypes = ctx.checker.getBaseTypes(instanceType as ts.InterfaceType);
  const baseType = baseTypes.find((b) => {
    const d = b.symbol?.valueDeclaration;
    return d && ts.isClassDeclaration(d);
  });
  const baseDecl = baseType ? classDeclOfType(baseType) : null;
  const baseClassName = baseDecl ? classIdOf(baseDecl) : null;

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
    funcs.push(synthesizeFieldInitCtor(className, decl, thisType, fieldInits, ctx));
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
    if (!ts.isClassDeclaration(pd.parent)) return ice("lower: field initializer outside a class");
    return {
      kind: "memberSet",
      object: thisRef(ctx),
      access: accessIn(ctx.layouts.reachingThis(pd.parent), pd.name.text, ctx),
      value: lowerExpr(pd.initializer!, ctx),
    };
  });
}

// The parameter list a derived class inherits when it declares no constructor of its own: the
// nearest ancestor's EXPLICIT constructor signature. Ancestors between here and there synthesize
// forwarding constructors with this same signature, so the chain stays consistent.
function inheritedCtorParams(
  decl: ts.ClassDeclaration,
  ctx: LowerCtx,
): readonly ts.ParameterDeclaration[] {
  const nextBase = (t: ts.Type): ts.Type | undefined =>
    ctx.checker.getBaseTypes(t as ts.InterfaceType).find((b) => {
      const bd = b.symbol?.valueDeclaration;
      return bd !== undefined && ts.isClassDeclaration(bd);
    });
  const self = ctx.checker.getDeclaredTypeOfSymbol(ctx.checker.getSymbolAtLocation(decl.name!)!);
  let t = nextBase(self);
  while (t) {
    const d = t.symbol?.valueDeclaration;
    if (!d || !ts.isClassDeclaration(d)) break;
    const ctor = d.members.find(
      (m): m is ts.ConstructorDeclaration => ts.isConstructorDeclaration(m) && m.body !== undefined,
    );
    if (ctor) return ctor.parameters;
    t = nextBase(t);
  }
  return [];
}

// A class with field initializers but no explicit constructor gets a synthesized one. JavaScript's
// default derived constructor is `constructor(...args) { super(...args); }` — so it must adopt the
// inherited signature and FORWARD it, then run the field stores (which run after super() returns,
// and therefore win over anything the base assigned to the same field).
export function synthesizeFieldInitCtor(
  className: string,
  decl: ts.ClassDeclaration,
  thisType: ValueType,
  fieldInits: readonly ts.PropertyDeclaration[],
  ctx: LowerCtx,
): HFunc {
  const thisName = `this.${ctx.counter.n++}`;
  const savedThis = ctx.currentThis;
  const savedRet = ctx.currentReturnType;
  ctx.currentThis = { name: thisName, type: thisType };
  ctx.currentReturnType = null;

  // Forwarded parameters have no source binding of their own, so they get synthetic names; nothing
  // in the body refers to them except the super() call built right here.
  const forwarded = ctx.currentBaseClass
    ? inheritedCtorParams(decl, ctx).map((p) => {
        if (ts.isObjectBindingPattern(p.name)) {
          return { name: `__super.${ctx.counter.n++}`, type: valueTypeOf(p, ctx) };
        }
        if (!ts.isIdentifier(p.name)) ice("lower: array-destructured inherited parameter");
        return { name: `__super.${ctx.counter.n++}`, type: valueTypeOf(p.name, ctx) };
      })
    : [];

  const body: HStmt[] = [];
  const ctorClass = ctx.currentBaseClass ? constructorClassOf(ctx.currentBaseClass, ctx) : null;
  if (ctorClass !== null) {
    body.push({
      kind: "callStmt",
      name: `${ctorClass}.constructor`,
      args: [
        thisRef(ctx),
        ...forwarded.map((p): HExpr => ({ kind: "varRef", name: p.name, type: p.type })),
      ],
      returnType: null,
    });
  }
  body.push(...fieldInitStmts(fieldInits, thisType, ctx));
  ctx.currentThis = savedThis;
  ctx.currentReturnType = savedRet;
  return {
    name: `${className}.constructor`,
    params: [{ name: thisName, type: thisType }, ...forwarded],
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
      return {
        name: nameOf(p.name, ctx),
        type: valueTypeOf(p.name, ctx),
        ...cellFlag(p.name, ctx.cells, ctx.checker),
      };
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
    return {
      name: nameOf(p.name, ctx),
      type: valueTypeOf(p.name, ctx),
      ...cellFlag(p.name, ctx.cells, ctx.checker),
    };
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
  // A void arrow's expression body (`(m) => console.log(m)`) is a statement: its value, if it
  // has one, is discarded, and a void call has none to return.
  const body: HStmt[] = ts.isBlock(arrow.body)
    ? lowerStatements(arrow.body.statements, ctx)
    : returnType === null
      ? [
          ts.isCallExpression(arrow.body)
            ? lowerCallStatement(arrow.body, ctx)
            : lowerExprStatement(arrow.body, ctx),
          { kind: "return", value: null },
        ]
      : [{ kind: "return", value: coerceToTarget(lowerExpr(arrow.body, ctx), returnType) }];
  ctx.currentReturnType = savedRet;

  ctx.functions.push({ name: lambdaName, params, returnType, body, captures });
  return {
    kind: "closure",
    lambdaName,
    captures,
    display: functionDisplay(arrow),
    type: { kind: "function", params: params.map((p) => p.type), ret: returnType },
  };
}

// How util.inspect shows a function: `[Function: name]` with the name JS gives an anonymous
// function from where it is defined (NamedEvaluation: a variable, property, or class field it
// initializes), or `[Function (anonymous)]`.
function functionDisplay(fn: ts.ArrowFunction | ts.FunctionExpression): string {
  const isAsync = fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
  const kind = isAsync ? "AsyncFunction" : "Function";
  const name = inferredFunctionName(fn);
  return name === "" ? `[${kind} (anonymous)]` : `[${kind}: ${name}]`;
}

function inferredFunctionName(fn: ts.ArrowFunction | ts.FunctionExpression): string {
  if (ts.isFunctionExpression(fn) && fn.name) return fn.name.text;
  let node: ts.Node = fn;
  while (ts.isParenthesizedExpression(node.parent)) node = node.parent;
  const p = node.parent;
  if (
    (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) &&
    p.initializer === node &&
    (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
  ) {
    return p.name.text;
  }
  if (
    ts.isBinaryExpression(p) &&
    p.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    p.right === node &&
    ts.isIdentifier(p.left)
  ) {
    return p.left.text;
  }
  if (ts.isExportAssignment(p)) return "default";
  return "";
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
        const kind = captureKind(sym, arrow, ctx.cells);
        // A cell binding is captured by reference (the env holds its cell pointer); every other
        // binding never changes after capture, so copying its value is exact.
        if (kind === "value" || kind === "cell") {
          const name = ctx.names.get(sym);
          if (name) {
            const type = captureType(sym, node, ctx);
            caps.set(sym, kind === "cell" ? { name, type, byRef: true } : { name, type });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(arrow.body);
  return [...caps.values()];
}

// The type a capture is copied at: the captured slot's representation. The first reference inside
// the arrow may be narrowed (tsc keeps a const's narrowing inside closures), but the env copies the
// SLOT, so a Value-union variable is captured as its declared union and unboxed at each narrowed
// read inside the body, like any other Value variable.
function captureType(sym: ts.Symbol, node: ts.Identifier, ctx: LowerCtx): ValueType {
  const decl = sym.valueDeclaration;
  if (decl) {
    const declared = valueTypeOfTsType(
      ctx.checker.getTypeOfSymbolAtLocation(sym, decl),
      node,
      ctx.checker,
    );
    if (declared.kind === "value") return declared;
  }
  return valueTypeOf(node, ctx);
}

// Whether a symbol referenced in an arrow is captured, and if so how. "no" = the arrow's own
// local/param, a top-level function, a class, or a module variable (an IR global every function
// reads by name). "cell" = a binding lower/cells.ts put in a heap cell (captured and reassigned);
// "value" = any other local, which never changes once the closure exists.
export function captureKind(
  sym: ts.Symbol,
  arrow: ts.Node,
  cells: ReadonlySet<ts.Symbol>,
): "value" | "cell" | "no" {
  const d = sym.valueDeclaration;
  if (!d) return "no";
  if (isDescendantOf(d, arrow)) return "no"; // declared inside the arrow → local
  if (cells.has(sym)) return "cell";
  if (ts.isParameter(d)) return "value";
  if (ts.isVariableDeclaration(d)) {
    // A module-level `const` keeps its historical by-value capture (same IR as before cells); a
    // module-level `let` is read and written through its global, so it is shared by construction.
    if (isModuleVariable(d) && !(d.parent.flags & ts.NodeFlags.Const)) return "no";
    return "value";
  }
  return "no"; // functions, classes, globals
}

export function isDescendantOf(node: ts.Node, ancestor: ts.Node): boolean {
  for (let p: ts.Node | undefined = node; p; p = p.parent) if (p === ancestor) return true;
  return false;
}

export function lowerFunction(decl: ts.FunctionDeclaration, ctx: LowerCtx): HFunc {
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
    return {
      name: nameOf(p.name, ctx),
      type: valueTypeOf(p.name, ctx),
      ...cellFlag(p.name, ctx.cells, ctx.checker),
    };
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
  const name = nameForSymbol(functionDeclSymbol(decl, ctx), decl.name?.text ?? "default", ctx);
  return { name, params, returnType, body, async: isAsync };
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

// Wrap a top-level function declaration so it can be used as a first-class value.
//
// A closure is a {fnptr, env} record whose fnptr is called as `fn(env, ...args)`, while a top-level
// function is emitted with no env parameter — so its address cannot be stored in a closure record
// directly. The wrapper is an ordinary lifted lambda (an empty `captures` list is what gives it the
// env parameter) whose body just forwards to the real function. A generic function is compiled
// with erased parameters, so the wrapper also converts each argument and the result (one word
// conversion each; validate/generic-rules.ts rejects a reference needing more).
//
// Async function declarations are NOT admitted here: a call to one must SPAWN a fiber and yield a
// promise, and a forwarding wrapper would instead run the body synchronously. The validator rejects
// those as CS1232.
export function lowerFunctionRef(
  ident: ts.Identifier,
  decl: ts.FunctionDeclaration,
  useType: ValueType,
  ctx: LowerCtx,
): HExpr {
  const target = nameOf(ident, ctx);
  const wrapperName = `fnref.${ctx.counter.n++}`;
  const paramTypes = useType.kind === "function" ? useType.params : [];
  const returnType = useType.kind === "function" ? useType.ret : null;
  const params = paramTypes.map((type, i) => ({ name: `${wrapperName}.p${i}`, type }));
  let args: HExpr[] = params.map((p) => ({ kind: "varRef", name: p.name, type: p.type }));
  let calleeRet = returnType;
  if (isGenericDeclaration(decl)) {
    const sig = ctx.checker.getSignatureFromDeclaration(decl) ?? ice("lower: no signature");
    const erased = sig.parameters.map((p) =>
      valueTypeOfTsType(ctx.checker.getTypeOfSymbolAtLocation(p, decl), decl, ctx.checker),
    );
    args = args.map((a, i) => (erased[i] ? coerceToTarget(a, erased[i]) : a));
    calleeRet = returnTypeOf(decl, ctx);
  }

  const call = (type: ValueType): HExpr => ({ kind: "call", name: target, args, type });
  const body: HStmt[] =
    returnType && calleeRet
      ? [{ kind: "return", value: coerceToTarget(call(calleeRet), returnType) }]
      : [
          { kind: "callStmt", name: target, args, returnType: calleeRet },
          { kind: "return", value: null },
        ];

  ctx.functions.push({ name: wrapperName, params, returnType, body, captures: [] });
  return {
    kind: "closure",
    lambdaName: wrapperName,
    captures: [],
    display: `[Function: ${decl.name?.text ?? "default"}]`,
    type: { kind: "function", params: paramTypes, ret: returnType },
  };
}
