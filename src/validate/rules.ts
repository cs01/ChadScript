// Tailored rejection rules: constructs we reject with a specific code + rewrite, rather than
// the generic CS1000. Each returns a Diagnostic if it matches `node`, else null. These are
// the "better message" layer on top of default-deny — several (any, enum, ==, delete, with,
// index signatures, decorators, namespaces, eval) are PERMANENT non-goals per PLAN.md.

import ts from "typescript";
import type { Diagnostic } from "../diagnostics.js";
import { CODE, type Code } from "./codes.js";
import { spanOf } from "./validate.js";

export function tailoredRejection(
  node: ts.Node,
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
): Diagnostic | null {
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

    case ts.SyntaxKind.Parameter: {
      // Default (`x = v`) and optional (`x?`) parameters reach a lowering ICE today. Reject at
      // validate until argument-defaulting is implemented. A plain `x: T` param is unaffected.
      const p = node as ts.ParameterDeclaration;
      if (p.questionToken) {
        return hit(
          CODE.PARAM_FORM,
          "optional parameters (`x?`) are not supported yet",
          "declare it `x: T | undefined` and pass `undefined` explicitly at the call site",
        );
      }
      if (p.initializer) {
        return hit(
          CODE.PARAM_FORM,
          "default parameter values are not supported yet",
          "apply the default in the body: `const v = x === undefined ? DEFAULT : x`",
        );
      }
      return null;
    }

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
      return checkBinary(node as ts.BinaryExpression, hit, checker);

    case ts.SyntaxKind.PropertyAccessExpression:
      // `s.charCodeAt(...)`: byte value ≠ Node's UTF-16 code unit for non-ASCII. Gated (CS1216).
      if ((node as ts.PropertyAccessExpression).name.text === "charCodeAt") {
        return hit(
          CODE.STRING_UNICODE_OP,
          "`charCodeAt` is not supported yet",
          "it needs UTF-16 code-unit semantics over UTF-8 storage; use charAt for now",
        );
      }
      return null;

    case ts.SyntaxKind.ElementAccessExpression:
      // `s[i]` on a string yields a byte, not Node's UTF-16 code-unit character, for non-ASCII.
      // Gated (CS1216). Array element access (the common case) is unaffected.
      if (isStringTyped((node as ts.ElementAccessExpression).expression, checker)) {
        return hit(
          CODE.STRING_UNICODE_OP,
          "indexing a string with `[i]` is not supported yet",
          "it needs UTF-16 code-unit semantics; use `.charAt(i)` (or `.at(i)`) for now",
        );
      }
      return null;

    case ts.SyntaxKind.ForOfStatement:
      // `for (const c of str)` iterates UTF-8 bytes here, not Node's code points. Gated (CS1216).
      // Iterating arrays/Map/Set is unaffected.
      if (isStringTyped((node as ts.ForOfStatement).expression, checker)) {
        return hit(
          CODE.STRING_UNICODE_OP,
          "iterating a string with `for...of` is not supported yet",
          "it needs UTF-16/code-point semantics; index with `.charAt` over `.length` for now",
        );
      }
      return null;

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

const RELATIONAL_OPS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
]);

function checkBinary(
  node: ts.BinaryExpression,
  hit: Hit,
  checker: ts.TypeChecker,
): Diagnostic | null {
  const op = node.operatorToken.kind;
  if (op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken) {
    const strict = op === ts.SyntaxKind.EqualsEqualsToken ? "===" : "!==";
    const loose = op === ts.SyntaxKind.EqualsEqualsToken ? "==" : "!=";
    return hit(CODE.EQEQ, `\`${loose}\` is not supported`, `use \`${strict}\``);
  }
  // String `<`/`>`/`<=`/`>=`: byte-lexicographic order diverges from Node's UTF-16 code-unit order
  // for non-ASCII. Gated (CS1216) until exact semantics land. `===`/`!==` stay allowed (equality is
  // byte-exact for UTF-8). Uses the checker since the divergence is type-dependent.
  if (RELATIONAL_OPS.has(op) && isStringTyped(node.left, checker)) {
    return hit(
      CODE.STRING_UNICODE_OP,
      "relational comparison (`<` `>` `<=` `>=`) on strings is not supported yet",
      "it needs UTF-16 code-unit ordering; compare with === or compare numbers for now",
    );
  }
  return null;
}

// True when the expression's type is `string` (or a string literal type). Apparent type collapses
// string-literal unions to the primitive so `"a" < "b"` is caught too.
function isStringTyped(expr: ts.Expression, checker: ts.TypeChecker): boolean {
  const t = checker.getTypeAtLocation(expr);
  const base = checker.getBaseTypeOfLiteralType(t);
  return (base.flags & ts.TypeFlags.String) !== 0 || (t.flags & ts.TypeFlags.StringLiteral) !== 0;
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
  // JSON.* and Date.* are later phases — reject at validate so they fail closed with a rewrite,
  // rather than reaching the backend and ICE'ing (`unsupported method .stringify on object`).
  if (ts.isPropertyAccessExpression(node.expression)) {
    const recv = node.expression.expression;
    const m = node.expression.name.text;
    if (isNamedIdent(recv, "JSON") && (m === "stringify" || m === "parse")) {
      return hit(
        CODE.JSON_API,
        `\`JSON.${m}\` is not supported yet`,
        "JSON is a later phase; build or read the structure field-by-field for now",
      );
    }
    if (isNamedIdent(recv, "Date")) {
      return hit(CODE.DATE_API, `\`Date.${m}\` is not supported yet`, "Date is a later phase");
    }
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
  if (isNamedIdent(node.expression, "Date")) {
    return hit(CODE.DATE_API, "`new Date()` is not supported yet", "Date is a later phase");
  }
  return null;
}
