// GC allocation from generated IR. Every heap object carries a one-word header, written by the
// allocator just before the object, that tells the collector (runtime/gc.milo) which of its words
// can hold heap pointers. The heap is traced precisely through these headers; only the roots
// (stacks, registers, static data) are scanned conservatively. So the header must be exact:
// naming a pointer slot atomic frees a live object, which is why the layout decision is made here
// from the slot's static type and never guessed.
//
// Header word (pinned to runtime/gc.milo by tests/unit/shape-abi.test.ts):
//   bits 0..7    kind (GC_KIND)
//   bits 8..31   struct kind only: bit i set = word i may hold a pointer or Value
//   bits 32..63  payload size in bytes (the header itself not included)

import { ice } from "../diagnostics.js";
import { imm, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { ValueType } from "../hir/types.js";
import type { Ctx } from "./expr.js";

export const GC_KIND = {
  // never scanned: bytes, doubles, booleans
  atomic: 1,
  // every word is a slot that may be a pointer (raw or tagged), a Value, or a scalar
  values: 2,
  // an object record: word 0 is the shape, whose per-field kinds say which fields to trace
  record: 3,
  // a fixed layout: the header's bitmap names the traced words
  struct: 4,
  // saved machine state (ucontext, jmp_buf): every word scanned conservatively
  conservative: 5,
} as const;

// The widest layout a struct header's bitmap describes; wider slot lists fall back to `values`.
export const STRUCT_MAP_WORDS = 24;

export function gcHeader(kind: number, size: number, ptrMap = 0): string {
  if (!Number.isInteger(size) || size < 0 || size >= 2 ** 31) ice(`gc header: bad size ${size}`);
  if (ptrMap < 0 || ptrMap >= 2 ** STRUCT_MAP_WORDS) ice(`gc header: bad pointer map ${ptrMap}`);
  return ((BigInt(size) << 32n) | (BigInt(ptrMap) << 8n) | BigInt(kind)).toString();
}

function alloc(header: string, ctx: Ctx): Value {
  return ctx.fn.call("@cs_alloc", T.ptr, [imm(T.i64, header)]);
}

// Whether a slot of this type (its machine representation, see expr.ts boxSlot) can hold a heap
// pointer. Numbers are raw IEEE bits and booleans 0/1: tracing either as a pointer would be a
// guess, which a precise heap does not make.
export function slotMayPoint(type: ValueType): boolean {
  switch (type.kind) {
    case "number":
    case "boolean":
    case "null":
    case "undefined":
      return false;
    case "string":
    case "array":
    case "object":
    case "optional":
    case "function":
    case "map":
    case "set":
    case "unknown":
    case "promise":
    case "opaque":
    case "value":
      return true;
    default: {
      const never: never = type;
      return ice(`slotMayPoint: unhandled ${(never as { kind: string }).kind}`);
    }
  }
}

// A block of 8-byte slots, one per entry of `pointers` (true = may hold a pointer): a closure
// env, an async call's argument env, a scratch array.
export function allocSlots(pointers: readonly boolean[], ctx: Ctx): Value {
  const size = Math.max(pointers.length, 1) * 8;
  if (!pointers.some((p) => p)) return alloc(gcHeader(GC_KIND.atomic, size), ctx);
  if (pointers.length > STRUCT_MAP_WORDS) return alloc(gcHeader(GC_KIND.values, size), ctx);
  const map = pointers.reduce((m, p, i) => (p ? m | (1 << i) : m), 0);
  return alloc(gcHeader(GC_KIND.struct, size, map), ctx);
}

// One slot holding a value of `type` (an optional's box, a cell).
export function allocSlotBox(type: ValueType, ctx: Ctx): Value {
  return allocSlots([slotMayPoint(type)], ctx);
}

// An object record: the shape word plus `fieldCount` field slots, traced per the shape's kinds.
export function allocRecordWords(fieldCount: number, ctx: Ctx): Value {
  return alloc(gcHeader(GC_KIND.record, (fieldCount + 1) * 8), ctx);
}

// A closure record {fnptr, env, display}: fnptr is code, env and display may be heap pointers.
export function allocClosureRecord(ctx: Ctx): Value {
  return alloc(gcHeader(GC_KIND.struct, 24, 0b110), ctx);
}
