// Runtime shapes: one immutable global per allocation layout (HModule.shapes). Every object record
// is `[shape pointer, field 0 Value, field 1 Value, ...]`, so a record can be read correctly through
// any static type: the shape names its fields (inline-cache misses, Object.keys), points at the
// functions that print and serialize this layout (shape-functions.ts) and, for a class instance,
// carries the class identity and the method table (virtual dispatch, instanceof).

import { ice } from "../diagnostics.js";
import type { ModuleBuilder, Value } from "../ir/builder.js";
import { imm } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { ShapeDescriptor } from "../hir/nodes.js";
import { classDisplayName, type ValueType } from "../hir/types.js";
import type { Ctx } from "./expr.js";

// CsShape (runtime/abi.milo), one 8-byte word per field, in this order. The test in
// tests/unit/shape-abi.test.ts reads abi.milo and compares it to this list.
export const SHAPE_FIELDS = [
  "fieldCount",
  "names",
  "kinds",
  "className",
  "methodCount",
  "methods",
  "methodNames",
  "inspect",
  "json",
] as const;
const SHAPE_WORD = Object.fromEntries(SHAPE_FIELDS.map((f, i) => [f, i])) as Record<
  (typeof SHAPE_FIELDS)[number],
  number
>;

// Record slot 0 is the shape pointer; field i lives at slot i + 1.
export const RECORD_HEADER_SLOTS = 1;

// Per-slot kind codes stored in a shape (CsShape.kinds). Mirrors KIND_* in runtime/abi.milo.
export const KIND_CODE: Record<ValueType["kind"], number> = {
  number: 1,
  string: 2,
  boolean: 3,
  null: 4,
  undefined: 5,
  array: 6,
  object: 7,
  optional: 8,
  function: 9,
  map: 10,
  set: 11,
  unknown: 12,
  promise: 13,
  opaque: 14,
};

export function shapeGlobalName(id: number): string {
  return `shape.${id}`;
}

export function shapeRef(ctx: Ctx, id: number): Value {
  return ctx.mod.globalRef(shapeGlobalName(id));
}

export function emitShapes(mod: ModuleBuilder, shapes: readonly ShapeDescriptor[]): void {
  shapes.forEach((s, i) => {
    if (s.id !== i) ice(`shape ${s.id} is out of order (index ${i})`);
    const base = shapeGlobalName(s.id);
    const names = mod.definePtrArray(
      `${base}.names`,
      s.fields.map((f) => mod.internedString(f.name)),
    );
    const kinds = mod.defineByteArray(
      `${base}.kinds`,
      s.fields.map((f) => KIND_CODE[f.type.kind]),
    );
    const methods = mod.definePtrArray(
      `${base}.methods`,
      s.methods.map((m) => mod.globalRef(m.fn)),
    );
    const methodNames = mod.definePtrArray(
      `${base}.methodNames`,
      s.methods.map((m) => mod.internedString(m.name)),
    );
    const className =
      s.className !== undefined
        ? mod.internedString(classDisplayName(s.className))
        : { name: "null", type: T.ptr };
    const words: Record<(typeof SHAPE_FIELDS)[number], Value> = {
      fieldCount: imm(T.i64, s.fields.length),
      names,
      kinds,
      className,
      methodCount: imm(T.i64, s.methods.length),
      methods,
      methodNames,
      inspect: mod.globalRef(`${base}.inspect`),
      json: mod.globalRef(`${base}.json`),
    };
    mod.defineShape(
      base,
      SHAPE_FIELDS.map((f) => words[f]),
    );
  });
}

// The shape pointer of an object record.
export function loadShape(obj: Value, ctx: Ctx): Value {
  return ctx.fn.load(T.ptr, ctx.fn.gepSlot(obj, 0));
}

// Load word `field` of a shape (the struct is all 8-byte words, so a slot GEP addresses it).
export function loadShapeWord(shape: Value, field: (typeof SHAPE_FIELDS)[number], ctx: Ctx): Value {
  const type = field === "fieldCount" || field === "methodCount" ? T.i64 : T.ptr;
  return ctx.fn.load(type, ctx.fn.gepSlot(shape, SHAPE_WORD[field]));
}

// Allocate a zeroed record for `fieldCount` fields and store its shape. Zeroed field slots read as
// `undefined` (Value 0) until assigned.
export function allocRecord(shapeId: number, fieldCount: number, ctx: Ctx): Value {
  const rec = ctx.fn.call("@cs_gc_alloc", T.ptr, [
    imm(T.i64, (fieldCount + RECORD_HEADER_SLOTS) * 8),
  ]);
  ctx.fn.store(shapeRef(ctx, shapeId), ctx.fn.gepSlot(rec, 0));
  return rec;
}
