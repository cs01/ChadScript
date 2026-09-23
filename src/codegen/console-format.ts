// console.log with a (possibly) string first argument and more arguments: Node runs util.format,
// substituting %s %d %i %f %j %o %O %c. The substitution loop is runtime/format.milo; this file
// emits, per call site, the `thunk` it calls back for the text of argument `idx` under directive
// `dir`, from each argument's static type. Every argument is evaluated first (JS evaluates all the
// arguments before console.log prints anything) and parked as a Value word in an env array.
//
// The conversions, from Node's formatWithOptionsInternal:
//   append  a string raw, anything else util.inspect (console.log's own form)
//   %s      numbers formatNumber, other primitives String(), objects inspect at depth 0
//   %d      formatNumber(Number(v));  %i formatNumber(parseInt(v));  %f formatNumber(parseFloat(v))
//   %j      JSON.stringify(v) (undefined and functions give "undefined", a Map or Set "{}")
//   %O      util.inspect;  %o util.inspect with showHidden and depth 4
// The validator (validate/format-rules.ts) rejects any argument whose type one of the directives
// it can meet cannot render exactly (a function under %s prints its source text, for instance).

import { ice } from "../diagnostics.js";
import { imm, fimm, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { HExpr } from "../hir/nodes.js";
import type { ValueType } from "../hir/types.js";
import { ALL_DIRECTIVES, literalDirectives, type Directive } from "../hir/format-directives.js";
import { type Ctx, evalValue, unboxSlot } from "./expr.js";
import { inspect } from "./inspect.js";
import { jsonOrCircular } from "./json.js";
import { boxValue, unboxValue, V_NULL, V_UNDEFINED, TAG } from "./value.js";
import { switchOnValue } from "./value-ops.js";
import { emitPrintComputedAny } from "./emit-print.js";

// 2^49: every number word is at or above it (value.ts).
const DOUBLE_OFFSET = "562949953421312";

// The kinds a word of static type `t` can hold, with a Value union or an optional flattened.
export function flatMembers(t: ValueType): ValueType[] {
  switch (t.kind) {
    case "value":
      return t.members;
    case "optional": {
      const inner = flatMembers(t.inner);
      const out = [...inner];
      if (!out.some((m) => m.kind === "undefined")) out.push({ kind: "undefined" });
      if (!out.some((m) => m.kind === "null")) out.push({ kind: "null" });
      return out;
    }
    default:
      return [t];
  }
}

// Whether console.log(values...) goes through util.format: more than one argument and a first one
// that can be a string at run time. A literal with no `%` cannot substitute anything, so it keeps
// the direct printing path.
export function needsFormat(values: readonly HExpr[]): boolean {
  const first = values[0];
  if (!first || values.length < 2) return false;
  if (first.kind === "stringLit") return first.value.includes("%");
  return flatMembers(first.type).some((m) => m.kind === "string");
}

// The directives argument `i` can meet. A literal format string decides them exactly.
export function directivesOf(values: readonly HExpr[]): Set<Directive>[] {
  const first = values[0]!;
  if (first.kind === "stringLit") {
    const exact = literalDirectives(first.value, values.length);
    return exact.map((d, i) => new Set<Directive>(i === 0 ? [] : [d]));
  }
  return values.map(() => new Set(ALL_DIRECTIVES));
}

export function emitConsoleLogLine(values: readonly HExpr[], ctx: Ctx): void {
  // Evaluate everything first, in order.
  const computed = values.map((v) =>
    v.type.kind === "undefined" || v.type.kind === "null" ? null : evalValue(v, ctx),
  );
  if (!needsFormat(values)) {
    computed.forEach((val, i) => {
      if (i > 0) ctx.fn.callVoid("@cs_print_space", []);
      emitPrintComputedAny(val, values[i]!.type, ctx);
    });
    ctx.fn.callVoid("@cs_print_newline", []);
    return;
  }
  const env = ctx.fn.call("@cs_array_new", T.ptr, []);
  computed.forEach((val, i) => {
    ctx.fn.call("@cs_array_push", T.i32, [env, wordOf(val, values[i]!.type, ctx)]);
  });
  const first = ctx.fn.call("@cs_array_get", T.i64, [env, imm(T.i32, 0)]);
  const firstType = values[0]!.type;
  const isString =
    firstType.kind === "string"
      ? imm(T.i1, 1)
      : ctx.fn.logicalAnd(
          ctx.fn.logicalAnd(
            ctx.fn.icmp("ugt", first, imm(T.i64, 3)),
            ctx.fn.icmp("ult", first, imm(T.i64, DOUBLE_OFFSET)),
          ),
          ctx.fn.icmp("eq", ctx.fn.land(first, imm(T.i64, 7)), imm(T.i64, TAG.string)),
        );
  const firstStr = ctx.fn.i64ToPtr(ctx.fn.land(first, imm(T.i64, -8)));
  const thunk = defineThunk(
    values.map((v) => v.type),
    directivesOf(values),
    ctx,
  );
  const text = ctx.fn.call("@cs_console_format", T.ptr, [
    ctx.fn.zextI1ToI32(isString),
    firstStr,
    imm(T.i32, values.length),
    thunk,
    env,
  ]);
  ctx.fn.callVoid("@cs_print_cstr", [text]);
  ctx.fn.callVoid("@cs_print_newline", []);
}

// An evaluated argument as a Value word (a literal `undefined` / `null` has no machine value).
function wordOf(val: Value | null, t: ValueType, ctx: Ctx): Value {
  if (t.kind === "undefined") return imm(T.i64, V_UNDEFINED);
  if (t.kind === "null") return imm(T.i64, V_NULL);
  if (val === null) return ice("console format: an argument without a value");
  return boxValue(val, t, ctx);
}

const thunkCount = new WeakMap<Ctx["mod"], number>();

const DIRECTIVE_CODE: Record<Exclude<Directive, "c">, number> = {
  append: 0,
  s: 115,
  d: 100,
  i: 105,
  f: 102,
  j: 106,
  o: 111,
  O: 79,
};

// `thunk(env, idx, dir)`: the text of argument idx under directive dir, one branch per pair this
// call site can request.
function defineThunk(
  types: readonly ValueType[],
  dirs: readonly Set<Directive>[],
  ctx: Ctx,
): Value {
  const n = thunkCount.get(ctx.mod) ?? 0;
  thunkCount.set(ctx.mod, n + 1);
  const name = `fmt.${n}`;
  const params: Value[] = [
    { name: "%env", type: T.ptr },
    { name: "%idx", type: T.i32 },
    { name: "%dir", type: T.i32 },
  ];
  const fn = ctx.mod.defineFunc(name, T.ptr, params);
  const tctx: Ctx = {
    ...ctx,
    fn,
    vars: new Map(),
    breakTargets: [],
    continueTargets: [],
    finallyStack: [],
    fnReturnType: null,
    asyncFn: false,
  };
  types.forEach((t, i) => {
    for (const d of dirs[i]!) {
      if (d === "c") continue;
      const hitB = fn.newBlock(`fmt.a${i}.${d}`);
      const nextB = fn.newBlock("fmt.next");
      fn.brCond(
        fn.logicalAnd(
          fn.icmp("eq", params[1]!, imm(T.i32, i)),
          fn.icmp("eq", params[2]!, imm(T.i32, DIRECTIVE_CODE[d])),
        ),
        hitB,
        nextB,
      );
      fn.switchTo(hitB);
      const raw = fn.call("@cs_array_get", T.i64, [params[0]!, imm(T.i32, i)]);
      fn.ret(directiveText(raw, t, d, tctx));
      fn.switchTo(nextB);
    }
  });
  // The runtime asks only for the pairs listed above.
  fn.unreachable();
  return ctx.fn.funcRef(name);
}

function directiveText(raw: Value, t: ValueType, d: Exclude<Directive, "c">, ctx: Ctx): Value {
  return switchOnValue(raw, flatMembers(t), T.ptr, ctx, (m) => {
    if (m.kind === "undefined" || m.kind === "null") return nullishText(m.kind, d, ctx);
    return memberText(unboxValue(raw, m, ctx), m, d, ctx);
  });
}

function nullishText(kind: "undefined" | "null", d: Exclude<Directive, "c">, ctx: Ctx): Value {
  switch (d) {
    case "append":
    case "s":
    case "o":
    case "O":
    case "j":
      return ctx.mod.cstring(kind);
    case "d": // Number(null) is 0, Number(undefined) NaN
      return ctx.mod.cstring(kind === "null" ? "0" : "NaN");
    case "i":
    case "f": // parseInt("null") / parseFloat("undefined")
      return ctx.mod.cstring("NaN");
    default: {
      const never: never = d;
      return ice(`console format: directive ${String(never)}`);
    }
  }
}

// Inspect `v` with util.inspect options other than console.log's (depth, showHidden), restoring
// console.log's afterwards. Formatting runs no user code, so nothing can observe the switch.
function inspectWith(v: Value, m: ValueType, depth: number, hidden: number, ctx: Ctx): Value {
  ctx.fn.callVoid("@cs_insp_set_mode", [imm(T.i32, depth), imm(T.i32, hidden)]);
  const text = inspect(v, m, ctx, imm(T.i32, 0));
  ctx.fn.callVoid("@cs_insp_set_mode", [imm(T.i32, 2), imm(T.i32, 0)]);
  return text;
}

const formatNumber = (x: Value, ctx: Ctx): Value => ctx.fn.call("@cs_inspect_num", T.ptr, [x]);

function memberText(v: Value, m: ValueType, d: Exclude<Directive, "c">, ctx: Ctx): Value {
  switch (d) {
    case "append":
      return m.kind === "string" ? v : inspect(v, m, ctx, imm(T.i32, 0));
    case "O":
      return inspect(v, m, ctx, imm(T.i32, 0));
    case "o":
      return inspectWith(v, m, 4, 1, ctx);
    case "s":
      switch (m.kind) {
        case "string":
          return v;
        case "number":
        case "boolean":
          return inspect(v, m, ctx, imm(T.i32, 0));
        case "array":
        case "object":
        case "map":
        case "set":
          return inspectWith(v, m, 0, 0, ctx);
        default:
          return ice(`console format: %s of ${m.kind}`);
      }
    case "d":
      return formatNumber(toNumber(v, m, ctx), ctx);
    case "i":
      return formatNumber(
        ctx.fn.call("@cs_parse_int", T.double, [numText(v, m, false, ctx), fimm(0)]),
        ctx,
      );
    case "f":
      return formatNumber(
        ctx.fn.call("@cs_parse_float", T.double, [numText(v, m, false, ctx)]),
        ctx,
      );
    case "j":
      switch (m.kind) {
        case "function":
          return ctx.mod.cstring("undefined");
        case "map":
        case "set":
          return ctx.mod.cstring("{}");
        default:
          return jsonOrCircular(v, m, ctx);
      }
    default: {
      const never: never = d;
      return ice(`console format: directive ${String(never)}`);
    }
  }
}

// Number(v) for %d.
function toNumber(v: Value, m: ValueType, ctx: Ctx): Value {
  switch (m.kind) {
    case "number":
      return v;
    case "string":
      return ctx.fn.call("@cs_string_to_number", T.double, [v]);
    case "boolean":
      return ctx.fn.uitofp(ctx.fn.zextI1ToI32(v));
    case "array":
      // ToPrimitive of an array is its join(","), which numText reduces to what decides Number().
      return ctx.fn.call("@cs_string_to_number", T.double, [numText(v, m, false, ctx)]);
    case "object":
    case "map":
    case "set":
    case "function":
      return fimm(NaN); // "[object Object]", "[object Map]", or the function's source
    default:
      return ice(`console format: Number() of ${m.kind}`);
  }
}

// A string that Number(), parseInt() and parseFloat() read exactly as they read String(v). For an
// array that is its first element's text plus a comma when more follow: parseInt and parseFloat
// stop at the first comma, and Number() is NaN whenever a comma is present, so the rest of the join
// can never matter. Objects become text none of the three accepts. `inArray`: an array element,
// where null and undefined join as "".
function numText(v: Value, m: ValueType, inArray: boolean, ctx: Ctx): Value {
  switch (m.kind) {
    case "number":
      return ctx.fn.call("@cs_num_to_string", T.ptr, [v]);
    case "string":
      return v;
    case "boolean":
      return ctx.fn.call("@cs_bool_to_string", T.ptr, [ctx.fn.zextI1ToI32(v)]);
    case "null":
    case "undefined":
      return ctx.mod.cstring(inArray ? "" : m.kind);
    case "object":
    case "map":
    case "set":
    case "function":
      return ctx.mod.cstring("[object Object]");
    case "array": {
      const len = ctx.fn.call("@cs_array_len", T.i32, [v]);
      const result = ctx.fn.alloca(T.ptr);
      const emptyB = ctx.fn.newBlock("fmt.arr.empty");
      const someB = ctx.fn.newBlock("fmt.arr.some");
      const endB = ctx.fn.newBlock("fmt.arr.end");
      ctx.fn.brCond(ctx.fn.icmp("eq", len, imm(T.i32, 0)), emptyB, someB);
      ctx.fn.switchTo(emptyB);
      ctx.fn.store(ctx.mod.cstring(""), result);
      ctx.fn.br(endB);
      ctx.fn.switchTo(someB);
      const slot = ctx.fn.call("@cs_array_get", T.i64, [v, imm(T.i32, 0)]);
      const head = elementText(slot, m.element, ctx);
      const more = ctx.fn.icmp("sgt", len, imm(T.i32, 1));
      ctx.fn.store(
        ctx.fn.select(
          more,
          ctx.fn.call("@cs_str_concat", T.ptr, [head, ctx.mod.cstring(",")]),
          head,
        ),
        result,
      );
      ctx.fn.br(endB);
      ctx.fn.switchTo(endB);
      return ctx.fn.load(T.ptr, result);
    }
    default:
      return ice(`console format: String() of ${m.kind}`);
  }
}

// numText of an array element slot.
function elementText(slot: Value, t: ValueType, ctx: Ctx): Value {
  if (t.kind === "optional" || t.kind === "value") {
    // Optional slots hold a box pointer or a sentinel; normalize to a Value word first.
    const word = t.kind === "optional" ? boxValue(unboxSlot(slot, t, ctx), t, ctx) : slot;
    return switchOnValue(word, flatMembers(t), T.ptr, ctx, (m) =>
      m.kind === "undefined" || m.kind === "null"
        ? ctx.mod.cstring("")
        : numText(unboxValue(word, m, ctx), m, true, ctx),
    );
  }
  if (t.kind === "undefined" || t.kind === "null") return ctx.mod.cstring("");
  return numText(unboxSlot(slot, t, ctx), t, true, ctx);
}
