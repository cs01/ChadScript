// `f(...xs)`: a spread argument is admitted only where it fills a rest parameter of one of the
// program's own functions (lower packs it into the rest array). Library calls take a fixed list of
// lowered arguments (`arr.push(...xs)`, `Math.max(...xs)`), so a spread there is rejected with the
// loop or reduce that says the same thing.

import ts from "typescript";
import type { Diagnostic } from "../diagnostics.js";
import { CODE } from "./codes.js";
import type { Hit } from "./type-rules.js";

export function checkCallSpread(
  node: ts.Node,
  hit: Hit,
  checker: ts.TypeChecker,
): Diagnostic | null {
  if (!ts.isSpreadElement(node)) return null;
  const call = node.parent;
  if (!ts.isCallExpression(call) && !ts.isNewExpression(call)) return null;
  const params = checker.getResolvedSignature(call)?.parameters ?? [];
  const last = params[params.length - 1]?.valueDeclaration;
  const index = (call.arguments ?? ([] as readonly ts.Expression[])).indexOf(node);
  if (
    last !== undefined &&
    ts.isParameter(last) &&
    last.dotDotDotToken !== undefined &&
    !last.getSourceFile().isDeclarationFile &&
    index >= params.length - 1
  ) {
    return null;
  }
  const callee = call.expression.getText();
  const own =
    last !== undefined && !last.getSourceFile().isDeclarationFile && !callee.startsWith("Math.");
  return hit(
    CODE.NOT_IN_SUBSET,
    `spreading an array into the arguments of \`${callee}\` is not supported`,
    callee.endsWith(".push")
      ? "push the elements in a loop: `for (const x of xs) arr.push(x)`"
      : own
        ? "pass the elements explicitly, or give the function a rest parameter (`...xs: number[]`)"
        : "pass the elements explicitly, or loop or reduce over the array " +
          "(`xs.reduce((m, x) => Math.max(m, x), -Infinity)`)",
  );
}
