// Erased generics (PLAN value model item 4): the call boundary between a generic declaration,
// compiled ONCE with every type parameter as a Value word (VALUE_ANY, or its constraint's
// representation; type-translation.ts), and a call site where tsc knows the instantiation.
//
// tsc is the oracle on both sides: the ERASED side is the declaration's own signature
// (getSignatureFromDeclaration, still mentioning T), the INSTANTIATED side is the call's resolved
// signature. Where the two translate to different representations the value is converted:
//   - a scalar or object crossing is one box/unbox (a T word is self-describing, so the
//     instantiation must be too: CS1242 rejects arrays, maps, functions... as type arguments);
//   - an array crossing is a copy (convertArray) and only allowed where nobody can observe it: an
//     array literal argument is built in T's representation directly, and a result is converted
//     only when the callee returns an array it built and dropped (freshReturns);
//   - a function crossing into the callee, or a closure the callee creates and returns, is
//     wrapped (adaptClosure), converting per call.
// Everything else that differs (an aliased array, a map, a nested container) is CS1240. The same
// plan functions serve the validator (which reports the error) and lower (which executes the plan),
// so the two cannot drift.

import ts from "typescript";
import { ice } from "../diagnostics.js";
import type { HExpr } from "../hir/nodes.js";
import type { ValueType } from "../hir/types.js";
import { valueTypeOfTsType } from "./type-translation.js";

export class GenericBoundaryError extends Error {
  constructor(
    readonly code: "CS1240" | "CS1242",
    readonly reason: string,
    readonly suggestion: string,
  ) {
    super(reason);
    this.name = "GenericBoundaryError";
  }
}

// Whether `d` sits inside anything declaring type parameters (a generic function, method, arrow,
// class or interface). Only such a declaration's erased signature can differ from a call's.
export function isGenericDeclaration(d: ts.Node): boolean {
  for (let n: ts.Node | undefined = d; n && !ts.isSourceFile(n); n = n.parent) {
    const tps = (n as { typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> })
      .typeParameters;
    if (tps && tps.length > 0) return true;
  }
  return false;
}

export interface GenericSignature {
  decl: ts.SignatureDeclaration;
  // Per declared parameter: its erased and instantiated types (a rest parameter is its array).
  erased: ValueType[];
  inst: ValueType[];
  rest: boolean;
  erasedRet: ValueType | null;
  instRet: ValueType | null;
}

function retOf(sig: ts.Signature, at: ts.Node, checker: ts.TypeChecker): ValueType | null {
  const r = checker.getReturnTypeOfSignature(sig);
  if (r.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) return null;
  // An async body's `Promise<void>` has no value either.
  return valueTypeOfTsType(r, at, checker);
}

// The erased and instantiated views of a call to a generic declaration, or null for any other call
// (which then lowers exactly as it did before generics existed).
export function genericSignatureOf(
  call: ts.CallExpression | ts.NewExpression,
  checker: ts.TypeChecker,
): GenericSignature | null {
  const rs = checker.getResolvedSignature(call);
  const decl = rs?.declaration;
  if (!rs || !decl || ts.isJSDocSignature(decl) || !isGenericDeclaration(decl)) return null;
  if (decl.getSourceFile().isDeclarationFile) return null; // builtins lower by name
  // A declaration called by name (a function, method or constructor) runs its own compiled body,
  // erased. A function VALUE runs whatever closure the value holds, whose representation is the
  // callee expression's type: a generic arrow's value is erased, but a closure that crossed a
  // boundary was adapted to the instantiation (`const k = constant(5); k()`).
  const byName =
    ts.isFunctionDeclaration(decl) ||
    ts.isMethodDeclaration(decl) ||
    ts.isMethodSignature(decl) ||
    ts.isConstructorDeclaration(decl);
  const ds = byName
    ? checker.getSignatureFromDeclaration(decl)
    : ts.isCallExpression(call)
      ? checker.getSignaturesOfType(
          checker.getTypeAtLocation(call.expression),
          ts.SignatureKind.Call,
        )[0]
      : undefined;
  if (!ds) return null;
  const last = decl.parameters[decl.parameters.length - 1];
  const erased = ds.parameters.map((p) =>
    valueTypeOfTsType(checker.getTypeOfSymbolAtLocation(p, decl), decl, checker),
  );
  // `f([])` infers T = never: no value of it exists, so the argument is already in any
  // representation, and the erased one is the one that needs no conversion.
  const isNever = (t: ts.Type): boolean =>
    (t.flags & ts.TypeFlags.Never) !== 0 ||
    (checker.isArrayType(t) &&
      (checker.getTypeArguments(t as ts.TypeReference)[0]!.flags & ts.TypeFlags.Never) !== 0);
  return {
    decl,
    erased,
    inst: rs.parameters.map((p, i) => {
      const t = checker.getTypeOfSymbolAtLocation(p, call);
      return isNever(t) && erased[i] ? erased[i] : valueTypeOfTsType(t, call, checker);
    }),
    rest: last !== undefined && last.dotDotDotToken !== undefined,
    erasedRet: retOf(ds, decl, checker),
    instRet: retOf(rs, call, checker),
  };
}

// Whether two types occupy a container slot (array element, Map value, closure parameter) the same
// way. Object records are pointers and an object's Value word is that pointer, so objects and
// Value words agree; a raw double, a raw boolean or an untagged string pointer agrees only with
// itself.
export function slotIdentical(a: ValueType, b: ValueType, depth = 0): boolean {
  if (depth > 6) return true;
  const word = (t: ValueType): boolean => t.kind === "value" || t.kind === "object";
  if (word(a) && word(b)) return true;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "array":
      return slotIdentical(a.element, (b as typeof a).element, depth + 1);
    case "set":
      return slotIdentical(a.element, (b as typeof a).element, depth + 1);
    case "optional":
      return slotIdentical(a.inner, (b as typeof a).inner, depth + 1);
    case "promise":
      return slotIdentical(a.inner, (b as typeof a).inner, depth + 1);
    case "map": {
      const m = b as typeof a;
      return slotIdentical(a.key, m.key, depth + 1) && slotIdentical(a.value, m.value, depth + 1);
    }
    case "function": {
      const f = b as typeof a;
      if (a.params.length !== f.params.length || (a.ret === null) !== (f.ret === null)) {
        return false;
      }
      return (
        a.params.every((p, i) => slotIdentical(p, f.params[i]!, depth + 1)) &&
        (a.ret === null || slotIdentical(a.ret, f.ret!, depth + 1))
      );
    }
    case "number":
    case "string":
    case "boolean":
    case "null":
    case "undefined":
    case "unknown":
    case "opaque":
    case "object":
    case "value":
      return true;
    default: {
      const never: never = a;
      return ice(`slotIdentical: ${(never as { kind: string }).kind}`);
    }
  }
}

// A value a T word can hold: its word alone says how to print, compare and serialize it.
function selfDescribing(t: ValueType): boolean {
  switch (t.kind) {
    case "number":
    case "string":
    case "boolean":
    case "null":
    case "undefined":
    case "object":
      return true;
    case "optional":
      return selfDescribing(t.inner);
    case "value":
      return t.members.every(selfDescribing);
    default:
      return false;
  }
}

function describe(t: ValueType): string {
  return t.kind === "array" ? `${describe(t.element)}[]` : t.kind;
}

function notSelfDescribing(t: ValueType): GenericBoundaryError {
  return new GenericBoundaryError(
    "CS1242",
    `a generic type parameter instantiated with ${describe(t)}: an erased T holds one ` +
      "self-describing value (a number, string, boolean, null, undefined or object)",
    "wrap it in an object (`{ items: xs }`), or write a non-generic function for this type",
  );
}

// Whether a word-slot field (object fields always hold Value words) can be read at `b` when it was
// stored at `a`: any two word-level types can, containers must agree slot for slot.
export function fieldCompatible(a: ValueType, b: ValueType): boolean {
  const scalar = (t: ValueType): boolean =>
    t.kind !== "array" &&
    t.kind !== "map" &&
    t.kind !== "set" &&
    t.kind !== "function" &&
    t.kind !== "promise";
  if (scalar(a) || scalar(b)) return true;
  return slotIdentical(a, b);
}

function containerMismatch(what: string, hint: string): GenericBoundaryError {
  return new GenericBoundaryError(
    "CS1240",
    `${what}: the generic code stores T as a Value word, this instantiation does not`,
    hint,
  );
}

export type Plan =
  | { kind: "keep" } // same representation
  | { kind: "coerce" } // one box / unbox / wrap (coerceToTarget)
  | { kind: "literal" } // rebuild the array literal argument in the erased element representation
  | { kind: "copy" } // convertArray (a fresh result array)
  | { kind: "adapt" }; // adaptClosure

// Top-level word conversion between an erased type and its instantiation, or null when neither
// side is a word conversion.
function scalarPlan(erased: ValueType, inst: ValueType): Plan | null {
  const containers = new Set(["array", "map", "set", "function", "promise"]);
  if (containers.has(erased.kind) || containers.has(inst.kind)) {
    if (erased.kind === "value" || inst.kind === "value") {
      const other = erased.kind === "value" ? inst : erased;
      if (other.kind !== "value") throw notSelfDescribing(other);
    }
    return null;
  }
  if (erased.kind === "value" && inst.kind !== "value" && !selfDescribing(inst)) {
    throw notSelfDescribing(inst);
  }
  return slotIdentical(erased, inst) && erased.kind === inst.kind
    ? { kind: "keep" }
    : { kind: "coerce" };
}

// An argument (`inst`, the instantiated parameter type) flowing into the erased parameter.
export function planArgument(erased: ValueType, inst: ValueType, arg: ts.Expression): Plan {
  const s = scalarPlan(erased, inst);
  if (s) return s;
  if (slotIdentical(erased, inst)) return { kind: "keep" };
  if (erased.kind === "array" && inst.kind === "array") {
    let e: ts.Expression = arg;
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    if (ts.isArrayLiteralExpression(e)) {
      elementPlan(erased.element, inst.element);
      return { kind: "literal" };
    }
    throw containerMismatch(
      `this ${describe(inst)} is passed where the generic parameter is ${describe(erased)}`,
      "pass a copy the generic code can own: `f([...xs])`",
    );
  }
  if (erased.kind === "function" && inst.kind === "function") {
    if (
      erased.params.length < inst.params.length ||
      (erased.ret === null) !== (inst.ret === null)
    ) {
      throw containerMismatch(
        "this function is passed as a generic callback with a different arity or void-ness",
        "declare the callback with the parameters and return the generic function expects",
      );
    }
    inst.params.forEach((p, i) => elementPlan(erased.params[i]!, p));
    if (inst.ret !== null) elementPlan(erased.ret!, inst.ret);
    return { kind: "adapt" };
  }
  throw containerMismatch(
    `this ${describe(inst)} is passed where the generic parameter is ${describe(erased)}`,
    "pass the elements in an object or array literal, or write a non-generic function for this type",
  );
}

// An element of a converted container: one word conversion, never a nested container.
export function elementPlan(erased: ValueType, inst: ValueType): void {
  const s = scalarPlan(erased, inst);
  if (s) return;
  if (!slotIdentical(erased, inst)) {
    throw containerMismatch(
      `a nested ${describe(inst)} crosses the generic boundary`,
      "wrap the inner container in an object (`{ items: xs }`)",
    );
  }
}

// A call's result (`erased`, the callee's declared return) arriving at the instantiated type.
export function planResult(
  erased: ValueType,
  inst: ValueType,
  decl: ts.SignatureDeclaration,
  checker: ts.TypeChecker,
): Plan {
  const s = scalarPlan(erased, inst);
  if (s) return s;
  if (slotIdentical(erased, inst)) return { kind: "keep" };
  if (erased.kind === "array" && inst.kind === "array" && freshReturns(decl, checker)) {
    elementPlan(erased.element, inst.element);
    return { kind: "copy" };
  }
  // A returned closure (`constant<T>(x): () => T`) is wrapped the other way round: the adapter
  // takes the instantiation's arguments, boxes them for the erased body and unboxes its result.
  // A closure is immutable, so the wrapper is indistinguishable from it except by identity.
  // Only a closure the callee creates itself: a wrapped closure that came IN would come back as a
  // different object than the caller passed, which `===` could tell apart.
  if (
    erased.kind === "function" &&
    inst.kind === "function" &&
    erased.params.length === inst.params.length &&
    (erased.ret === null) === (inst.ret === null) &&
    returnsNewClosure(decl)
  ) {
    inst.params.forEach((p, i) => elementPlan(erased.params[i]!, p));
    if (inst.ret !== null) elementPlan(erased.ret!, inst.ret);
    return { kind: "adapt" };
  }
  if (erased.kind === "array" && inst.kind === "array") {
    throw containerMismatch(
      `this call returns ${describe(erased)} from generic code where ${describe(inst)} is ` +
        "expected, and the array may still be shared with the generic code",
      "return a new array from the generic function (`return [...items]`)",
    );
  }
  throw containerMismatch(
    `this call's result (${describe(inst)}) holds T inside a ${inst.kind}`,
    "keep the container inside the generic code, or write a non-generic function for this type",
  );
}

// Whether every `return` of `decl` yields an array the function built itself and kept no other
// reference to, so the caller may copy it into its own representation without anyone noticing.
function freshReturns(decl: ts.SignatureDeclaration, checker: ts.TypeChecker): boolean {
  const body = (decl as ts.FunctionLikeDeclarationBase).body;
  if (!body) return false;
  if (!ts.isBlock(body)) return isFresh(body, decl, checker);
  let ok = true;
  let any = false;
  const visit = (n: ts.Node): void => {
    if (!ok || (n !== body && isFunctionScope(n))) return;
    if (ts.isReturnStatement(n)) {
      any = true;
      if (!n.expression || !isFresh(n.expression, decl, checker)) ok = false;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(body);
  return ok && any;
}

// Whether every `return` of `decl` is an arrow or function expression written right there.
function returnsNewClosure(decl: ts.SignatureDeclaration): boolean {
  const body = (decl as ts.FunctionLikeDeclarationBase).body;
  const isNew = (e: ts.Expression): boolean => {
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    return ts.isArrowFunction(e) || ts.isFunctionExpression(e);
  };
  if (!body) return false;
  if (!ts.isBlock(body)) return isNew(body);
  let ok = true;
  let any = false;
  const visit = (n: ts.Node): void => {
    if (!ok || (n !== body && isFunctionScope(n))) return;
    if (ts.isReturnStatement(n)) {
      any = true;
      if (!n.expression || !isNew(n.expression)) ok = false;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(body);
  return ok && any;
}

function isFunctionScope(n: ts.Node): boolean {
  return (
    ts.isArrowFunction(n) ||
    ts.isFunctionExpression(n) ||
    ts.isFunctionDeclaration(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isConstructorDeclaration(n)
  );
}

const NEW_ARRAY_METHODS = new Set(["map", "filter", "slice", "concat", "flat", "flatMap"]);

function isFresh(e: ts.Expression, fn: ts.Node, checker: ts.TypeChecker): boolean {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (ts.isArrayLiteralExpression(e)) return true;
  if (ts.isConditionalExpression(e)) {
    return isFresh(e.whenTrue, fn, checker) && isFresh(e.whenFalse, fn, checker);
  }
  if (
    ts.isCallExpression(e) &&
    ts.isPropertyAccessExpression(e.expression) &&
    NEW_ARRAY_METHODS.has(e.expression.name.text)
  ) {
    const recv = checker.getTypeAtLocation(e.expression.expression);
    return checker.isArrayType(checker.getNonNullableType(recv));
  }
  if (ts.isIdentifier(e)) return isOwnedLocal(e, fn, checker);
  return false;
}

// Uses of a local array that never let another reference escape: reading or writing its elements,
// its builtin methods (which do not retain the receiver), iterating or spreading it, returning it.
const NON_ESCAPING_METHODS = new Set([
  "push",
  "pop",
  "shift",
  "includes",
  "indexOf",
  "join",
  "map",
  "filter",
  "forEach",
  "reduce",
  "some",
  "every",
  "find",
  "findIndex",
  "slice",
  "concat",
  "at",
  "sort",
  "reverse",
]);

function isOwnedLocal(id: ts.Identifier, fn: ts.Node, checker: ts.TypeChecker): boolean {
  const sym = checker.getSymbolAtLocation(id);
  const d = sym?.valueDeclaration;
  if (!sym || !d || !ts.isVariableDeclaration(d) || !d.initializer) return false;
  if (!(d.parent.flags & ts.NodeFlags.Const)) return false;
  if (enclosingScope(d) !== fn || !isFresh(d.initializer, fn, checker)) return false;
  let ok = true;
  const visit = (n: ts.Node): void => {
    if (!ok) return;
    if (ts.isIdentifier(n) && n !== d.name && checker.getSymbolAtLocation(n) === sym) {
      if (enclosingScope(n) !== fn || !nonEscapingUse(n)) ok = false;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(fn);
  return ok;
}

function enclosingScope(n: ts.Node): ts.Node | undefined {
  for (let p = n.parent; p; p = p.parent) if (isFunctionScope(p)) return p;
  return undefined;
}

function nonEscapingUse(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isPropertyAccessExpression(p) && p.expression === id) {
    if (p.name.text === "length") return true;
    // `.sort()`/`.reverse()` return the receiver itself, so only as a statement do they not alias.
    const call = p.parent;
    if (!ts.isCallExpression(call) || call.expression !== p) return false;
    if (!NON_ESCAPING_METHODS.has(p.name.text)) return false;
    if (p.name.text === "sort" || p.name.text === "reverse") {
      return ts.isExpressionStatement(call.parent);
    }
    return true;
  }
  if (ts.isElementAccessExpression(p) && p.expression === id) return true;
  if (ts.isForOfStatement(p) && p.expression === id) return true;
  if (ts.isSpreadElement(p)) return true;
  if (ts.isReturnStatement(p)) return true;
  return false;
}

// Execute an argument plan on the lowered argument `h` (built at the instantiated type).
export function applyArgumentPlan(
  plan: Plan,
  h: HExpr,
  erased: ValueType,
  coerce: (h: HExpr, t: ValueType) => HExpr,
  lowerLiteral: (t: ValueType) => HExpr,
): HExpr {
  switch (plan.kind) {
    // An argument is lowered at its own type (a literal `"u"` is a string even where tsc
    // instantiates T to `number | string`), so even a same-representation plan lands it in the
    // parameter's slot the way every non-generic argument is.
    case "keep":
    case "coerce":
      return coerce(h, erased);
    case "literal":
      return lowerLiteral(erased);
    case "adapt":
      return { kind: "adaptClosure", value: h, type: erased };
    case "copy":
      return ice("lower: a copy plan applies to results only");
    default: {
      const never: never = plan;
      return ice(`applyArgumentPlan: ${(never as { kind: string }).kind}`);
    }
  }
}

// Execute a result plan on the call node `h` (typed at the erased return).
export function applyResultPlan(
  plan: Plan,
  h: HExpr,
  inst: ValueType,
  coerce: (h: HExpr, t: ValueType) => HExpr,
): HExpr {
  switch (plan.kind) {
    case "keep":
      return h;
    case "coerce":
      // A result that is exactly null or undefined has no machine value; its word already prints
      // and compares as that constant.
      return inst.kind === "null" || inst.kind === "undefined" ? h : coerce(h, inst);
    case "copy":
      return { kind: "convertArray", value: h, type: inst };
    case "adapt":
      return { kind: "adaptClosure", value: h, type: inst };
    case "literal":
      return ice("lower: a literal plan applies to arguments only");
    default: {
      const never: never = plan;
      return ice(`applyResultPlan: ${(never as { kind: string }).kind}`);
    }
  }
}
