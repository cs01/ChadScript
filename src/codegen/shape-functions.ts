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
import { MAX_DEPTH, inspectStored } from "./inspect.js";
import { jsonStored, linePrefix, nextDepth } from "./json.js";
import { V_UNDEFINED } from "./value.js";

export function emitShapeFunctions(mod: ModuleBuilder, shapes: readonly ShapeDescriptor[]): void {
  for (const s of shapes) {
    emitInspect(mod, s, shapes);
    emitJson(mod, s, shapes);
  }
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

const concat = (ctx: Ctx, a: Value, b: Value): Value =>
  ctx.fn.call("@cs_str_concat", T.ptr, [a, b]);

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

function jsonable(t: ValueType): boolean {
  switch (t.kind) {
    case "number":
    case "string":
    case "boolean":
    case "null":
    case "object":
      return true;
    case "optional":
      return jsonable(t.inner);
    case "array":
      return jsonable(t.element);
    case "undefined":
    case "function":
    case "set":
    case "map":
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

  const deepB = fn.newBlock("deep");
  const bodyB = fn.newBlock("body");
  fn.brCond(fn.icmp("sgt", depth, imm(T.i32, MAX_DEPTH)), deepB, bodyB);
  fn.switchTo(deepB);
  fn.ret(mod.cstring(name !== null ? `[${name}]` : "[Object]"));

  fn.switchTo(bodyB);
  const prefix = name !== null ? `${name} ` : "";
  if (s.fields.length === 0) {
    fn.ret(mod.cstring(`${prefix}{}`));
    return;
  }
  const inner = fn.iadd(depth, imm(T.i32, 1));
  let acc = mod.cstring(`${prefix}{ `);
  s.fields.forEach((f, i) => {
    if (i > 0) acc = concat(ctx, acc, mod.cstring(", "));
    acc = concat(ctx, acc, mod.cstring(`${f.name}: `));
    const raw = fn.load(T.i64, fn.gepSlot(obj, i + RECORD_HEADER_SLOTS));
    acc = concat(ctx, acc, inspectStored(raw, f.type, ctx, inner));
  });
  fn.ret(concat(ctx, acc, mod.cstring(" }")));
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
  const bad = fields.find(({ f }) => !jsonable(f.type));
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
    append(mod.cstring(`"${f.name}"`));
    append(colon);
    append(jsonStored(raw, f.type, ctx, indent, inner));
    fn.store(imm(T.i1, 1), wrotePtr);
    fn.br(nextB);
    fn.switchTo(nextB);
  }
  // Close: `<newline+indent>}` if anything was written (pretty), else just `}`.
  const closeWrote = concat(ctx, linePrefix(ctx, indent, depth), mod.cstring("}"));
  const close = fn.select(fn.load(T.i1, wrotePtr), closeWrote, mod.cstring("}"));
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
  each: (k: Value, field: ShapeDescriptor["fields"][number], raw: Value) => void,
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
    each(k, f, raw);
    fn.br(nextB);
    fn.switchTo(missB);
  }
  // cs_json_object only ever lays out the template's own names.
  fn.callVoid("@cs_shape_mismatch", []);
  fn.unreachable();
  fn.switchTo(nextB);
  fn.store(fn.ladd(k, imm(T.i64, 1)), kPtr);
  fn.br(headB);
  fn.switchTo(doneB);
}

function emitTemplateInspect(s: ShapeDescriptor, ctx: Ctx, obj: Value, depth: Value): void {
  const fn = ctx.fn;
  const deepB = fn.newBlock("deep");
  const bodyB = fn.newBlock("body");
  fn.brCond(fn.icmp("sgt", depth, imm(T.i32, MAX_DEPTH)), deepB, bodyB);
  fn.switchTo(deepB);
  fn.ret(ctx.mod.cstring("[Object]"));
  fn.switchTo(bodyB);
  const count = loadShapeWord(loadShape(obj, ctx), "fieldCount", ctx);
  const emptyB = fn.newBlock("empty");
  const fieldsB = fn.newBlock("fields");
  fn.brCond(fn.icmp("eq", count, imm(T.i64, 0)), emptyB, fieldsB);
  fn.switchTo(emptyB);
  fn.ret(ctx.mod.cstring("{}"));
  fn.switchTo(fieldsB);
  const inner = fn.iadd(depth, imm(T.i32, 1));
  const accPtr = fn.alloca(T.ptr);
  fn.store(ctx.mod.cstring("{ "), accPtr);
  const append = (v: Value): void => fn.store(concat(ctx, fn.load(T.ptr, accPtr), v), accPtr);
  forEachRuntimeField(s, ctx, obj, (k, f, raw) => {
    const sepB = fn.newBlock("insp.sep");
    const keyB = fn.newBlock("insp.key");
    fn.brCond(fn.icmp("sgt", k, imm(T.i64, 0)), sepB, keyB);
    fn.switchTo(sepB);
    append(ctx.mod.cstring(", "));
    fn.br(keyB);
    fn.switchTo(keyB);
    append(ctx.mod.cstring(`${f.name}: `));
    append(inspectStored(raw, f.type, ctx, inner));
  });
  fn.ret(concat(ctx, fn.load(T.ptr, accPtr), ctx.mod.cstring(" }")));
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
  // Every laid-out key holds a JSON value (never undefined), so each one is written.
  forEachRuntimeField(s, ctx, obj, (k, f, raw) => {
    const commaB = fn.newBlock("json.comma");
    const keyB = fn.newBlock("json.key");
    fn.brCond(fn.icmp("sgt", k, imm(T.i64, 0)), commaB, keyB);
    fn.switchTo(commaB);
    append(ctx.mod.cstring(","));
    fn.br(keyB);
    fn.switchTo(keyB);
    append(child);
    append(ctx.mod.cstring(`"${f.name}"`));
    append(colon);
    append(jsonStored(raw, f.type, ctx, indent, inner));
  });
  const count = loadShapeWord(loadShape(obj, ctx), "fieldCount", ctx);
  const closeWrote = concat(ctx, linePrefix(ctx, indent, depth), ctx.mod.cstring("}"));
  const close = fn.select(fn.icmp("sgt", count, imm(T.i64, 0)), closeWrote, ctx.mod.cstring("}"));
  fn.ret(concat(ctx, fn.load(T.ptr, accPtr), close));
}
