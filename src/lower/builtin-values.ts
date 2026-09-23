// Built-in functions used as values: `[1, 2].map(String)`, `xs.forEach(console.log)`,
// `const f: (x: number) => number = Math.floor`. A builtin is lowered at each call site from its
// argument types, so as a value it becomes a closure over a synthesized wrapper whose parameters
// are the ones the value is used at (the contextual function type tsc gives the reference). The
// wrapper passes every argument it receives, exactly as Node's caller does: `map` hands parseInt
// the index as its radix, so `["1", "2", "3"].map(parseInt)` is `[1, NaN, NaN]`.
//
// Identity: one static closure record per (builtin, signature), all sharing the builtin's identity
// token (codegen/cells.ts), so `String === String` holds across signatures as in Node.

import ts from "typescript";
import { ice } from "../diagnostics.js";
import type { HExpr, HStmt } from "../hir/nodes.js";
import { VT, type ValueType } from "../hir/types.js";
import type { LowerCtx } from "./lower.js";
import { signatureKey } from "./declarations.js";
import { coerceToTarget } from "./value-lower.js";
import { UnrepresentableTypeError, valueTypeOfTsType } from "./type-translation.js";

// The builtins admitted as values, by the name a reference spells.
export type BuiltinId =
  | "String"
  | "Number"
  | "Boolean"
  | "parseInt"
  | "parseFloat"
  | "console.log"
  | `Math.${MathFn}`;

type MathFn =
  | "abs"
  | "ceil"
  | "floor"
  | "round"
  | "sign"
  | "sqrt"
  | "trunc"
  | "max"
  | "min"
  | "pow";
const MATH_FNS: ReadonlySet<string> = new Set([
  "abs",
  "ceil",
  "floor",
  "round",
  "sign",
  "sqrt",
  "trunc",
  "max",
  "min",
  "pow",
]);
const GLOBALS: ReadonlySet<string> = new Set([
  "String",
  "Number",
  "Boolean",
  "parseInt",
  "parseFloat",
]);

// The builtin `ref` names when it is one declared by the ambient environment (a program's own
// `String` function or a local `Math` shadows it), else null.
export function builtinIdOf(ref: ts.Expression, checker: ts.TypeChecker): BuiltinId | null {
  let name: string | null = null;
  let nameNode: ts.Node = ref;
  if (ts.isIdentifier(ref) && GLOBALS.has(ref.text)) name = ref.text;
  if (ts.isPropertyAccessExpression(ref) && ts.isIdentifier(ref.expression)) {
    const recv = ref.expression.text;
    const m = ref.name.text;
    if (recv === "Math" && MATH_FNS.has(m)) name = `Math.${m}`;
    if (recv === "console" && m === "log") name = "console.log";
    nameNode = ref.name;
  }
  if (name === null) return null;
  const sym = checker.getSymbolAtLocation(nameNode);
  const decls = sym?.declarations ?? [];
  if (decls.length === 0 || !decls.every((d) => d.getSourceFile().isDeclarationFile)) return null;
  return name as BuiltinId;
}

// Why builtin `id` cannot stand for a function of type `use`, or null when it can. The validator
// reports this (CS1246); lowering only ever sees uses that passed.
export function builtinValueProblem(id: BuiltinId, use: ValueType | null): string | null {
  if (use === null || use.kind !== "function") {
    return "it is not used where a function type says which arguments it receives";
  }
  const p = use.params;
  if (p.length === 0) return "it is used with no arguments";
  const primitive = (t: ValueType | undefined): boolean =>
    t !== undefined && (t.kind === "number" || t.kind === "string" || t.kind === "boolean");
  switch (id) {
    case "String":
    case "Number":
    case "Boolean":
      return primitive(p[0]) ? null : `its argument here is not a number, string or boolean`;
    // Each reads only its own parameters; whatever else the caller passes is ignored.
    case "parseInt":
      return p[0]?.kind === "string" && (p[1] === undefined || p[1].kind === "number")
        ? null
        : "its arguments here are not a string and a number";
    case "parseFloat":
      return p[0]?.kind === "string" ? null : "its argument here is not a string";
    case "console.log":
      return use.ret === null ? null : "its result (undefined) is used";
    case "Math.max":
    case "Math.min":
      return p.every((t) => t.kind === "number") ? null : "its arguments here are not all numbers";
    case "Math.pow":
      return p.length >= 2 && p[0]!.kind === "number" && p[1]!.kind === "number"
        ? null
        : "it is not given two numbers here";
    default:
      return p[0]!.kind === "number" ? null : "its argument here is not a number";
  }
}

const wrappers = new WeakMap<LowerCtx["functions"], Map<string, HExpr>>();

// `ref` (a value-position reference to builtin `id`) as a closure of its contextual type.
export function lowerBuiltinValue(ref: ts.Expression, id: BuiltinId, ctx: LowerCtx): HExpr {
  const ct = ctx.checker.getContextualType(ref);
  let use: ValueType | null = null;
  try {
    use = ct ? valueTypeOfTsType(ct, ref, ctx.checker) : null;
  } catch (e) {
    if (!(e instanceof UnrepresentableTypeError)) throw e;
  }
  const problem = builtinValueProblem(id, use);
  if (problem !== null || use === null || use.kind !== "function") {
    return ice(`lower: builtin ${id} as a value: ${problem ?? "no function type"}`);
  }
  const memo = wrappers.get(ctx.functions) ?? new Map<string, HExpr>();
  wrappers.set(ctx.functions, memo);
  const key = `${id}|${signatureKey(use)}`;
  const hit = memo.get(key);
  if (hit) return hit;

  const name = `builtin.${id}.${ctx.counter.n++}`;
  const params = use.params.map((type, i) => ({ name: `${name}.p${i}`, type }));
  const args: HExpr[] = params.map((p) => ({ kind: "varRef", name: p.name, type: p.type }));
  const ret = use.ret;
  const body: HStmt[] = [];
  const result = builtinCall(id, args);
  if (result === null) {
    body.push({ kind: "consoleLog", values: args }, { kind: "return", value: null });
  } else if (ret === null) {
    body.push({ kind: "exprStmt", expr: result }, { kind: "return", value: null });
  } else {
    body.push({ kind: "return", value: coerceToTarget(result, ret) });
  }
  ctx.functions.push({ name, params, returnType: ret, body, captures: [] });
  const display = id.includes(".") ? id.slice(id.indexOf(".") + 1) : id;
  const closure: HExpr = {
    kind: "closure",
    lambdaName: name,
    captures: [],
    display: `[Function: ${display}]`,
    type: use,
    identity: `builtin.${id}`,
  };
  memo.set(key, closure);
  return closure;
}

// The builtin applied to `args` (the wrapper's parameters), or null for console.log, which is a
// statement.
function builtinCall(id: BuiltinId, args: HExpr[]): HExpr | null {
  const a0 = args[0] ?? ice("builtin value without arguments");
  switch (id) {
    case "String":
      return { kind: "convert", op: "String", value: a0, type: VT.string };
    case "Number":
      return { kind: "convert", op: "Number", value: a0, type: VT.number };
    case "Boolean":
      return { kind: "convert", op: "Boolean", value: a0, type: VT.boolean };
    case "parseInt":
      // A missing radix is the runtime's 0 sentinel, as for a direct call.
      return {
        kind: "runtimeCall",
        fn: "cs_parse_int",
        args: [a0, args[1] ?? { kind: "numberLit", value: 0, type: VT.number }],
        type: VT.number,
      };
    case "parseFloat":
      return { kind: "runtimeCall", fn: "cs_parse_float", args: [a0], type: VT.number };
    case "console.log":
      return null;
    default: {
      const fn = id.slice("Math.".length);
      const variadic = fn === "max" || fn === "min";
      const arity = fn === "pow" ? 2 : 1;
      return {
        kind: "mathCall",
        fn,
        args: variadic ? args : args.slice(0, arity),
        type: VT.number,
      };
    }
  }
}
