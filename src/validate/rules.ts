// Tailored rejection rules: constructs we reject with a specific code + rewrite, rather than
// the generic CS1000. Each returns a Diagnostic if it matches `node`, else null. These are
// the "better message" layer on top of default-deny — several (any, enum, ==, delete, with,
// index signatures, decorators, namespaces, eval) are PERMANENT non-goals per PLAN.md.

import ts from "typescript";
import type { Diagnostic } from "../diagnostics.js";
import { CODE, type Code } from "./codes.js";
import { spanOf } from "./validate.js";

export function tailoredRejection(node: ts.Node, sf: ts.SourceFile): Diagnostic | null {
  const hit = (code: Code, message: string, suggestion: string): Diagnostic => ({
    code,
    message,
    span: spanOf(node, sf),
    suggestion,
  });

  switch (node.kind) {
    case ts.SyntaxKind.AnyKeyword:
      return hit(CODE.ANY_TYPE, "`any` is not allowed", "give the value a concrete type");

    case ts.SyntaxKind.EnumDeclaration:
      return hit(
        CODE.ENUM,
        "`enum` is not supported",
        "use an `as const` object: `const Color = { Red: 0, Green: 1 } as const`",
      );

    case ts.SyntaxKind.NonNullExpression:
      return hit(
        CODE.NON_NULL_ASSERTION,
        "the non-null assertion `!` is not allowed",
        "narrow with an explicit `if (x !== null && x !== undefined)` check",
      );

    case ts.SyntaxKind.DeleteExpression:
      return hit(
        CODE.DELETE,
        "the `delete` operator is not supported",
        "model optional presence with `T | undefined` or a Map",
      );

    case ts.SyntaxKind.IndexSignature:
      return hit(
        CODE.INDEX_SIGNATURE,
        "index signatures (`[k: string]: T`) are not supported",
        "use `Map<string, T>` for dynamic keys",
      );

    case ts.SyntaxKind.Decorator:
      return hit(CODE.DECORATOR, "decorators are not supported", "call the wrapper explicitly");

    case ts.SyntaxKind.ModuleDeclaration:
      return hit(
        CODE.NAMESPACE,
        "`namespace` / `module` blocks are not supported",
        "use ESM `import` / `export`",
      );

    case ts.SyntaxKind.WithStatement:
      return hit(CODE.WITH, "`with` is not supported", "access properties explicitly");

    // Regex literals sort into the literal-token band that default-deny treats as trivial, so they
    // slip the allowlist and would ICE in lowering. Reject here (tailored pass walks the whole tree)
    // until regex lands as a real feature.
    case ts.SyntaxKind.RegularExpressionLiteral:
      return hit(
        CODE.REGEX,
        "regular expression literals are not supported yet",
        "regex is a later phase; use string methods (includes/indexOf/replace/split) for now",
      );

    case ts.SyntaxKind.VariableDeclarationList:
      // `var` has function-scoped hoisting semantics we don't model. Only let/const.
      if (!(node.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const))) {
        return hit(CODE.VAR, "`var` is not supported", "use `let` or `const`");
      }
      return null;

    case ts.SyntaxKind.BinaryExpression:
      return checkBinary(node as ts.BinaryExpression, hit);

    case ts.SyntaxKind.AsExpression:
    case ts.SyntaxKind.TypeAssertionExpression:
      return checkCast(node as ts.AsExpression | ts.TypeAssertion, hit);

    case ts.SyntaxKind.CallExpression:
      return checkCall(node as ts.CallExpression, hit);

    case ts.SyntaxKind.NewExpression:
      return checkNew(node as ts.NewExpression, hit);

    default:
      return null;
  }
}

type Hit = (code: Code, message: string, suggestion: string) => Diagnostic;

function checkBinary(node: ts.BinaryExpression, hit: Hit): Diagnostic | null {
  const op = node.operatorToken.kind;
  if (op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken) {
    const strict = op === ts.SyntaxKind.EqualsEqualsToken ? "===" : "!==";
    const loose = op === ts.SyntaxKind.EqualsEqualsToken ? "==" : "!=";
    return hit(CODE.EQEQ, `\`${loose}\` is not supported`, `use \`${strict}\``);
  }
  return null;
}

function checkCast(node: ts.AsExpression | ts.TypeAssertion, hit: Hit): Diagnostic | null {
  const k = node.type.kind;
  if (k === ts.SyntaxKind.AnyKeyword || k === ts.SyntaxKind.UnknownKeyword) {
    return hit(
      CODE.AS_ANY,
      "`as any` / `as unknown` escapes the type system",
      "narrow the value properly, or redesign so the type is known",
    );
  }
  return null;
}

function isNamedIdent(e: ts.Expression, name: string): boolean {
  return ts.isIdentifier(e) && e.text === name;
}

function checkCall(node: ts.CallExpression, hit: Hit): Diagnostic | null {
  if (isNamedIdent(node.expression, "eval")) {
    return hit(CODE.EVAL_OR_FUNCTION_CTOR, "`eval` is not supported", "there is no dynamic eval");
  }
  return null;
}

function checkNew(node: ts.NewExpression, hit: Hit): Diagnostic | null {
  if (isNamedIdent(node.expression, "Function")) {
    return hit(
      CODE.EVAL_OR_FUNCTION_CTOR,
      "the `Function` constructor is not supported",
      "write the function directly",
    );
  }
  return null;
}
