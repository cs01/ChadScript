// What `new Map(...)` / `new Set(...)` may be given. A Map is built from an array literal of
// `[key, value]` literals (lower/map-new.ts turns it into `set` calls; a pair is a tuple of two
// types, which has no array representation, so a pair can never be a value of its own). A Set is
// built from an array.

import ts from "typescript";
import type { Diagnostic } from "../diagnostics.js";
import { CODE } from "./codes.js";
import type { Hit } from "./type-rules.js";

export function checkCollectionNew(
  node: ts.NewExpression,
  hit: Hit,
  checker: ts.TypeChecker,
): Diagnostic | null {
  if (!ts.isIdentifier(node.expression)) return null;
  const name = node.expression.text;
  if (name !== "Map" && name !== "Set") return null;
  const decls = checker.getSymbolAtLocation(node.expression)?.declarations ?? [];
  if (!decls.every((d) => d.getSourceFile().isDeclarationFile)) return null;
  const arg = node.arguments?.[0];
  if (!arg) return null;
  if (name === "Set") {
    const t = checker.getTypeAtLocation(arg);
    if (t.symbol?.name === "Array" || checker.isTupleType(t)) return null;
    return hit(
      CODE.NOT_IN_SUBSET,
      "`new Set(...)` is only supported with an array",
      "pass an array (`new Set(xs)`), or add the elements one by one with `add`",
    );
  }
  const pairs =
    ts.isArrayLiteralExpression(arg) &&
    arg.elements.every(
      (e) =>
        ts.isArrayLiteralExpression(e) &&
        e.elements.length === 2 &&
        e.elements.every((x) => !ts.isSpreadElement(x)),
    );
  if (pairs) return null;
  return hit(
    CODE.NOT_IN_SUBSET,
    "`new Map(...)` is only supported with an array literal of `[key, value]` pairs",
    'write the pairs inline (`new Map([["a", 1], ["b", 2]])`), or create an empty Map and ' +
      "`set` each entry in a loop",
  );
}
