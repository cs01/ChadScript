// TS-type → ValueType translation: the single place the checker's structural types are mapped to
// the compiler's machine representation (number/string/array/object/map/set/function/optional).
// Split out of lower.ts; it queries the checker directly and imports LowerCtx + isMethodSymbol back.

import ts from "typescript";
import { classIdOf } from "./class-ids.js";
import { ice } from "../diagnostics.js";
import { ANY_OBJECT, VALUE_ANY, VT, optionalOf } from "../hir/types.js";
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

// A type the value domain cannot represent. Thrown by valueTypeOfTsType so that ONE definition of
// "representable" serves both the validator (which turns this into a coded, spanned rejection
// before lowering runs) and the lowerer (where escaping it is a compiler bug). Duplicating the
// predicate in the validator would let the two drift — the same failure mode that let a construct
// work as an expression and miscompile as a statement.
// The names the ambient environment declares as opaque handles. A type matches only when its
// symbol is declared in stdlib/globals.d.ts, so a user-defined `Timeout` is an ordinary object.
const OPAQUE_HANDLE_NAMES = new Set(["Timeout"]);

function opaqueHandleName(t: ts.Type): string | null {
  const sym = t.getSymbol() ?? t.aliasSymbol;
  const name = sym?.getName();
  if (!name || !OPAQUE_HANDLE_NAMES.has(name)) return null;
  const decl = sym?.declarations?.[0];
  if (!decl || !decl.getSourceFile().fileName.endsWith("stdlib/globals.d.ts")) return null;
  return name;
}

export class UnrepresentableTypeError extends Error {
  constructor(
    readonly reason: string,
    readonly suggestion: string,
  ) {
    super(reason);
    this.name = "UnrepresentableTypeError";
  }
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
    if (sym.flags & ts.SymbolFlags.Optional) ft = optionalOf(ft);
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
  if (a.kind === "set" && b.kind === "set")
    return sameRepresentation(a.element, b.element, depth + 1);
  if (a.kind === "promise" && b.kind === "promise") {
    return sameRepresentation(a.inner, b.inner, depth + 1);
  }
  if (a.kind === "map" && b.kind === "map") {
    return (
      sameRepresentation(a.key, b.key, depth + 1) && sameRepresentation(a.value, b.value, depth + 1)
    );
  }
  // A closure is called with its parameters in their machine representations, so two function
  // types agree only when every parameter and the result do.
  if (a.kind === "function" && b.kind === "function") {
    if (a.params.length !== b.params.length || (a.ret === null) !== (b.ret === null)) return false;
    if (!a.params.every((p, i) => sameRepresentation(p, b.params[i]!, depth + 1))) return false;
    return a.ret === null || sameRepresentation(a.ret, b.ret!, depth + 1);
  }
  if (a.kind === "value" && b.kind === "value") {
    return (
      a.members.length === b.members.length &&
      a.members.every((m) => {
        const o = b.members.find((n) => n.kind === m.kind);
        return o !== undefined && sameRepresentation(m, o, depth + 1);
      })
    );
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
  // Opaque runtime handles, recognized by NAME + declaring file so a user interface that happens
  // to be called `Timeout` is unaffected. MUST precede the Object branch: the handle is nominally
  // an interface, and structural handling would recurse into its `unique symbol` brand member.
  const opaque = opaqueHandleName(t);
  if (opaque !== null) return VT.opaque(opaque);
  if (flags & ts.TypeFlags.TypeParameter) return typeParameterType(t, node, checker);
  // `T & number` is what tsc narrows a type parameter to (`typeof x === "number"`): the value is
  // whatever the non-parameter part says. Any other intersection has no representation.
  if (flags & ts.TypeFlags.Intersection) {
    // `x !== undefined` narrows `T | undefined` to `T & ({} | null)`: the `{}` part only says
    // "not nullish" and changes no representation.
    const isEmptyObject = (m: ts.Type): boolean =>
      (m.flags & ts.TypeFlags.Object) !== 0 &&
      checker.getPropertiesOfType(m).length === 0 &&
      checker.getSignaturesOfType(m, ts.SignatureKind.Call).length === 0;
    const onlyNonNullish = (m: ts.Type): boolean =>
      isEmptyObject(m) ||
      (m.isUnion() &&
        m.types.every(
          (u) => isEmptyObject(u) || (u.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) !== 0,
        ));
    const rest = (t as ts.IntersectionType).types.filter(
      (m) => !(m.flags & ts.TypeFlags.TypeParameter) && !onlyNonNullish(m),
    );
    if (rest.length === 1) return valueTypeOfTsType(rest[0]!, node, checker);
    const params = (t as ts.IntersectionType).types.filter(
      (m) => m.flags & ts.TypeFlags.TypeParameter,
    );
    if (rest.length === 0 && params.length === 1) {
      return typeParameterType(params[0]!, node, checker);
    }
    if (rest.length === 0) return VALUE_ANY;
    throw new UnrepresentableTypeError(
      "an intersection type (`A & B`)",
      "declare one interface with every field instead",
    );
  }

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
          collectionKey(valueTypeOfTsType(args[0]!, node, checker)),
          valueTypeOfTsType(args[1]!, node, checker),
        );
      }
    }
    // `Set<T>`: one type argument.
    if (ref.symbol?.name === "Set") {
      const args = checker.getTypeArguments(ref);
      if (args.length === 1) {
        return VT.set(collectionKey(valueTypeOfTsType(args[0]!, node, checker)));
      }
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
        className: classIdOf(classDecl),
      };
      objectShapeCache.set(t, result);
      const ordered = new Map<string, ValueType>();
      collectClassDataFields(t, node, checker, ordered);
      if (result.kind !== "object") ice("object shape placeholder was replaced");
      for (const [name, type] of ordered) result.shape.fields.push({ name, type });
      return result;
    }
    // An interface with only methods (`{ area(): number }`) is still an object: its values are
    // records whose methods are found by name through their shapes.
    const all = checker.getPropertiesOfType(t);
    const props = all.filter((sym) => !isMethodSymbol(sym));
    if (all.length > 0) {
      const hit = objectShapeCache.get(t);
      if (hit) return hit;
      const result: ValueType = { kind: "object", shape: { fields: [] } };
      objectShapeCache.set(t, result);
      for (const sym of props) {
        let ft = valueTypeOfTsType(checker.getTypeOfSymbolAtLocation(sym, node), node, checker);
        // With exactOptionalPropertyTypes, `x?: T` has type T; the `?` is a symbol flag. Model
        // it as optional<T> so an omitted field stores `undefined`.
        if (sym.flags & ts.SymbolFlags.Optional) ft = optionalOf(ft);
        if (result.kind !== "object") ice("object shape placeholder was replaced");
        result.shape.fields.push({ name: sym.name, type: ft });
      }
      return result;
    }
  }
  // Narrowing produces unions (e.g. `switch (n) { case 0: case 1: }` narrows n to `0 | 1`). A
  // union of same-representation members collapses to that type; a union of `inner`+null/undefined
  // becomes `optional`; a union of members with different representations is a Value union.
  if (flags & ts.TypeFlags.Union) {
    const members = (t as ts.UnionType).types.map((m) => valueTypeOfTsType(m, node, checker));
    // A member that is itself a Value (an erased `T` in `T | undefined`) contributes its members.
    if (members.some((m) => m.kind === "value")) {
      return valueUnion(members.flatMap((m) => (m.kind === "value" ? m.members : [m])));
    }
    const nullish = members.filter((m) => m.kind === "undefined" || m.kind === "null");
    const rest = members.filter((m) => m.kind !== "undefined" && m.kind !== "null");
    const restFirst = rest[0];
    if (restFirst && rest.every((m) => m.kind === restFirst.kind)) {
      // A union of object types (`{ kind: "c"; r } | { kind: "s"; w }`) is one object type whose
      // fields are the members' COMMON properties, each typed as the union of the members' types.
      // Access through it is layout-driven like any object; narrowing (`s.kind === "c"`) gives tsc a
      // member type.
      if (restFirst.kind === "object") {
        const inner = rest.some((m) => m !== restFirst)
          ? objectUnion(checker.getNonNullableType(t), node, checker)
          : restFirst;
        // `inner | undefined | null` → optional<inner>; pure `inner | inner` → inner.
        return nullish.length > 0 ? { kind: "optional", inner } : inner;
      }
      // Same kind AND same representation (`1 | 2`, `"a" | "b"`, `true | false`). Two array types
      // with different element types share a kind but not a representation, so they fall through.
      if (rest.every((m) => sameRepresentation(m, restFirst))) {
        return nullish.length > 0 ? { kind: "optional", inner: restFirst } : restFirst;
      }
    }
    return valueUnion(members);
  }
  throw new UnrepresentableTypeError(
    `a type the value domain has no representation for (type flags ${flags})`,
    "use a supported type: number, string, boolean, arrays, closed objects, Map/Set, or `T | undefined`",
  );
}

// A type parameter, erased (PLAN value model item 4): one compiled body serves every
// instantiation. Unconstrained, it is VALUE_ANY. Constrained to one representation (`T extends
// Named`, `T extends string`), every instantiation already has that representation, so T takes it:
// an object-constrained T is a record pointer whose fields are read by name through its shape (its
// static type reaches no layout, lower/layouts.ts), which is what makes `x.name` exact whatever
// layout the caller passes.
function typeParameterType(t: ts.Type, node: ts.Node, checker: ts.TypeChecker): ValueType {
  const c = checker.getBaseConstraintOfType(t);
  if (!c || c === t || c.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any)) return VALUE_ANY;
  const vt = valueTypeOfTsType(c, node, checker);
  switch (vt.kind) {
    case "number":
    case "string":
    case "boolean":
    case "object":
      return vt;
    case "value":
      if (vt.members.every((m) => VALUE_ANY_KINDS.has(m.kind))) return vt;
      break;
    default:
      break;
  }
  throw new UnrepresentableTypeError(
    "a type parameter constrained to a container or function type",
    "constrain it to an object type (`T extends { items: number[] }`) or leave it unconstrained",
  );
}

const VALUE_ANY_KINDS = new Set(
  VALUE_ANY.kind === "value" ? VALUE_ANY.members.map((m) => m.kind) : [],
);

// A Map key / Set element type. The runtime hashes and compares keys by one fixed kind (number,
// string or boolean); a Value union key would need a kind-dispatching hash, which does not exist.
function collectionKey(t: ValueType): ValueType {
  if (t.kind === "value") {
    throw new UnrepresentableTypeError(
      "a Map key or Set element that is a union of different kinds",
      "key the collection by one kind (convert with `String(k)`), or keep one collection per kind",
    );
  }
  return t;
}

// The Value union over `members` (already translated). Members are deduplicated by kind; object
// members collapse to ANY_OBJECT (see hir/types.ts). Each remaining tag must identify ONE
// representation, because the tag is all the runtime has: `number[] | string[]` would leave a
// printed or narrowed array with no way to tell its element type.
function valueUnion(members: ValueType[]): ValueType {
  const out: ValueType[] = [];
  for (const m of members) {
    switch (m.kind) {
      case "value":
      case "optional":
        // tsc flattens unions, so a member is never itself a union.
        return ice(`valueUnion: nested ${m.kind} member`);
      case "unknown":
      case "opaque":
      case "promise":
        throw new UnrepresentableTypeError(
          `a union with a ${m.kind === "opaque" ? m.name : m.kind === "promise" ? "Promise" : "caught (unknown)"} member`,
          "keep the handle in its own variable, apart from the union",
        );
      case "object":
        if (!out.some((o) => o.kind === "object")) out.push(ANY_OBJECT);
        continue;
      case "number":
      case "string":
      case "boolean":
      case "null":
      case "undefined":
      case "array":
      case "function":
      case "map":
      case "set": {
        const prev = out.find((o) => o.kind === m.kind);
        if (prev === undefined) {
          out.push(m);
        } else if (!sameRepresentation(prev, m)) {
          throw new UnrepresentableTypeError(
            `a union of two ${m.kind === "array" ? "array" : m.kind} types with different element or parameter types`,
            "a value cannot tell them apart at run time; use one element type (e.g. `(number | string)[]`) or wrap each arm in an object with a tag field",
          );
        }
        continue;
      }
      default: {
        const never: never = m;
        return ice(`valueUnion: unhandled ${(never as { kind: string }).kind}`);
      }
    }
  }
  return { kind: "value", members: out };
}

function objectUnion(t: ts.Type, node: ts.Node, checker: ts.TypeChecker): ValueType {
  const hit = objectShapeCache.get(t);
  if (hit) return hit;
  const result: ValueType = { kind: "object", shape: { fields: [] } };
  objectShapeCache.set(t, result);
  for (const sym of checker.getPropertiesOfType(t)) {
    if (isMethodSymbol(sym)) continue;
    let ft = valueTypeOfTsType(checker.getTypeOfSymbolAtLocation(sym, node), node, checker);
    if (sym.flags & ts.SymbolFlags.Optional) ft = optionalOf(ft);
    result.shape.fields.push({ name: sym.name, type: ft });
  }
  return result;
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
