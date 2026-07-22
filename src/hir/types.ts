// Resolved semantic types carried by HIR nodes. This is the SOURCE-level type domain (what a
// value *is* in the language), distinct from ir/types.ts (what it is on the machine). Codegen
// maps ValueType → IrType. Grows one variant per phase; consumers switch+ice on it so a new
// variant with a missing case crashes loud.
//
// Deliberately NOT an interned TypeId table yet — that lands when passes over HIR need it.
// The discipline that matters now is that every HIR expression HAS a resolved type here,
// stamped by the lower pass, so the backend never asks the checker anything.

export type ValueType =
  | { kind: "number" }
  | { kind: "string" }
  | { kind: "boolean" }
  | { kind: "null" }
  | { kind: "undefined" };

export const VT = {
  number: { kind: "number" } as ValueType,
  string: { kind: "string" } as ValueType,
  boolean: { kind: "boolean" } as ValueType,
  null: { kind: "null" } as ValueType,
  undefined: { kind: "undefined" } as ValueType,
} as const;
