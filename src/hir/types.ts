// Resolved semantic types carried by HIR nodes. This is the SOURCE-level type domain (what a
// value *is* in the language), distinct from ir/types.ts (what it is on the machine). Codegen
// maps ValueType → IrType. Grows one variant per phase; consumers switch+ice on it so a new
// variant with a missing case crashes loud.
//
// Deliberately NOT an interned TypeId table yet — that lands when passes over HIR need it.
// The discipline that matters now is that every HIR expression HAS a resolved type here,
// stamped by the lower pass, so the backend never asks the checker anything.

export interface ObjectField {
  name: string;
  type: ValueType;
}

// A closed object shape: an ordered field list. Field i lives at record slot i. Structural
// identity is the ordered (name, type) list.
export interface ObjectShape {
  fields: ObjectField[];
}

export type ValueType =
  | { kind: "number" }
  | { kind: "string" }
  | { kind: "boolean" }
  | { kind: "null" }
  | { kind: "undefined" }
  // A homogeneous array. Represented at runtime as a pointer to a uniform slot array; `element`
  // says how to box/unbox each slot.
  | { kind: "array"; element: ValueType }
  // A closed-shape object. Runtime rep: pointer to a GC record of one i64 slot per field.
  // `className` is set for class instances (enables method dispatch to `Class.method`); unset
  // for plain interface/type-literal objects.
  | { kind: "object"; shape: ObjectShape; className?: string }
  // `inner | undefined` (from `arr[i]`, `.pop()`, optional fields). Runtime rep: a pointer that
  // is either the `undefined` sentinel or a pointer to a GC box holding the boxed inner value.
  | { kind: "optional"; inner: ValueType }
  // A first-class function value (closure). Runtime rep: a pointer to a GC record {fnptr, env}.
  | { kind: "function"; params: ValueType[]; ret: ValueType | null }
  // A `Map<K, V>`. Runtime rep: pointer to a CsMap (parallel key/value slot buffers). `key`
  // must be a primitive (number/string/boolean) — its kind selects the equality function.
  | { kind: "map"; key: ValueType; value: ValueType }
  // A `Set<T>`. Runtime rep: pointer to a CsSet. `element` must be a primitive.
  | { kind: "set"; element: ValueType }
  // `unknown` — currently only the value bound by `catch (e)`. Runtime rep: pointer to a CsThrown
  // ({isError, message}). Usable via `String(e)` and `e instanceof Error`; not printable directly.
  | { kind: "unknown" }
  // `Promise<T>` — the result of an async-function call. Runtime rep: pointer to a runtime Promise
  // (see runtime/async.c). `await` unwraps it to `inner`; the value crosses as a boxed i64 slot.
  | { kind: "promise"; inner: ValueType }
  // An OPAQUE runtime handle: a pointer the program may hold and hand back to the runtime, with no
  // other operations. Exists because Node's setTimeout returns a `Timeout` OBJECT — any printable
  // stand-in (a number, an empty record) would diverge the moment a program logged it, so the type
  // carries "you may store this and pass it back, nothing else" into the type domain, and the
  // validator enforces exactly that (CS1234).
  | { kind: "opaque"; name: string };

export const VT = {
  number: { kind: "number" } as ValueType,
  string: { kind: "string" } as ValueType,
  boolean: { kind: "boolean" } as ValueType,
  null: { kind: "null" } as ValueType,
  undefined: { kind: "undefined" } as ValueType,
  unknown: { kind: "unknown" } as ValueType,
  opaque: (name: string): ValueType => ({ kind: "opaque", name }),
  array: (element: ValueType): ValueType => ({ kind: "array", element }),
  map: (key: ValueType, value: ValueType): ValueType => ({ kind: "map", key, value }),
  set: (element: ValueType): ValueType => ({ kind: "set", element }),
  promise: (inner: ValueType): ValueType => ({ kind: "promise", inner }),
} as const;
