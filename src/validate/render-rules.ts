// CS1238: console.log / JSON.stringify of a value that can CONTAIN something the formatters cannot
// render the way Node does. An object is formatted through its runtime shape, so the check follows
// every layout that can reach each object type (lower/layouts.ts), not only the static type's
// fields: `console.log(i)` with `i: { n: number }` still prints a `p: Promise` field of an object
// literal that reached it. Rejected kinds:
//
//   - Promise: Node prints its state (`Promise { 1 }`, `Promise { <pending> }`), which depends on
//     scheduling the formatter cannot observe; JSON gives `{}`.
//   - unknown (a caught value): Node prints an Error with its stack trace (file paths).
//   - an opaque handle (Timeout): Node prints internal fields (and JSON throws on its cycle).
//   - JSON only, the kinds codegen/json.ts has no text for: Map/Set, a function or undefined outside
//     an object field (Node writes `null` in an array, `undefined` at the top), an optional outside a
//     field.
//
// This mirrors exactly what codegen/inspect.ts, emit-print.ts and json.ts implement, so a program
// that passes never reaches their ice() or the per-shape `cs_shape_unsupported` stubs.

import ts from "typescript";
import { type Diagnostic, ice } from "../diagnostics.js";
import type { LayoutAnalysis } from "../lower/layouts.js";
import { UnrepresentableTypeError, valueTypeOfTsType } from "../lower/type-translation.js";
import type { ValueType } from "../hir/types.js";
import { CODE } from "./codes.js";
import { spanOf } from "./validate.js";

type Mode = "inspect" | "json";
// Where a JSON value sits: an object field may hold undefined/function (skipped, as Node does) or
// an optional; anywhere else only a plain JSON value.
type Position = "value" | "field";

export function renderDiagnostic(
  call: ts.CallExpression,
  analysis: LayoutAnalysis,
  checker: ts.TypeChecker,
): Diagnostic | null {
  const mode = renderingMode(call);
  if (mode === null) return null;
  const args = mode === "json" ? call.arguments.slice(0, 1) : call.arguments;
  // Per position, because a type fine as an object field (holding undefined) may not be as a value.
  const seen = { value: new Set<ts.Type>(), field: new Set<ts.Type>() };
  for (const arg of args) {
    const problem = walk(checker.getTypeAtLocation(arg), "value", "the value", arg);
    if (problem) {
      const what = mode === "json" ? "JSON.stringify" : "console.log";
      return {
        code: CODE.UNRENDERABLE_VALUE,
        message: `${what} cannot render this: ${problem}`,
        span: spanOf(arg, arg.getSourceFile()),
        suggestion:
          mode === "json"
            ? "serialize the plain-data fields you need explicitly: `JSON.stringify({ a: o.a })`"
            : "print the plain-data fields you need explicitly (for a caught error, `e instanceof Error ? e.message : String(e)`)",
      };
    }
  }
  return null;

  // A description of the first unrenderable thing reachable from `t`, or null.
  function walk(t: ts.Type, pos: Position, where: string, at: ts.Node): string | null {
    // `m.keys()` / `s.values()` lower to a materialized array, but Node prints the iterator
    // object itself (`[Map Iterator] { 1, 2 }`).
    if (/Iterator$/.test(t.getSymbol()?.getName() ?? "")) {
      return `${where} is an iterator, which Node prints as an iterator object`;
    }
    let vt: ValueType;
    try {
      vt = valueTypeOfTsType(t, at, checker);
    } catch (e) {
      if (e instanceof UnrepresentableTypeError) return null; // reported where it is declared
      throw e;
    }
    if (seen[pos].has(t)) return null; // also what stops a recursive structure
    seen[pos].add(t);
    const args = (): readonly ts.Type[] => checker.getTypeArguments(t as ts.TypeReference);
    switch (vt.kind) {
      case "number":
      case "string":
      case "boolean":
      case "null":
        return null;
      case "undefined":
      case "function":
        return mode === "json" && pos === "value" ? `${where} is a ${vt.kind}` : null;
      case "optional": {
        if (mode === "json" && pos === "value") return `${where} can be undefined`;
        return walk(checker.getNonNullableType(t), "value", where, at);
      }
      case "array":
        // A tuple is an array at run time; its type arguments are the element types.
        for (const e of args()) {
          const p = walk(e, "value", `an element of ${where}`, at);
          if (p) return p;
        }
        return null;
      case "set":
      case "map": {
        if (mode === "json") return `${where} is a ${vt.kind === "map" ? "Map" : "Set"}`;
        for (const e of args()) {
          const p = walk(e, "value", `an entry of ${where}`, at);
          if (p) return p;
        }
        return null;
      }
      case "object":
        for (const l of analysis.reachingType(t)) {
          for (const name of l.names) {
            const prop = checker.getPropertyOfType(l.type, name);
            if (!prop) continue;
            const p = walk(
              checker.getTypeOfSymbolAtLocation(prop, call),
              "field",
              `field '${name}' of ${describeLayoutType(l.type)}`,
              at,
            );
            if (p) return p;
          }
        }
        return null;
      case "value": {
        // A Value union: each member renders by its own rules. JSON has no text for a top-level
        // `undefined` (JSON.stringify returns undefined itself), so that member is refused there.
        if (mode === "json" && pos === "value" && vt.members.some((m) => m.kind === "undefined")) {
          return `${where} can be undefined`;
        }
        const parts = t.isUnion() ? t.types : [t];
        for (const m of parts) {
          if (m.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) continue;
          const p = walk(m, pos, where, at);
          if (p) return p;
        }
        return null;
      }
      case "promise":
        return `${where} is a Promise, whose printed state Node reads from the event loop`;
      case "unknown":
        return `${where} is \`unknown\` (a caught value), whose rendering depends on what was thrown (Node prints an Error with its stack trace)`;
      case "opaque":
        return `${where} is an opaque \`${vt.name}\` handle`;
      default: {
        const never: never = vt;
        return ice(`render-rules: unhandled ${(never as { kind: string }).kind}`);
      }
    }
  }

  function describeLayoutType(t: ts.Type): string {
    const s = checker.typeToString(t);
    return s.length > 60 ? "an object" : `\`${s}\``;
  }
}

// console.log(...) and JSON.stringify(...), matched by name exactly as lower matches them.
function renderingMode(call: ts.CallExpression): Mode | null {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)) return null;
  const recv = callee.expression.text;
  if (recv === "console" && callee.name.text === "log") return "inspect";
  if (recv === "JSON" && callee.name.text === "stringify") return "json";
  return null;
}
