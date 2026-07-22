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
  | { kind: "function"; params: ValueType[]; ret: ValueType | null };

export const VT = {
  number: { kind: "number" } as ValueType,
  string: { kind: "string" } as ValueType,
  boolean: { kind: "boolean" } as ValueType,
  null: { kind: "null" } as ValueType,
  undefined: { kind: "undefined" } as ValueType,
  array: (element: ValueType): ValueType => ({ kind: "array", element }),
} as const;
