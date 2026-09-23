// CS1238 for console.log's util.format pass: when the first argument can be a string and more
// follow, each later argument may meet a directive (src/hir/format-directives.ts; a literal format
// string decides exactly which, anything else can meet all of them). The conversions live in
// codegen/console-format.ts; this rejects the argument types a directive would render differently:
//
//   %s             a function (Node prints its source text)
//   %s %d %i %f    an object whose class or literal defines toString / valueOf (Node calls it;
//                  arrays count through their elements, which String() joins)
//   %j             what JSON.stringify cannot render (render-rules.ts json mode), except the
//                  top-level kinds %j spells itself: undefined, a function, a Map or Set
//   %o             a function anywhere inside (showHidden prints its length, name and prototype)
//
// Printing an argument plainly (%O, or appended) is console.log's own rendering, which
// render-rules.ts already checks for every argument.

import ts from "typescript";
import type { Diagnostic } from "../diagnostics.js";
import type { LayoutAnalysis } from "../lower/layouts.js";
import { UnrepresentableTypeError, valueTypeOfTsType } from "../lower/type-translation.js";
import type { ValueType } from "../hir/types.js";
import { ALL_DIRECTIVES, literalDirectives, type Directive } from "../hir/format-directives.js";
import { CODE } from "./codes.js";
import { spanOf } from "./validate.js";
import { renderWalker } from "./render-rules.js";

export function formatDiagnostic(
  call: ts.CallExpression,
  analysis: LayoutAnalysis,
  checker: ts.TypeChecker,
): Diagnostic | null {
  const args = call.arguments;
  if (args.length < 2) return null;
  let first: ts.Expression = args[0]!;
  while (ts.isParenthesizedExpression(first)) first = first.expression;
  const literal = ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first);
  if (!literal && !mayBeString(checker.getTypeAtLocation(first))) return null;
  const directives: Directive[][] = literal
    ? literalDirectives((first as ts.StringLiteralLike).text, args.length).map((d) => [d])
    : args.map(() => [...ALL_DIRECTIVES]);
  const json = renderWalker("json", call, analysis, checker);
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    const t = checker.getTypeAtLocation(arg);
    for (const d of directives[i]!) {
      const problem = directiveProblem(t, d, arg);
      if (problem) {
        return {
          code: CODE.UNRENDERABLE_VALUE,
          message: `console.log cannot render this argument under the \`%${d}\` directive: ${problem}`,
          span: spanOf(arg, arg.getSourceFile()),
          suggestion: literal
            ? "convert it to the text you want first (a template literal), or use `%O`"
            : "the first argument is a string that may hold % directives: log a literal format (`console.log('%s', s, x)`), or build the line with a template literal",
        };
      }
    }
  }
  return null;

  function directiveProblem(t: ts.Type, d: Directive, at: ts.Node): string | null {
    switch (d) {
      case "append":
      case "O":
      case "c":
        return null;
      case "s":
        if (parts(t).some((p) => kindOf(p, at) === "function")) {
          return "a function, which Node prints as its source text";
        }
        return toPrimitiveProblem(t, at, false);
      case "d":
      case "i":
      case "f":
        return toPrimitiveProblem(t, at, true);
      case "j":
        for (const p of parts(t)) {
          const k = kindOf(p, at);
          if (k === "function" || k === "map" || k === "set" || k === null) continue;
          const problem = json(p, "value", "the value", at);
          if (problem) return problem;
        }
        return null;
      case "o":
        return reachesFunction(t, at, new Set())
          ? "a value holding a function, which %o prints with its hidden properties"
          : null;
      default: {
        const never: never = d;
        return String(never);
      }
    }
  }

  // An object (or, where String() joins them, an array element) that converts itself.
  function toPrimitiveProblem(t: ts.Type, at: ts.Node, throughArrays: boolean): string | null {
    for (const p of parts(t)) {
      const k = kindOf(p, at);
      if (k === "object") {
        // The static type and every layout that can reach it (a literal passed through an
        // interface keeps its own methods).
        for (const holder of [p, ...analysis.reachingType(p).map((l) => l.type)]) {
          for (const name of ["toString", "valueOf"]) {
            const prop = checker.getPropertyOfType(holder, name);
            if (
              prop &&
              !(prop.declarations ?? []).every((x) => x.getSourceFile().isDeclarationFile)
            ) {
              return `an object with its own \`${name}\`, which Node calls`;
            }
          }
        }
      }
      if (k === "array" && throughArrays) {
        for (const e of checker.getTypeArguments(p as ts.TypeReference)) {
          const problem = toPrimitiveProblem(e, at, true);
          if (problem) return problem;
        }
      }
    }
    return null;
  }

  function reachesFunction(t: ts.Type, at: ts.Node, seen: Set<ts.Type>): boolean {
    if (seen.has(t)) return false;
    seen.add(t);
    for (const p of parts(t)) {
      switch (kindOf(p, at)) {
        case "function":
          return true;
        case "array":
        case "map":
        case "set":
          if (
            checker
              .getTypeArguments(p as ts.TypeReference)
              .some((e) => reachesFunction(e, at, seen))
          ) {
            return true;
          }
          break;
        case "object":
          for (const l of analysis.reachingType(p)) {
            for (const name of l.names) {
              const prop = checker.getPropertyOfType(l.type, name);
              if (
                prop &&
                reachesFunction(checker.getTypeOfSymbolAtLocation(prop, call), at, seen)
              ) {
                return true;
              }
            }
          }
          break;
        default:
          break;
      }
    }
    return false;
  }

  function kindOf(t: ts.Type, at: ts.Node): ValueType["kind"] | null {
    if (t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) return null;
    try {
      return valueTypeOfTsType(t, at, checker).kind;
    } catch (e) {
      if (e instanceof UnrepresentableTypeError) return null; // reported where it is declared
      throw e;
    }
  }
}

// The union constituents of `t` (itself when it is not a union), so each member is judged alone.
function parts(t: ts.Type): readonly ts.Type[] {
  return t.isUnion() ? t.types : [t];
}

function mayBeString(t: ts.Type): boolean {
  return parts(t).some((p) => (p.flags & ts.TypeFlags.StringLike) !== 0);
}
