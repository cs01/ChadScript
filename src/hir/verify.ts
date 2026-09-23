// Independent HIR verification, run between lowering and codegen. The constitution requires every
// HIR node to carry a resolved type BEFORE the backend runs (sema-before-codegen, totally); the
// backend has zero inference and treats a missing type as a never-typed throw. This pass proves
// that invariant up front — walking the whole module and ice()'ing on any expression without a
// resolved type — so a malformed HIR fails loudly here instead of emitting garbage IR (or crashing
// LLVM) deep in codegen. The exhaustive `switch` + `never` default means a new node kind cannot be
// added without teaching the verifier to traverse it (a compile error otherwise).

import { ice } from "../diagnostics.js";
import type { HModule, HFunc, HStmt, HExpr, HCase, FieldAccess, ShapeDescriptor } from "./nodes.js";
import type { ValueType } from "./types.js";

// The module being verified: allocation and access nodes are checked against its shape table.
// Module-level because the walk is a set of free functions; reset on every verifyHir call.
let shapes: readonly ShapeDescriptor[] = [];
// Every function by HIR name and every variable's slot type (names are module-unique), so a value
// flowing into a call argument or an assignment can be checked against where it lands.
let funcs = new Map<string, HFunc>();
let varTypes = new Map<string, ValueType>();
// The return type of the function whose body is being walked (null: void or top level).
let returnType: ValueType | null = null;

export function verifyHir(mod: HModule): HModule {
  shapes = mod.shapes;
  mod.shapes.forEach((s, i) => {
    if (s.id !== i) ice(`verifyHir: shape ${s.id} stored at index ${i}`);
  });
  funcs = new Map(mod.functions.map((f) => [f.name, f]));
  varTypes = new Map();
  for (const f of mod.functions) {
    for (const p of f.params) varTypes.set(p.name, p.type);
    for (const c of f.captures ?? []) varTypes.set(c.name, c.type);
    collectVars(f.body);
  }
  collectVars(mod.topLevel);
  for (const f of mod.functions) verifyFunc(f);
  returnType = null;
  verifyStmts(mod.topLevel);
  return mod;
}

function collectVars(stmts: HStmt[]): void {
  for (const s of stmts) {
    switch (s.kind) {
      case "varDecl":
        varTypes.set(s.name, s.type);
        break;
      case "forOf":
        varTypes.set(s.name, s.elementType);
        collectVars(s.body);
        break;
      case "if":
        collectVars(s.then);
        if (s.otherwise) collectVars(s.otherwise);
        break;
      case "while":
        collectVars(s.body);
        break;
      case "for":
        collectVars(s.init);
        collectVars(s.body);
        collectVars(s.update);
        break;
      case "tryCatch":
        collectVars(s.tryBody);
        if (s.catchBody) collectVars(s.catchBody);
        if (s.finallyBody) collectVars(s.finallyBody);
        break;
      case "switch":
        for (const c of s.cases) collectVars(c.body);
        break;
      default:
        break;
    }
  }
}

// A value landing in a slot of type `dst`: a Value word and a concrete machine value are different
// representations, so crossing between them needs an explicit box/unbox node. A missing one would
// store a double's bits where a Value is read (or the reverse), a silent miscompile; here it is a
// loud one.
function checkFlow(src: HExpr, dst: ValueType, where: string): void {
  if ((src.type.kind === "value") !== (dst.kind === "value")) {
    ice(`verifyHir: ${where}: a ${src.type.kind} flows into a ${dst.kind} slot without box/unbox`);
  }
}

function checkArgs(args: HExpr[], params: ValueType[], where: string): void {
  args.forEach((a, i) => {
    const p = params[i];
    if (p !== undefined) checkFlow(a, p, `${where} argument ${i}`);
  });
}

// Whether a Value of union `v` can be unboxed to `target`: the target (each part of an optional
// target) must be one of the union's members, or the unbox reads a representation the word never
// has.
function unboxable(v: ValueType, target: ValueType): boolean {
  if (v.kind !== "value") return false;
  const has = (k: ValueType["kind"]): boolean => v.members.some((m) => m.kind === k);
  if (target.kind === "optional") {
    return has(target.inner.kind) && (has("undefined") || has("null"));
  }
  return has(target.kind);
}

function verifyShapeId(id: number, what: string): ShapeDescriptor {
  return shapes[id] ?? ice(`verifyHir: ${what} names unknown shape ${id}`);
}

// A member access carries either a static field index or an inline-cache site, never neither.
function verifyAccess(a: FieldAccess): void {
  switch (a.kind) {
    case "slot":
      if (!Number.isInteger(a.index) || a.index < 0) ice(`verifyHir: bad field index ${a.index}`);
      return;
    case "ic":
      if (!Number.isInteger(a.site) || a.site < 0 || a.name === "") {
        ice(`verifyHir: bad inline-cache site ${a.site} for .${a.name}`);
      }
      return;
    default:
      return assertNever(a, "field access");
  }
}

function verifyFunc(f: HFunc): void {
  returnType = f.returnType;
  verifyStmts(f.body);
}

function verifyStmts(stmts: HStmt[]): void {
  for (const s of stmts) verifyStmt(s);
}

function verifyCases(cases: HCase[]): void {
  for (const c of cases) {
    if (c.test) verifyExpr(c.test);
    verifyStmts(c.body);
  }
}

function verifyStmt(s: HStmt): void {
  switch (s.kind) {
    case "consoleLog":
      s.values.forEach(verifyExpr);
      return;
    case "processExit":
      verifyExpr(s.code);
      return;
    case "varDecl":
      checkFlow(s.init, s.type, `let ${s.name}`);
      verifyExpr(s.init);
      return;
    case "assign": {
      const t = varTypes.get(s.name);
      if (t) checkFlow(s.value, t, `assignment to ${s.name}`);
      verifyExpr(s.value);
      return;
    }
    case "memberSet":
      verifyAccess(s.access);
      verifyExpr(s.object);
      verifyExpr(s.value);
      return;
    case "if":
      verifyExpr(s.cond);
      verifyStmts(s.then);
      if (s.otherwise) verifyStmts(s.otherwise);
      return;
    case "while":
      verifyExpr(s.cond);
      verifyStmts(s.body);
      return;
    case "for":
      verifyStmts(s.init);
      if (s.cond) verifyExpr(s.cond);
      verifyStmts(s.update);
      verifyStmts(s.body);
      return;
    case "forOf":
      verifyExpr(s.array);
      verifyStmts(s.body);
      return;
    case "return":
      if (s.value) {
        if (returnType) checkFlow(s.value, returnType, "return");
        verifyExpr(s.value);
      }
      return;
    case "throwError":
      if (s.message) verifyExpr(s.message);
      return;
    case "rethrowValue":
      verifyExpr(s.value);
      return;
    case "tryCatch":
      verifyStmts(s.tryBody);
      if (s.catchBody) verifyStmts(s.catchBody);
      if (s.finallyBody) verifyStmts(s.finallyBody);
      return;
    case "break":
    case "continue":
      return;
    case "switch":
      verifyExpr(s.disc);
      verifyCases(s.cases);
      return;
    case "callStmt": {
      const f = funcs.get(s.name);
      if (f)
        checkArgs(
          s.args,
          f.params.map((p) => p.type),
          `call ${s.name}`,
        );
      s.args.forEach(verifyExpr);
      return;
    }
    case "callClosureStmt":
      if (s.callee.type.kind === "function")
        checkArgs(s.args, s.callee.type.params, "closure call");
      verifyExpr(s.callee);
      s.args.forEach(verifyExpr);
      return;
    case "virtualCallStmt":
      verifyExpr(s.receiver);
      s.args.forEach(verifyExpr);
      return;
    case "exprStmt":
      verifyExpr(s.expr);
      return;
    case "indexSet":
      checkFlow(s.value, s.elementType, "array element write");
      verifyExpr(s.array);
      verifyExpr(s.index);
      verifyExpr(s.value);
      return;
    default:
      return assertNever(s, "statement");
  }
}

function verifyExpr(e: HExpr): void {
  // The core invariant: a resolved type is present. `ice` (never-typed) is the right failure — a
  // typeless HIR node is a compiler bug, not a user error.
  if (!e.type || typeof (e.type as { kind?: unknown }).kind !== "string") {
    ice(`verifyHir: ${e.kind} expression has no resolved type`);
  }
  switch (e.kind) {
    case "numberLit":
    case "stringLit":
    case "boolLit":
    case "varRef":
    case "undefinedOpt":
    case "nullOpt":
    case "nullLit":
    case "undefinedLit":
    case "mapNew":
    case "setNew":
      return;
    case "call": {
      const f = funcs.get(e.name);
      if (f)
        checkArgs(
          e.args,
          f.params.map((p) => p.type),
          `call ${e.name}`,
        );
      e.args.forEach(verifyExpr);
      return;
    }
    case "mathCall":
    case "runtimeCall":
      e.args.forEach(verifyExpr);
      return;
    case "closure":
      return; // captures are variable references resolved at closure creation, not sub-expressions
    case "callClosure":
      if (e.callee.type.kind === "function")
        checkArgs(e.args, e.callee.type.params, "closure call");
      verifyExpr(e.callee);
      e.args.forEach(verifyExpr);
      return;
    case "virtualCall":
      verifyExpr(e.receiver);
      e.args.forEach(verifyExpr);
      return;
    case "conditional":
      checkFlow(e.whenTrue, e.type, "conditional arm");
      checkFlow(e.whenFalse, e.type, "conditional arm");
      verifyExpr(e.cond);
      verifyExpr(e.whenTrue);
      verifyExpr(e.whenFalse);
      return;
    case "numToString":
      verifyExpr(e.value);
      if (e.radix) verifyExpr(e.radix);
      return;
    case "box":
      if (e.type.kind !== "value" || e.value.type.kind === "value") {
        ice(`verifyHir: box from ${e.value.type.kind} to ${e.type.kind}`);
      }
      verifyExpr(e.value);
      return;
    case "unbox":
      if (e.value.type.kind !== "value" || e.type.kind === "value") {
        ice(`verifyHir: unbox from ${e.value.type.kind} to ${e.type.kind}`);
      }
      if (!unboxable(e.value.type, e.type)) {
        ice(`verifyHir: unbox to ${e.type.kind}, which the union never holds`);
      }
      verifyExpr(e.value);
      return;
    case "typeOf":
    case "typeIs":
    case "convert":
    case "unwrap":
    case "wrap":
    case "instanceofCheck":
    case "thrownIsError":
    case "nullCheck":
      verifyExpr(e.value);
      return;
    case "strLen":
      verifyExpr(e.str);
      return;
    case "strMethod":
      verifyExpr(e.receiver);
      e.args.forEach(verifyExpr);
      return;
    case "arrayLit":
      if (e.type.kind === "array") {
        for (const el of e.elements) {
          if (!el.spread) checkFlow(el.value, e.type.element, "array literal element");
        }
      }
      e.elements.forEach((el) => verifyExpr(el.value));
      return;
    case "arrayLen":
      verifyExpr(e.array);
      return;
    case "index":
      verifyExpr(e.array);
      verifyExpr(e.index);
      return;
    case "logical":
      checkFlow(e.left, e.type, "logical operand");
      checkFlow(e.right, e.type, "logical operand");
      verifyExpr(e.left);
      verifyExpr(e.right);
      return;
    case "coalesce":
      checkFlow(e.right, e.type, "?? fallback");
      verifyExpr(e.left);
      verifyExpr(e.right);
      return;
    case "binary":
      // `===` with a Value operand compares Value words, so both sides must be boxed.
      if ((e.op === "eq" || e.op === "ne") && e.left.type.kind === "value") {
        checkFlow(e.right, e.left.type, "=== operand");
      }
      verifyExpr(e.left);
      verifyExpr(e.right);
      return;
    case "arrayPush":
      checkFlow(e.value, e.elementType, "push");
      verifyExpr(e.array);
      verifyExpr(e.value);
      return;
    case "arrayPop":
      verifyExpr(e.array);
      return;
    case "arrayAt":
      verifyExpr(e.array);
      verifyExpr(e.index);
      return;
    case "strAt":
      verifyExpr(e.str);
      verifyExpr(e.index);
      return;
    case "arrayJoin":
      verifyExpr(e.array);
      if (e.separator) verifyExpr(e.separator);
      return;
    case "arraySearch":
      verifyExpr(e.array);
      verifyExpr(e.value);
      return;
    case "arrayXform":
      verifyExpr(e.array);
      e.args.forEach(verifyExpr);
      return;
    case "mapSet":
      if (e.map.type.kind === "map") checkFlow(e.value, e.map.type.value, "map.set value");
      verifyExpr(e.map);
      verifyExpr(e.key);
      verifyExpr(e.value);
      return;
    case "mapGet":
    case "mapHas":
    case "mapDelete":
      verifyExpr(e.map);
      verifyExpr(e.key);
      return;
    case "mapSize":
      verifyExpr(e.map);
      return;
    case "setFromArray":
      verifyExpr(e.array);
      return;
    case "setAdd":
    case "setHas":
    case "setDelete":
      verifyExpr(e.set);
      verifyExpr(e.value);
      return;
    case "setSize":
      verifyExpr(e.set);
      return;
    case "collectionToArray":
      verifyExpr(e.receiver);
      return;
    case "arraySort":
      verifyExpr(e.array);
      if (e.comparator) verifyExpr(e.comparator);
      return;
    case "arrayHof":
      verifyExpr(e.array);
      verifyExpr(e.callback);
      if (e.init) verifyExpr(e.init);
      return;
    case "objectLit": {
      const shape = verifyShapeId(e.shape, "object literal");
      if (shape.fields.length !== e.fields.length) {
        ice(
          `verifyHir: literal has ${e.fields.length} fields, shape ${e.shape} has ${shape.fields.length}`,
        );
      }
      e.fields.forEach(verifyExpr);
      return;
    }
    case "objectSpread": {
      const spreads = e.items.filter((it) => it.kind === "spread").length;
      for (const c of e.cases) {
        const shape = verifyShapeId(c.shape, "spread literal");
        if (c.sources.length !== spreads || shape.fields.length !== c.fields.length) {
          ice(`verifyHir: spread case disagrees with its items or shape ${c.shape}`);
        }
        c.sources.forEach((s) => verifyShapeId(s, "spread source"));
        for (const f of c.fields) {
          const it = e.items[f.item] ?? ice(`verifyHir: spread field from missing item ${f.item}`);
          if ((it.kind === "spread") !== (f.index !== null)) {
            ice("verifyHir: spread field source kind disagrees with its item");
          }
        }
      }
      e.items.forEach((it) => verifyExpr(it.value));
      return;
    }
    case "objectValues":
      verifyExpr(e.object);
      return;
    case "optionalMember":
      if (e.object.type.kind !== "optional" || e.type.kind !== "optional") {
        ice("verifyHir: optional member access on a non-optional receiver or result");
      }
      verifyAccess(e.access);
      verifyExpr(e.object);
      return;
    case "memberGet":
      verifyAccess(e.access);
      verifyExpr(e.object);
      return;
    case "new": {
      if (verifyShapeId(e.shape, "new").className === undefined) {
        ice(`verifyHir: new allocates non-class shape ${e.shape}`);
      }
      const ctor = e.ctorClass === null ? undefined : funcs.get(`${e.ctorClass}.constructor`);
      if (ctor)
        checkArgs(
          e.args,
          ctor.params.slice(1).map((p) => p.type),
          "constructor",
        );
      e.args.forEach(verifyExpr);
      return;
    }
    case "await":
      verifyExpr(e.value);
      return;
    case "asyncCall":
      e.args.forEach(verifyExpr);
      return;
    case "promiseResolve":
      verifyExpr(e.value);
      return;
    case "promiseAll":
      verifyExpr(e.array);
      return;
    case "jsonStringify":
      verifyExpr(e.value);
      return;
    case "jsonParse":
      e.objectShapes.forEach((s) => verifyShapeId(s.shape, "JSON.parse"));
      verifyExpr(e.text);
      return;
    case "numberPredicate":
      verifyExpr(e.arg);
      return;
    case "unary":
      verifyExpr(e.operand);
      return;
    case "template":
      e.exprs.forEach(verifyExpr);
      return;
    default:
      return assertNever(e, "expression");
  }
}

// Compile-time exhaustiveness: an unhandled kind makes `node` non-`never`, a type error. At runtime
// it is an ICE — reaching it means the HIR grew a shape the verifier does not know how to traverse.
function assertNever(node: never, what: string): never {
  return ice(
    `verifyHir: unhandled ${what} kind ${JSON.stringify((node as { kind?: unknown }).kind)}`,
  );
}
