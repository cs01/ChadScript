// The per-shape printing functions a shape points at (CsShape.inspect / CsShape.json). Formatting
// an object goes through the object's OWN shape, so it prints the fields the object really has, in
// allocation order, with the class name for a class instance, whatever static type it was read
// through. Each field is formatted by the type the allocation stored there.

import { imm, type ModuleBuilder, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import { ice } from "../diagnostics.js";
import type { ShapeDescriptor } from "../hir/nodes.js";
import type { ValueType } from "../hir/types.js";
import { classDisplayName } from "../hir/types.js";
import type { Ctx } from "./expr.js";
import { RECORD_HEADER_SLOTS, loadShape, loadShapeWord, shapeGlobalName } from "./shapes.js";
import { concat, formatContainer, inspectStored, pushEntry } from "./inspect.js";
import { jsonEnter, jsonStored, linePrefix, mayHoldContainer, nextDepth } from "./json.js";
import { V_UNDEFINED } from "./value.js";
import { emitJsonAnyFunctions, inspectAny, jsonAny } from "./json-any.js";

export function emitShapeFunctions(mod: ModuleBuilder, shapes: readonly ShapeDescriptor[]): void {
  for (const s of shapes) {
    emitInspect(mod, s, shapes);
    emitJson(mod, s, shapes);
  }
  emitJsonAnyFunctions(mod, shapes, (fn) => fnCtx(mod, fn, shapes));
}

function fnCtx(mod: ModuleBuilder, fn: Ctx["fn"], shapes: readonly ShapeDescriptor[]): Ctx {
  return {
    mod,
    fn,
    vars: new Map(),
    globals: new Map(),
    breakTargets: [],
    continueTargets: [],
    finallyStack: [],
    fnReturnType: null,
    shapes,
  };
}

// Field types the formatters support. Every shape gets both functions whether or not it is ever
// printed, so a layout holding something else (a Promise, a caught error) gets a function that
// stops with an error when called instead of failing the whole compile. Validation (CS1238,
// validate/render-rules.ts) rejects every console.log / JSON.stringify site such a layout can
// reach, so these stubs are unreachable in an accepted program; they stay as a loud backstop.
function inspectable(t: ValueType): boolean {
  switch (t.kind) {
    case "number":
    case "string":
    case "boolean":
    case "null":
    case "undefined":
    case "object":
    case "function":
      return true;
    case "optional":
      return inspectable(t.inner);
    case "array":
      return inspectable(t.element);
    case "set":
      return inspectable(t.element);
    case "map":
      return inspectable(t.key) && inspectable(t.value);
    case "value":
      return t.members.every(inspectable);
    case "unknown":
    case "promise":
    case "opaque":
      return false;
    default: {
      const never: never = t;
      return ice(`inspectable: unhandled ${(never as { kind: string }).kind}`);
    }
  }
}

// `field`: t is an object field's type, else an array element's. An absent optional field is
// skipped; in an array an optional, undefined or a function is `null` (json.ts), and a Map or Set
// is `{}` anywhere. A field that is always undefined or a function has no text here.
function jsonable(t: ValueType, field: boolean): boolean {
  switch (t.kind) {
    case "number":
    case "string":
    case "boolean":
    case "null":
    case "object":
      return true;
    case "optional":
      return jsonable(t.inner, false);
    case "array":
      return jsonable(t.element, false);
    case "set":
    case "map":
      return true;
    case "value":
      // A field holding `undefined` is skipped by the field loop (it checks the word first), so
      // an undefined member is fine here; every other member must have JSON text.
      return t.members.every((m) => m.kind === "undefined" || jsonable(m, false));
    case "undefined":
    case "function":
      return !field;
    case "unknown":
    case "promise":
    case "opaque":
      return false;
    default: {
      const never: never = t;
      return ice(`jsonable: unhandled ${(never as { kind: string }).kind}`);
    }
  }
}

// The constructor V8 names in a cycle message: the class, or Object for a literal.
function ctorName(s: ShapeDescriptor): string {
  return s.className !== undefined ? classDisplayName(s.className) : "Object";
}

function unsupported(ctx: Ctx, what: string): void {
  ctx.fn.callVoid("@cs_shape_unsupported", [ctx.mod.cstring(what)]);
  ctx.fn.unreachable();
}

// `{ a: 1, b: 'x' }`, `Point { x: 1 }`, `{}`; past Node's depth cutoff `[Object]` / `[Point]`.
function emitInspect(mod: ModuleBuilder, s: ShapeDescriptor, shapes: readonly ShapeDescriptor[]) {
  const obj: Value = { name: "%obj", type: T.ptr };
  const depth: Value = { name: "%depth", type: T.i32 };
  const fn = mod.defineFunc(`${shapeGlobalName(s.id)}.inspect`, T.ptr, [obj, depth]);
  const ctx = fnCtx(mod, fn, shapes);
  const name = s.className !== undefined ? classDisplayName(s.className) : null;
  const bad = s.fields.find((f) => !inspectable(f.type));
  if (bad) {
    unsupported(ctx, `console.log of an object whose field '${bad.name}' is a ${bad.type.kind}`);
    return;
  }
  if (s.jsonTemplate) {
    emitTemplateInspect(s, ctx, obj, depth);
    return;
  }

  const prefix = name !== null ? `${name} ` : "";
  const text = formatContainer(
    ctx,
    depth,
    {
      self: obj,
      count: imm(T.i32, s.fields.length),
      empty: mod.cstring(`${prefix}{}`),
      deep: name !== null ? `[${name}]` : "[Object]",
      open: () => mod.cstring(`${prefix}{`),
      close: "}",
      arrayMode: () => imm(T.i32, -1),
    },
    (entries, inner) =>
      s.fields.forEach((f, i) => {
        const raw = fn.load(T.i64, fn.gepSlot(obj, i + RECORD_HEADER_SLOTS));
        const key = keyPrefix(ctx, f.name);
        pushEntry(ctx, entries, concat(ctx, key, inspectStored(raw, f.type, ctx, inner)));
      }),
  );
  fn.ret(text);
}

// Node's key spelling (formatProperty): an identifier-like name prints bare; anything else is
// quoted by the runtime's one implementation (cs_inspect_key).
const PLAIN_KEY = /^[a-zA-Z_][a-zA-Z_0-9]*$/;

function keyPrefix(ctx: Ctx, name: string): Value {
  if (PLAIN_KEY.test(name) && name !== "__proto__") return ctx.mod.cstring(`${name}: `);
  const quoted = ctx.fn.call("@cs_inspect_key", T.ptr, [ctx.mod.internedString(name)]);
  return concat(ctx, quoted, ctx.mod.cstring(": "));
}

// `{"a":1}` / pretty `{\n  "a": 1\n}`. A field holding undefined is omitted and a function-valued
// field is skipped entirely, as JSON.stringify does.
function emitJson(mod: ModuleBuilder, s: ShapeDescriptor, shapes: readonly ShapeDescriptor[]) {
  const obj: Value = { name: "%obj", type: T.ptr };
  const indent: Value = { name: "%indent", type: T.ptr };
  const depth: Value = { name: "%depth", type: T.i32 };
  const fn = mod.defineFunc(`${shapeGlobalName(s.id)}.json`, T.ptr, [obj, indent, depth]);
  const ctx = fnCtx(mod, fn, shapes);
  const fields = s.fields
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.type.kind !== "function" && f.type.kind !== "undefined");
  const bad = fields.find(({ f }) => !jsonable(f.type, true));
  if (bad) {
    unsupported(
      ctx,
      `JSON.stringify of an object whose field '${bad.f.name}' is a ${bad.f.type.kind}`,
    );
    return;
  }
  if (s.jsonTemplate) {
    emitTemplateJson(s, ctx, obj, indent, depth);
    return;
  }
  if (fields.length === 0) {
    fn.ret(mod.cstring("{}"));
    return;
  }
  const inner = nextDepth(ctx, depth);
  const child = linePrefix(ctx, indent, inner);
  const compact = fn.icmp("eq", fn.ptrToI64(indent), imm(T.i64, 0));
  const colon = fn.select(compact, mod.cstring(":"), mod.cstring(": "));
  const accPtr = fn.alloca(T.ptr);
  fn.store(mod.cstring("{"), accPtr);
  const wrotePtr = fn.alloca(T.i1);
  fn.store(imm(T.i1, 0), wrotePtr);
  const append = (v: Value): void => fn.store(concat(ctx, fn.load(T.ptr, accPtr), v), accPtr);
  const track = fields.some(({ f }) => mayHoldContainer(f.type));
  if (track) jsonEnter(obj, ctorName(s), ctx);

  for (const { f, i } of fields) {
    const raw = fn.load(T.i64, fn.gepSlot(obj, i + RECORD_HEADER_SLOTS));
    const emitB = fn.newBlock("json.emit");
    const nextB = fn.newBlock("json.next");
    fn.brCond(fn.icmp("eq", raw, imm(T.i64, V_UNDEFINED)), nextB, emitB);
    fn.switchTo(emitB);
    const commaB = fn.newBlock("json.comma");
    const keyB = fn.newBlock("json.key");
    fn.brCond(fn.load(T.i1, wrotePtr), commaB, keyB);
    fn.switchTo(commaB);
    append(mod.cstring(","));
    fn.br(keyB);
    fn.switchTo(keyB);
    append(child);
    append(mod.cstring(JSON.stringify(f.name)));
    append(colon);
    if (mayHoldContainer(f.type)) fn.callVoid("@cs_json_key_name", [mod.cstring(f.name)]);
    append(jsonStored(raw, f.type, ctx, indent, inner));
    fn.store(imm(T.i1, 1), wrotePtr);
    fn.br(nextB);
    fn.switchTo(nextB);
  }
  // Close: `<newline+indent>}` if anything was written (pretty), else just `}`.
  const closeWrote = concat(ctx, linePrefix(ctx, indent, depth), mod.cstring("}"));
  const close = fn.select(fn.load(T.i1, wrotePtr), closeWrote, mod.cstring("}"));
  if (track) fn.callVoid("@cs_json_leave", []);
  fn.ret(concat(ctx, fn.load(T.ptr, accPtr), close));
}

// A JSON.parse record's fields are the keys its JSON text had, in text order, laid out by its own
// runtime shape (derived from the template `s`). These walk that shape and pick each field's
// formatter by name; the derived shape's names are the template's interned name pointers, so the
// match is a pointer compare.
function forEachRuntimeField(
  s: ShapeDescriptor,
  ctx: Ctx,
  obj: Value,
  each: (
    k: Value,
    field: ShapeDescriptor["fields"][number] | null,
    raw: Value,
    name: Value,
  ) => void,
): void {
  const fn = ctx.fn;
  const shape = loadShape(obj, ctx);
  const count = loadShapeWord(shape, "fieldCount", ctx);
  const names = loadShapeWord(shape, "names", ctx);
  const kPtr = fn.alloca(T.i64);
  fn.store(imm(T.i64, 0), kPtr);
  const headB = fn.newBlock("tmpl.head");
  const bodyB = fn.newBlock("tmpl.body");
  const nextB = fn.newBlock("tmpl.next");
  const doneB = fn.newBlock("tmpl.done");
  fn.br(headB);
  fn.switchTo(headB);
  fn.brCond(fn.icmp("slt", fn.load(T.i64, kPtr), count), bodyB, doneB);
  fn.switchTo(bodyB);
  const k = fn.load(T.i64, kPtr);
  const name = fn.load(T.ptr, fn.gepPtrDyn(names, k));
  const raw = fn.load(T.i64, fn.gepSlotDyn(obj, fn.ladd(k, imm(T.i64, RECORD_HEADER_SLOTS))));
  for (const f of s.fields) {
    const hitB = fn.newBlock("tmpl.field");
    const missB = fn.newBlock("tmpl.nofield");
    fn.brCond(fn.icmp("eq", name, ctx.mod.internedString(f.name)), hitB, missB);
    fn.switchTo(hitB);
    each(k, f, raw, name);
    fn.br(nextB);
    fn.switchTo(missB);
  }
  // A key the target type does not declare (cs_json_object keeps it, as Node does): its value is an
  // any-JSON word and its name is only known at run time.
  each(k, null, raw, name);
  fn.br(nextB);
  fn.switchTo(nextB);
  fn.store(fn.ladd(k, imm(T.i64, 1)), kPtr);
  fn.br(headB);
  fn.switchTo(doneB);
}

function emitTemplateInspect(s: ShapeDescriptor, ctx: Ctx, obj: Value, depth: Value): void {
  const fn = ctx.fn;
  const count = loadShapeWord(loadShape(obj, ctx), "fieldCount", ctx);
  const text = formatContainer(
    ctx,
    depth,
    {
      self: obj,
      count: fn.truncI64ToI32(count),
      empty: ctx.mod.cstring("{}"),
      deep: "[Object]",
      open: () => ctx.mod.cstring("{"),
      close: "}",
      arrayMode: () => imm(T.i32, -1),
    },
    (entries, inner) =>
      forEachRuntimeField(s, ctx, obj, (_k, f, raw, name) => {
        if (f === null) {
          const key = concat(ctx, fn.call("@cs_inspect_key", T.ptr, [name]), ctx.mod.cstring(": "));
          pushEntry(ctx, entries, concat(ctx, key, inspectAny(raw, ctx, inner)));
          return;
        }
        const key = keyPrefix(ctx, f.name);
        pushEntry(ctx, entries, concat(ctx, key, inspectStored(raw, f.type, ctx, inner)));
      }),
  );
  fn.ret(text);
}

function emitTemplateJson(
  s: ShapeDescriptor,
  ctx: Ctx,
  obj: Value,
  indent: Value,
  depth: Value,
): void {
  const fn = ctx.fn;
  const inner = nextDepth(ctx, depth);
  const child = linePrefix(ctx, indent, inner);
  const compact = fn.icmp("eq", fn.ptrToI64(indent), imm(T.i64, 0));
  const colon = fn.select(compact, ctx.mod.cstring(":"), ctx.mod.cstring(": "));
  const accPtr = fn.alloca(T.ptr);
  fn.store(ctx.mod.cstring("{"), accPtr);
  const append = (v: Value): void => fn.store(concat(ctx, fn.load(T.ptr, accPtr), v), accPtr);
  // A parsed object can be made part of a cycle by a later field write, so it is tracked too.
  jsonEnter(obj, "Object", ctx);
  // Every laid-out key holds a JSON value (never undefined), so each one is written.
  forEachRuntimeField(s, ctx, obj, (k, f, raw, name) => {
    const commaB = fn.newBlock("json.comma");
    const keyB = fn.newBlock("json.key");
    fn.brCond(fn.icmp("sgt", k, imm(T.i64, 0)), commaB, keyB);
    fn.switchTo(commaB);
    append(ctx.mod.cstring(","));
    fn.br(keyB);
    fn.switchTo(keyB);
    append(child);
    fn.callVoid("@cs_json_key_name", [name]);
    if (f === null) {
      append(fn.call("@cs_json_str", T.ptr, [name]));
      append(colon);
      append(jsonAny(raw, ctx, indent, inner));
      return;
    }
    append(ctx.mod.cstring(JSON.stringify(f.name)));
    append(colon);
    append(jsonStored(raw, f.type, ctx, indent, inner));
  });
  const count = loadShapeWord(loadShape(obj, ctx), "fieldCount", ctx);
  const closeWrote = concat(ctx, linePrefix(ctx, indent, depth), ctx.mod.cstring("}"));
  const close = fn.select(fn.icmp("sgt", count, imm(T.i64, 0)), closeWrote, ctx.mod.cstring("}"));
  fn.callVoid("@cs_json_leave", []);
  fn.ret(concat(ctx, fn.load(T.ptr, accPtr), close));
}
