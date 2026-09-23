// util.inspect formatting for console.log of a non-scalar value (array/object/map/set) and its
// nested contents. Node prints containers with a specific layout — `[ 1, 2 ]`, `{ x: 1 }`,
// `Map(1) { 'k' => 2 }` — and quotes strings only when they are NESTED inside a container (a
// top-level string prints raw). This module builds that string at runtime from the value + its
// resolved ValueType (the type tells us how to format, recursively). An OBJECT is formatted by its
// own shape's inspect function (codegen/shape-functions.ts), never by the static type it is read
// through, so a value typed as an interface prints the fields it really has, as Node does.
//
// Codegen only formats the ENTRIES of a container (it knows the types); how they are laid out
// (line breaking, column grouping, indentation, cycles) is runtime/inspect.milo's job, reached
// through formatContainer.

import { ice } from "../diagnostics.js";
import { imm, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { ValueType } from "../hir/types.js";
import { unboxSlot, type Ctx } from "./expr.js";
import { loadShape, loadShapeWord } from "./shapes.js";
import { V_NULL, V_UNDEFINED, isNumberWord, unboxValue } from "./value.js";
import { inspectValue } from "./value-ops.js";

// Node's util.inspect stops descending at its `depth` option and prints a placeholder for anything
// deeper. The nesting is a run-time value because objects dispatch through their shapes, and it is
// what makes a recursive structure printable at all. The limit is run-time too
// (cs_insp_max_depth): 2 for console.log, 0 for util.format's %s, 4 for %o.

// Node's maxArrayLength: an array, Map or Set shows this many entries, then `... N more items`.
const MAX_SHOWN = 100;

// A string Value for the inspect form of `value` (of type `type`) at nesting `depth` (an i32
// Value). Strings are quoted here (the nested context); the top-level raw-string case is handled
// by the caller.
export function inspect(value: Value, type: ValueType, ctx: Ctx, depth: Value): Value {
  switch (type.kind) {
    case "number":
      return ctx.fn.call("@cs_inspect_num", T.ptr, [value]);
    case "string":
      return ctx.fn.call("@cs_inspect_str", T.ptr, [value, depth]);
    case "boolean":
      return ctx.fn.call("@cs_bool_to_string", T.ptr, [ctx.fn.zextI1ToI32(value)]);
    case "null":
      return ctx.mod.cstring("null");
    case "undefined":
      return ctx.mod.cstring("undefined");
    case "optional":
      return inspectOptional(value, type.inner, ctx, depth);
    case "array":
      return inspectArray(value, type.element, ctx, depth);
    case "object": {
      // The shape's inspect function handles its own depth cutoff (it knows the class name).
      const fn = loadShapeWord(loadShape(value, ctx), "inspect", ctx);
      return ctx.fn.callIndirect(fn, T.ptr, [value, depth]);
    }
    case "map":
      return inspectMap(value, type.key, type.value, ctx, depth);
    case "set":
      return inspectSet(value, type.element, ctx, depth);
    case "function":
      // Word 2 of a closure record is its display text (see evalClosure).
      return ctx.fn.load(T.ptr, ctx.fn.gepSlot(value, 2));
    case "value":
      return inspectValue(value, type, ctx, depth);
    default:
      return ice(`inspect: cannot format ${type.kind}`);
  }
}

// The inspect form of a field Value stored with static type `type` (an allocation's field type).
// A nullish Value prints its word directly, so an optional field needs no box.
export function inspectStored(raw: Value, type: ValueType, ctx: Ctx, depth: Value): Value {
  switch (type.kind) {
    case "null":
      return ctx.mod.cstring("null");
    case "undefined":
      return ctx.mod.cstring("undefined");
    case "optional": {
      const result = ctx.fn.alloca(T.ptr);
      const undefB = ctx.fn.newBlock("insp.undef");
      const notUndefB = ctx.fn.newBlock("insp.notundef");
      const nullB = ctx.fn.newBlock("insp.null");
      const valB = ctx.fn.newBlock("insp.val");
      const endB = ctx.fn.newBlock("insp.end");
      ctx.fn.brCond(ctx.fn.icmp("eq", raw, imm(T.i64, V_UNDEFINED)), undefB, notUndefB);
      ctx.fn.switchTo(undefB);
      ctx.fn.store(ctx.mod.cstring("undefined"), result);
      ctx.fn.br(endB);
      ctx.fn.switchTo(notUndefB);
      ctx.fn.brCond(ctx.fn.icmp("eq", raw, imm(T.i64, V_NULL)), nullB, valB);
      ctx.fn.switchTo(nullB);
      ctx.fn.store(ctx.mod.cstring("null"), result);
      ctx.fn.br(endB);
      ctx.fn.switchTo(valB);
      ctx.fn.store(inspect(unboxValue(raw, type.inner, ctx), type.inner, ctx, depth), result);
      ctx.fn.br(endB);
      ctx.fn.switchTo(endB);
      return ctx.fn.load(T.ptr, result);
    }
    default:
      return inspect(unboxValue(raw, type, ctx), type, ctx, depth);
  }
}

export const concat = (ctx: Ctx, a: Value, b: Value): Value =>
  ctx.fn.call("@cs_str_concat", T.ptr, [a, b]);

// A container ready to be formatted. `open` and `arrayMode` are only evaluated when the entries
// are, i.e. past the cycle, empty and depth checks.
export interface ContainerForm {
  // The container's identity, for `[Circular *N]` / `<ref *N>`.
  self: Value;
  // i32: its true entry count.
  count: Value;
  // The whole text of an empty container (`[]`, `{}`, `Point {}`, `Map(0) {}`). Node prints it
  // even past the depth cutoff.
  empty: Value;
  // The placeholder past the depth cutoff (`[Array]`, `[Object]`, `[Point]`).
  deep: string;
  // The opening brace with its prefix (`[`, `{`, `Point {`, `Map(2) {`).
  open: () => Value;
  close: string;
  // i32: -1 unless an array; for an array 1 when its elements are all numbers, else 0.
  arrayMode: () => Value;
  // An array: with showHidden (%o) it lists `[length]`, so even an empty one has an entry.
  isArray?: true;
}

// Node's formatValue/formatRaw order for a container: one already being formatted is
// `[Circular *N]`, an empty one prints its empty form, one past the depth cutoff its placeholder;
// otherwise `fill(entries, inner)` pushes each entry's text (formatted at depth `inner`) onto the
// runtime array `entries`, and the runtime lays them out.
export function formatContainer(
  ctx: Ctx,
  depth: Value,
  form: ContainerForm,
  fill: (entries: Value, inner: Value) => void,
): Value {
  const fn = ctx.fn;
  const result = fn.alloca(T.ptr);
  const circB = fn.newBlock("insp.circ");
  const notCircB = fn.newBlock("insp.notcirc");
  const emptyB = fn.newBlock("insp.empty");
  const someB = fn.newBlock("insp.some");
  const deepB = fn.newBlock("insp.deep");
  const bodyB = fn.newBlock("insp.body");
  const endB = fn.newBlock("insp.end");
  const circ = fn.call("@cs_insp_circular", T.ptr, [form.self]);
  fn.brCond(fn.icmp("ne", fn.ptrToI64(circ), imm(T.i64, 0)), circB, notCircB);
  fn.switchTo(circB);
  fn.store(circ, result);
  fn.br(endB);
  fn.switchTo(notCircB);
  const noEntries = fn.icmp("eq", form.count, imm(T.i32, 0));
  const empty = form.isArray
    ? fn.logicalAnd(
        noEntries,
        fn.icmp("eq", fn.call("@cs_insp_show_hidden", T.i32, []), imm(T.i32, 0)),
      )
    : noEntries;
  fn.brCond(empty, emptyB, someB);
  fn.switchTo(emptyB);
  fn.store(form.empty, result);
  fn.br(endB);
  fn.switchTo(someB);
  fn.brCond(fn.icmp("sgt", depth, fn.call("@cs_insp_max_depth", T.i32, [])), deepB, bodyB);
  fn.switchTo(deepB);
  fn.store(ctx.mod.cstring(form.deep), result);
  fn.br(endB);
  fn.switchTo(bodyB);
  const open = form.open();
  const arrayMode = form.arrayMode();
  fn.callVoid("@cs_insp_push", [form.self, depth]);
  const entries = fn.call("@cs_array_new", T.ptr, []);
  fill(entries, fn.iadd(depth, imm(T.i32, 1)));
  const text = fn.call("@cs_insp_finish", T.ptr, [
    form.self,
    entries,
    form.count,
    open,
    ctx.mod.cstring(form.close),
    arrayMode,
    depth,
  ]);
  fn.store(text, result);
  fn.br(endB);
  fn.switchTo(endB);
  return fn.load(T.ptr, result);
}

// Push one entry's text onto a formatContainer entry list.
export function pushEntry(ctx: Ctx, entries: Value, text: Value): void {
  ctx.fn.call("@cs_array_push", T.i32, [entries, ctx.fn.ptrToI64(text)]);
}

// `body(i)` for i in [0, min(count, limit)).
export function forIndex(ctx: Ctx, count: Value, limit: number, body: (i: Value) => void): void {
  const fn = ctx.fn;
  const n = fn.select(fn.icmp("slt", count, imm(T.i32, limit)), count, imm(T.i32, limit));
  const idxPtr = fn.alloca(T.i32);
  fn.store(imm(T.i32, 0), idxPtr);
  const headB = fn.newBlock("insp.head");
  const iterB = fn.newBlock("insp.iter");
  const doneB = fn.newBlock("insp.done");
  fn.br(headB);
  fn.switchTo(headB);
  fn.brCond(fn.icmp("slt", fn.load(T.i32, idxPtr), n), iterB, doneB);
  fn.switchTo(iterB);
  const i = fn.load(T.i32, idxPtr);
  body(i);
  fn.store(fn.iadd(i, imm(T.i32, 1)), idxPtr);
  fn.br(headB);
  fn.switchTo(doneB);
}

// An optional prints as its inner value, or the bare word for the nullish sentinels.
function inspectOptional(value: Value, inner: ValueType, ctx: Ctx, depth: Value): Value {
  const isUndef = ctx.fn.icmp("eq", value, ctx.mod.externGlobal("cs_undefined_marker"));
  const isNull = ctx.fn.icmp("eq", value, ctx.mod.externGlobal("cs_null_marker"));
  const result = ctx.fn.alloca(T.ptr);
  const undefB = ctx.fn.newBlock("insp.undef");
  const notUndefB = ctx.fn.newBlock("insp.notundef");
  const nullB = ctx.fn.newBlock("insp.null");
  const valB = ctx.fn.newBlock("insp.val");
  const endB = ctx.fn.newBlock("insp.end");

  ctx.fn.brCond(isUndef, undefB, notUndefB);
  ctx.fn.switchTo(undefB);
  ctx.fn.store(ctx.mod.cstring("undefined"), result);
  ctx.fn.br(endB);
  ctx.fn.switchTo(notUndefB);
  ctx.fn.brCond(isNull, nullB, valB);
  ctx.fn.switchTo(nullB);
  ctx.fn.store(ctx.mod.cstring("null"), result);
  ctx.fn.br(endB);
  ctx.fn.switchTo(valB);
  const innerVal = unboxSlot(ctx.fn.load(T.i64, value), inner, ctx);
  // An optional is a wrapper, not a nesting level — Node counts the VALUE's depth.
  ctx.fn.store(inspect(innerVal, inner, ctx, depth), result);
  ctx.fn.br(endB);
  ctx.fn.switchTo(endB);
  return ctx.fn.load(T.ptr, result);
}

// `[ e0, e1 ]`.
function inspectArray(arr: Value, elementType: ValueType, ctx: Ctx, depth: Value): Value {
  return inspectSlots(arr, ctx, depth, elementType, (slot, inner) =>
    inspect(unboxSlot(slot, elementType, ctx), elementType, ctx, inner),
  );
}

// An array whose slots `format` turns into entry text. `slotType` decides whether the elements
// are all numbers (Node right-aligns grouped numeric columns); null means every slot is a Value
// word (an any-JSON array).
export function inspectSlots(
  arr: Value,
  ctx: Ctx,
  depth: Value,
  slotType: ValueType | null,
  format: (slot: Value, inner: Value) => Value,
): Value {
  const len = ctx.fn.call("@cs_array_len", T.i32, [arr]);
  return formatContainer(
    ctx,
    depth,
    {
      self: arr,
      count: len,
      empty: ctx.mod.cstring("[]"),
      deep: "[Array]",
      open: () => ctx.mod.cstring("["),
      close: "]",
      arrayMode: () => allNumbers(arr, len, slotType, ctx),
      isArray: true,
    },
    (entries, inner) =>
      forIndex(ctx, len, MAX_SHOWN, (i) =>
        pushEntry(ctx, entries, format(ctx.fn.call("@cs_array_get", T.i64, [arr, i]), inner)),
      ),
  );
}

// i32 1 when every element Node checks for grouping is a number, else 0. Node walks
// output.length entries, which with a `... more items` entry includes the first hidden element.
// Bit 1 answers the same for element 101 alone (or its absence), which %o's showHidden needs: its
// `[length]` entry makes output one longer (runtime/inspect.milo cs_insp_finish).
function allNumbers(arr: Value, len: Value, slotType: ValueType | null, ctx: Ctx): Value {
  const fn = ctx.fn;
  const isNum = numberTest(slotType, ctx);
  if (typeof isNum === "boolean") return imm(T.i32, isNum ? 3 : 0);
  const acc = fn.alloca(T.i1);
  fn.store(imm(T.i1, 1), acc);
  forIndex(ctx, len, MAX_SHOWN + 1, (i) => {
    const slot = fn.call("@cs_array_get", T.i64, [arr, i]);
    fn.store(fn.logicalAnd(fn.load(T.i1, acc), isNum(slot)), acc);
  });
  const next = fn.alloca(T.i1);
  fn.store(imm(T.i1, 1), next);
  const probeB = fn.newBlock("insp.probe");
  const doneB = fn.newBlock("insp.probed");
  fn.brCond(fn.icmp("sgt", len, imm(T.i32, MAX_SHOWN + 1)), probeB, doneB);
  fn.switchTo(probeB);
  fn.store(isNum(fn.call("@cs_array_get", T.i64, [arr, imm(T.i32, MAX_SHOWN + 1)])), next);
  fn.br(doneB);
  fn.switchTo(doneB);
  return fn.ior(
    fn.zextI1ToI32(fn.load(T.i1, acc)),
    fn.shl(fn.zextI1ToI32(fn.load(T.i1, next)), imm(T.i32, 1)),
  );
}

// Whether an element slot of type `t` holds a number: known statically, or a test on the slot.
function numberTest(t: ValueType | null, ctx: Ctx): boolean | ((slot: Value) => Value) {
  const fn = ctx.fn;
  if (t === null || t.kind === "value") return (slot) => isNumberWord(slot, ctx);
  if (t.kind === "number") return true;
  if (t.kind !== "optional") return false;
  const inner = t.inner;
  if (inner.kind !== "number" && inner.kind !== "value") return false;
  // An optional slot is a sentinel address or a pointer to its boxed inner slot.
  return (slot) => {
    const p = fn.i64ToPtr(slot);
    const present = fn.logicalAnd(
      fn.icmp("ne", p, ctx.mod.externGlobal("cs_undefined_marker")),
      fn.icmp("ne", p, ctx.mod.externGlobal("cs_null_marker")),
    );
    if (inner.kind === "number") return present;
    const r = fn.alloca(T.i1);
    const loadB = fn.newBlock("insp.optnum");
    const endB = fn.newBlock("insp.optnumend");
    fn.store(imm(T.i1, 0), r);
    fn.brCond(present, loadB, endB);
    fn.switchTo(loadB);
    fn.store(isNumberWord(fn.load(T.i64, p), ctx), r);
    fn.br(endB);
    fn.switchTo(endB);
    return fn.load(T.i1, r);
  };
}

// `Set(N) { e0, e1 }`.
function inspectSet(set: Value, element: ValueType, ctx: Ctx, depth: Value): Value {
  const arr = ctx.fn.call("@cs_set_values", T.ptr, [set]);
  const len = ctx.fn.call("@cs_array_len", T.i32, [arr]);
  return formatContainer(
    ctx,
    depth,
    {
      self: set,
      count: len,
      empty: ctx.mod.cstring("Set(0) {}"),
      deep: "[Set]",
      open: () => sizePrefix("Set", len, ctx),
      close: "}",
      arrayMode: () => imm(T.i32, -1),
    },
    (entries, inner) =>
      forIndex(ctx, len, MAX_SHOWN, (i) => {
        const elem = unboxSlot(ctx.fn.call("@cs_array_get", T.i64, [arr, i]), element, ctx);
        pushEntry(ctx, entries, inspect(elem, element, ctx, inner));
      }),
  );
}

// `Map(N) { k0 => v0 }`.
function inspectMap(
  map: Value,
  keyType: ValueType,
  valueType: ValueType,
  ctx: Ctx,
  depth: Value,
): Value {
  const keys = ctx.fn.call("@cs_map_keys", T.ptr, [map]);
  const vals = ctx.fn.call("@cs_map_values", T.ptr, [map]);
  const len = ctx.fn.call("@cs_array_len", T.i32, [keys]);
  return formatContainer(
    ctx,
    depth,
    {
      self: map,
      count: len,
      empty: ctx.mod.cstring("Map(0) {}"),
      deep: "[Map]",
      open: () => sizePrefix("Map", len, ctx),
      close: "}",
      arrayMode: () => imm(T.i32, -1),
    },
    (entries, inner) =>
      forIndex(ctx, len, MAX_SHOWN, (i) => {
        const k = unboxSlot(ctx.fn.call("@cs_array_get", T.i64, [keys, i]), keyType, ctx);
        const v = unboxSlot(ctx.fn.call("@cs_array_get", T.i64, [vals, i]), valueType, ctx);
        const key = concat(ctx, inspect(k, keyType, ctx, inner), ctx.mod.cstring(" => "));
        pushEntry(ctx, entries, concat(ctx, key, inspect(v, valueType, ctx, inner)));
      }),
  );
}

// `Kind(N) {`, the prefix Node puts before a Map's or Set's brace.
function sizePrefix(kind: string, len: Value, ctx: Ctx): Value {
  const n = ctx.fn.call("@cs_num_to_string", T.ptr, [ctx.fn.sitofp(len)]);
  return concat(ctx, concat(ctx, ctx.mod.cstring(`${kind}(`), n), ctx.mod.cstring(") {"));
}
