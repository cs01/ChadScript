// CS1238 (as for console.log and JSON.stringify): a string conversion (`String(x)`, `${x}`, `"s" + x`, `s += x`, `xs.join()`) whose result
// Node computes by running code the compiler cannot pick statically:
//   - a function converts to its source text, a timer handle to its id;
//   - an object with its own `valueOf` (which `+` prefers) or its own `toString()` that the STATIC
//     type does not declare (a subclass or an object literal passed through an interface adds it),
//     or one inside an array or a union, where each element would need its own dispatch.
// Everything else converts: arrays join, objects without their own toString are
// "[object Object]", Map/Set/Promise their tags, and an object whose static type declares
// toString() is converted by calling it (lower/to-string.ts).

import ts from "typescript";
import type { Diagnostic } from "../diagnostics.js";
import type { LayoutAnalysis } from "../lower/layouts.js";
import { UnrepresentableTypeError, valueTypeOfTsType } from "../lower/type-translation.js";
import { ownMember } from "../lower/to-string.js";
import type { ValueType } from "../hir/types.js";
import { CODE } from "./codes.js";
import { spanOf } from "./validate.js";

export function stringConversionDiagnostic(
  node: ts.Node,
  analysis: LayoutAnalysis,
  checker: ts.TypeChecker,
): Diagnostic | null {
  for (const [operand, direct] of convertedOperands(node, checker)) {
    const problem = conversionProblem(checker.getTypeAtLocation(operand), operand, direct);
    if (problem) {
      return {
        code: CODE.UNRENDERABLE_VALUE,
        message: `converting \`${operand.getText()}\` to a string is not supported: it can be ${problem}`,
        span: spanOf(operand, operand.getSourceFile()),
        suggestion:
          "build the text from the fields you need (`${p.name}`); an object whose declared class " +
          "or interface has a `toString(): string` method converts by calling it",
      };
    }
  }
  return null;

  // What `t` can hold that has no static string form, or null. `direct` is false inside an array
  // (its elements are joined in one loop that cannot call per-element methods).
  function conversionProblem(t: ts.Type, at: ts.Node, direct: boolean): string | null {
    const parts = t.isUnion() ? t.types : [t];
    for (const p of parts) {
      switch (kindOf(p, at)) {
        case "function":
          return "a function, which Node converts to its source text";
        case "opaque":
          return "a timer handle, which Node converts to its numeric id";
        case "object": {
          const holders = [p, ...analysis.reachingType(p).map((l) => l.type)];
          if (holders.some((h) => ownMember(h, "valueOf", checker))) {
            return "an object with its own `valueOf()`";
          }
          if (!holders.some((h) => ownMember(h, "toString", checker))) break;
          if (!direct || t.isUnion()) {
            return "an object with its own `toString()` inside an array or a union";
          }
          if (!ownMember(p, "toString", checker)) {
            return "an object whose own `toString()` its declared type does not declare";
          }
          break;
        }
        case "array":
          for (const e of checker.getTypeArguments(p as ts.TypeReference)) {
            const problem = conversionProblem(e, at, false);
            if (problem) return problem;
          }
          break;
        default:
          break;
      }
    }
    return null;
  }

  function kindOf(t: ts.Type, at: ts.Node): ValueType["kind"] | null {
    try {
      return valueTypeOfTsType(t, at, checker).kind;
    } catch (e) {
      if (e instanceof UnrepresentableTypeError) return null; // reported where it is declared
      throw e;
    }
  }
}

// The operands `node` converts to strings, each with whether it is converted on its own (`direct`)
// rather than as the elements of an array being joined.
function convertedOperands(node: ts.Node, checker: ts.TypeChecker): [ts.Expression, boolean][] {
  if (ts.isTemplateSpan(node)) return [[node.expression, true]];
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    const isString = (e: ts.Node): boolean =>
      (checker.getTypeAtLocation(e).flags & ts.TypeFlags.StringLike) !== 0;
    if (op === ts.SyntaxKind.PlusToken && isString(node)) {
      return [node.left, node.right].filter((e) => !isString(e)).map((e) => [e, true]);
    }
    if (op === ts.SyntaxKind.PlusEqualsToken && isString(node.left) && !isString(node.right)) {
      return [[node.right, true]];
    }
    return [];
  }
  if (!ts.isCallExpression(node)) return [];
  const callee = node.expression;
  const arg = node.arguments[0];
  if (ts.isIdentifier(callee) && callee.text === "String" && arg && isAmbient(callee, checker)) {
    return [[arg, true]];
  }
  // `xs.join()`: the receiver's elements are what get converted.
  if (ts.isPropertyAccessExpression(callee) && callee.name.text === "join") {
    const recv = callee.expression;
    const t = checker.getTypeAtLocation(recv);
    if (t.symbol?.name === "Array" || checker.isTupleType(t)) return [[recv, true]];
  }
  return [];
}

function isAmbient(id: ts.Identifier, checker: ts.TypeChecker): boolean {
  const decls = checker.getSymbolAtLocation(id)?.declarations ?? [];
  return decls.length > 0 && decls.every((d) => d.getSourceFile().isDeclarationFile);
}
