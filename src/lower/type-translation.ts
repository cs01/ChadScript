// TS-type → ValueType translation: the single place the checker's structural types are mapped to
// the compiler's machine representation (number/string/array/object/map/set/function/optional).
// Split out of lower.ts; it queries the checker directly and imports LowerCtx + isMethodSymbol back.

import ts from "typescript";
import { ice } from "../diagnostics.js";
import { VT } from "../hir/types.js";
import type { ValueType } from "../hir/types.js";
import { type LowerCtx, isMethodSymbol } from "./lower.js";

export function arrayElementType(t: ts.Type, checker: ts.TypeChecker): ts.Type | undefined {
  const ref = t as ts.TypeReference;
  if (ref.symbol?.name === "Array") {
    const args = checker.getTypeArguments(ref);
    if (args.length === 1) return args[0];
  }
  return undefined;
}

export function valueTypeOf(node: ts.Node, ctx: LowerCtx): ValueType {
  return valueTypeOfTsType(ctx.checker.getTypeAtLocation(node), node, ctx.checker);
}

// Collect a class's DATA fields in BASE-FIRST declaration order into `out` (name → type),
// recursing into base classes before adding the class's own fields. First writer wins, so an
// inherited field keeps its base-class slot even if mentioned again. Methods are excluded.
function collectClassDataFields(
  t: ts.Type,
  node: ts.Node,
  checker: ts.TypeChecker,
  out: Map<string, ValueType>,
): void {
  for (const base of checker.getBaseTypes(t as ts.InterfaceType)) {
    const bd = base.symbol?.valueDeclaration;
    if (bd && ts.isClassDeclaration(bd)) collectClassDataFields(base, node, checker, out);
  }
  const decl = t.symbol?.valueDeclaration;
  if (!decl || !ts.isClassDeclaration(decl)) return;
  for (const m of decl.members) {
    if (!ts.isPropertyDeclaration(m) || !ts.isIdentifier(m.name)) continue;
    if (out.has(m.name.text)) continue;
    const sym = checker.getSymbolAtLocation(m.name)!;
    let ft = valueTypeOfTsType(checker.getTypeOfSymbolAtLocation(sym, node), node, checker);
    if (sym.flags & ts.SymbolFlags.Optional && ft.kind !== "optional") {
      ft = { kind: "optional", inner: ft };
    }
    out.set(m.name.text, ft);
  }
}

// Object ValueTypes are memoized by their tsc type. This is what makes a RECURSIVE type
// representable: `interface Node { next: Node | null }` would otherwise expand its field types
// forever. Registering the (still empty) result BEFORE filling in the fields means the recursive
// field resolves to the very same object, so the ValueType graph becomes cyclic rather than
// infinite — which is exactly what the runtime does, since a field holding an object is just a
// pointer slot. Consumers must therefore never walk a shape unboundedly (see inspect's depth cap).
// A WeakMap keyed on ts.Type is safe across compilations: types belong to one Program.
const objectShapeCache = new WeakMap<ts.Type, ValueType>();

// Structural comparison with a depth bound. Object ValueTypes can be cyclic (see
// objectShapeCache), so an unbounded structural walk would not terminate; beyond the bound two
// types are treated as matching, which is safe here because the caller only needs to know that a
// tuple's elements share ONE runtime representation, and representation is decided by `kind` plus
// the field layout near the surface.
function sameRepresentation(a: ValueType, b: ValueType, depth = 0): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;
  if (depth >= 4) return true;
  if (a.kind === "object" && b.kind === "object") {
    if (a.shape.fields.length !== b.shape.fields.length) return false;
    return a.shape.fields.every((f, i) => {
      const g = b.shape.fields[i]!;
      return f.name === g.name && sameRepresentation(f.type, g.type, depth + 1);
    });
  }
  if (a.kind === "array" && b.kind === "array") {
    return sameRepresentation(a.element, b.element, depth + 1);
  }
  if (a.kind === "optional" && b.kind === "optional") {
    return sameRepresentation(a.inner, b.inner, depth + 1);
  }
  return true;
}

export function valueTypeOfTsType(t: ts.Type, node: ts.Node, checker: ts.TypeChecker): ValueType {
  const flags = t.flags;
  if (flags & ts.TypeFlags.NumberLike) return VT.number;
  if (flags & ts.TypeFlags.StringLike) return VT.string;
  if (flags & ts.TypeFlags.BooleanLike) return VT.boolean;
  if (flags & ts.TypeFlags.Null) return VT.null;
  if (flags & ts.TypeFlags.Undefined) return VT.undefined;
  // `unknown` currently occurs only as a `catch (e)` binding (useUnknownInCatchVariables).
  if (flags & ts.TypeFlags.Unknown) return VT.unknown;
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
    // A tuple `[T, T, …]` is an array at runtime (this is how `Promise.all`'s tuple result becomes a
    // usable `T[]`). Our arrays are single-element-type, so require a homogeneous tuple; a
    // heterogeneous one (`[number, string]`) would need a union element and is out of the subset.
    if (checker.isTupleType(t)) {
      const args = checker.getTypeArguments(ref);
      if (args.length === 0) ice("empty tuple type has no element type");
      const elems = args.map((a) => valueTypeOfTsType(a, node, checker));
      const first = elems[0]!;
      // Compared structurally with a depth bound rather than JSON.stringify: a recursive object
      // ValueType is a CYCLIC graph, which JSON.stringify throws on.
      if (!elems.every((e) => sameRepresentation(e, first))) {
        ice("heterogeneous tuple types are not supported (use a single element type)");
      }
      return VT.array(first);
    }
    // `Map<K, V>`: two type arguments.
    if (ref.symbol?.name === "Map") {
      const args = checker.getTypeArguments(ref);
      if (args.length === 2) {
        return VT.map(
          valueTypeOfTsType(args[0]!, node, checker),
          valueTypeOfTsType(args[1]!, node, checker),
        );
      }
    }
    // `Set<T>`: one type argument.
    if (ref.symbol?.name === "Set") {
      const args = checker.getTypeArguments(ref);
      if (args.length === 1) return VT.set(valueTypeOfTsType(args[0]!, node, checker));
    }
    // `Promise<T>`: the result of an async call. `Promise<void>`'s inner is modeled as `undefined`
    // (don't recurse into the `void` type, which has no ValueType).
    if (ref.symbol?.name === "Promise") {
      const a = checker.getTypeArguments(ref)[0];
      const inner =
        a && !(a.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined))
          ? valueTypeOfTsType(a, node, checker)
          : VT.undefined;
      return VT.promise(inner);
    }
    // A closed object shape (interface / type literal / class instance). Its DATA properties
    // become record slots — methods are dispatched to functions, not stored. A class instance's
    // `className` enables method dispatch.
    const classDecl = t.symbol?.valueDeclaration;
    const isClass = classDecl !== undefined && ts.isClassDeclaration(classDecl);
    if (isClass) {
      const hit = objectShapeCache.get(t);
      if (hit) return hit;
      // Class instance: lay fields out BASE-FIRST (a subclass record is a prefix-compatible
      // superset of its base), so a derived instance is usable through a base-typed reference.
      // getPropertiesOfType returns derived-first, so walk the heritage chain ourselves.
      const result: ValueType = {
        kind: "object",
        shape: { fields: [] },
        className: t.symbol!.name,
      };
      objectShapeCache.set(t, result);
      const ordered = new Map<string, ValueType>();
      collectClassDataFields(t, node, checker, ordered);
      if (result.kind !== "object") ice("object shape placeholder was replaced");
      for (const [name, type] of ordered) result.shape.fields.push({ name, type });
      return result;
    }
    const props = checker.getPropertiesOfType(t).filter((sym) => !isMethodSymbol(sym));
    if (props.length > 0) {
      const hit = objectShapeCache.get(t);
      if (hit) return hit;
      const result: ValueType = { kind: "object", shape: { fields: [] } };
      objectShapeCache.set(t, result);
      for (const sym of props) {
        let ft = valueTypeOfTsType(checker.getTypeOfSymbolAtLocation(sym, node), node, checker);
        // With exactOptionalPropertyTypes, `x?: T` has type T; the `?` is a symbol flag. Model
        // it as optional<T> so an omitted field stores `undefined`.
        if (sym.flags & ts.SymbolFlags.Optional && ft.kind !== "optional") {
          ft = { kind: "optional", inner: ft };
        }
        if (result.kind !== "object") ice("object shape placeholder was replaced");
        result.shape.fields.push({ name: sym.name, type: ft });
      }
      return result;
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
export function returnTypeOf(decl: ts.FunctionDeclaration, ctx: LowerCtx): ValueType | null {
  return returnTypeOfSignature(decl, ctx);
}

export function returnTypeOfSignature(
  decl: ts.FunctionDeclaration | ts.MethodDeclaration | ts.ConstructorDeclaration,
  ctx: LowerCtx,
): ValueType | null {
  const sig = ctx.checker.getSignatureFromDeclaration(decl);
  if (!sig) return ice("lower: could not resolve signature");
  const ret = ctx.checker.getReturnTypeOfSignature(sig);
  if (ret.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) return null;
  return valueTypeOfTsType(ret, decl, ctx.checker);
}
