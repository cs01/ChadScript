// The subset validator: a default-DENY AST walk. The subset is DEFINED here, in code —
// a construct reaches the rest of the pipeline only if this walk admits it. Two layers:
//
//   1. Tailored rejections (checkNode): constructs we want to reject with a specific code
//      and a rewrite ("use === instead of =="). These run first for a better message.
//   2. Default deny: any SyntaxKind not in ALLOWED_KINDS is rejected as CS1000
//      "not in the subset (yet)". This is the guardrail — an un-considered construct fails
//      closed here instead of reaching codegen and miscompiling.
//
// ALLOWED_KINDS grows one phase at a time, each addition paired with a differential fixture.
// It is deliberately tiny right now (Phase 0: enough for `console.log(...)` + literals).

import ts from "typescript";
import { type Diagnostic, type Span, DiagnosticError } from "../diagnostics.js";
import type { LoadedProgram } from "../frontend/program.js";
import { CODE } from "./codes.js";
import { tailoredRejection } from "./rules.js";
import { tdzDiagnostics } from "./tdz.js";

// SyntaxKinds the walker is allowed to descend through. PHASE 0 surface only — extend with
// each phase, never silently. Anything absent here is rejected by default-deny.
export const ALLOWED_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.SourceFile,
  ts.SyntaxKind.EndOfFileToken,
  ts.SyntaxKind.ExpressionStatement,
  ts.SyntaxKind.CallExpression,
  ts.SyntaxKind.PropertyAccessExpression,
  ts.SyntaxKind.Identifier,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NullKeyword,
  // Template literals.
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateExpression,
  ts.SyntaxKind.TemplateSpan,
  // Arithmetic (Phase 1). Operator granularity is gated separately below — admitting the kind
  // does NOT admit every operator of that kind.
  ts.SyntaxKind.BinaryExpression,
  ts.SyntaxKind.InstanceOfKeyword, // the `instanceof` operator token (gated in SUPPORTED_BINARY_OPS)
  ts.SyntaxKind.PrefixUnaryExpression,
  ts.SyntaxKind.ParenthesizedExpression,
  ts.SyntaxKind.ConditionalExpression, // ternary `c ? a : b`
  // Variables (Phase 1). `var` is rejected by tailored rule; only let/const reach here.
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.VariableDeclarationList,
  ts.SyntaxKind.VariableDeclaration,
  // Control flow (Phase 1).
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.ArrayLiteralExpression,
  ts.SyntaxKind.SpreadElement, // `[...arr]` in an array literal
  ts.SyntaxKind.ElementAccessExpression, // arr[i] (→ element | undefined)
  // Objects (Phase 2): closed-shape literals + interface/type-literal shapes (type-only nodes
  // are inert; PropertyAssignment/Shorthand build the literal).
  ts.SyntaxKind.ObjectLiteralExpression,
  ts.SyntaxKind.PropertyAssignment,
  ts.SyntaxKind.ShorthandPropertyAssignment,
  ts.SyntaxKind.SpreadAssignment, // `{ ...src }` in an object literal
  // Object destructuring in a variable declaration: `const { a, b: x } = obj`. Lowered to a temp
  // plus one binding per field. Array destructuring (ArrayBindingPattern) stays rejected; nested
  // patterns / defaults / rest reject in lowering.
  ts.SyntaxKind.ObjectBindingPattern,
  ts.SyntaxKind.BindingElement,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.PropertySignature,
  ts.SyntaxKind.TypeLiteral,
  ts.SyntaxKind.TypeReference,
  // Classes (Phase 2): declaration, members, `new`, `this`.
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.PropertyDeclaration,
  ts.SyntaxKind.NewExpression,
  ts.SyntaxKind.ThisKeyword,
  ts.SyntaxKind.HeritageClause, // `extends Base`
  ts.SyntaxKind.ExpressionWithTypeArguments, // the `Base` in an extends clause
  ts.SyntaxKind.SuperKeyword, // `super(...)` / `super.method(...)`
  ts.SyntaxKind.OverrideKeyword, // `override method()` (virtual dispatch via vtable)
  // Closures / first-class functions.
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ReturnStatement,
  ts.SyntaxKind.ThrowStatement, // `throw`
  ts.SyntaxKind.TryStatement, // `try { } catch { }`
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.BreakStatement,
  ts.SyntaxKind.ContinueStatement,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.CaseBlock,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.DefaultClause,
  ts.SyntaxKind.Block,
  // Functions (Phase 1).
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.Parameter,
  // Modules: named imports/exports between local `.ts` files. Purely a name-resolution concern —
  // tsc resolves the graph and every binding is already keyed by its symbol, so an import is
  // inert at lowering. The FORMS that would need runtime machinery (default, namespace, re-export,
  // dynamic) are rejected in rules.ts; see frontend/module-graph.ts for initialization order.
  ts.SyntaxKind.ImportDeclaration,
  ts.SyntaxKind.ImportClause,
  ts.SyntaxKind.NamedImports,
  ts.SyntaxKind.ImportSpecifier,
  ts.SyntaxKind.ExportDeclaration,
  ts.SyntaxKind.NamedExports,
  ts.SyntaxKind.ExportSpecifier,
  ts.SyntaxKind.ExportKeyword, // the `export` modifier on a declaration
  // async/await (Phase 6). Compiled to stackful fibers + a microtask event loop (runtime/async.c);
  // an async function's `Promise<T>` return, `await`, rejection-as-throw across await, unhandled-
  // rejection exit code, and microtask ordering all match Node (differential fixtures async-*.ts).
  ts.SyntaxKind.AsyncKeyword,
  ts.SyntaxKind.AwaitExpression,
  // Primitive type annotations (type position only; lower reads types from the checker, so
  // these nodes are inert — admitting them just lets annotations through).
  ts.SyntaxKind.NumberKeyword,
  ts.SyntaxKind.StringKeyword,
  ts.SyntaxKind.BooleanKeyword,
  ts.SyntaxKind.VoidKeyword,
  ts.SyntaxKind.ArrayType, // `T[]` annotation (type position, inert)
  ts.SyntaxKind.FunctionType,
  // `(a: number) => number` inside another type, e.g. an array of functions. Parentheses in a
  // TYPE have no runtime meaning — the checker has already resolved the type they group.
  ts.SyntaxKind.ParenthesizedType, // `(x: T) => U` annotation (type position, inert)
  ts.SyntaxKind.UnionType, // `T | null` / `T | undefined` annotation (type position, inert)
  ts.SyntaxKind.LiteralType, // `null` / `undefined` / literal in type position (inert)
  ts.SyntaxKind.UndefinedKeyword, // `undefined` annotation (type position, inert)
  // `i++` / `i--` (statement/for-update position). Only ++/-- exist as postfix, so the whole
  // kind is admitted; prefix ++/-- is gated via SUPPORTED_UNARY_OPS below.
  ts.SyntaxKind.PostfixUnaryExpression,
]);

// Supported operators, checked per-operator so an admitted expression kind doesn't smuggle in
// operators codegen can't lower. `==`/`!=` are handled earlier by tailored rejection (CS1203).
export const SUPPORTED_BINARY_OPS: ReadonlySet<ts.SyntaxKind> = new Set([
  // Arithmetic (number → number).
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  // Comparison (→ boolean).
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  // Logical (short-circuit, value semantics).
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken, // ?? (nullish coalescing)
  ts.SyntaxKind.InstanceOfKeyword, // `x instanceof Class`
  // Bitwise / shift (JS int32 semantics).
  ts.SyntaxKind.AmpersandToken,
  ts.SyntaxKind.BarToken,
  ts.SyntaxKind.CaretToken,
  ts.SyntaxKind.LessThanLessThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
  // Assignment (statement form; lower handles `name = ...` / `name <op>= ...`).
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
]);

export const SUPPORTED_UNARY_OPS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.PlusPlusToken, // ++i
  ts.SyntaxKind.MinusMinusToken, // --i
  ts.SyntaxKind.ExclamationToken, // !x
  ts.SyntaxKind.TildeToken, // ~x
]);

export function validate(loaded: LoadedProgram): void {
  const diagnostics: Diagnostic[] = [];
  for (const sf of loaded.sourceFiles) {
    // Two passes, tailored first. A tailored rejection is a specific, actionable message
    // ("use ===") and must be found even when it sits inside a construct the allowlist has
    // not admitted yet — so it walks the WHOLE tree, unpruned. Default-deny runs only when
    // the file is free of tailored rejections, otherwise every not-yet-supported wrapper
    // (function bodies, var statements) would bury the real message under CS1000 noise.
    const tailored: Diagnostic[] = [];
    collectTailored(sf, sf, loaded.checker, tailored);
    if (tailored.length > 0) {
      diagnostics.push(...tailored);
      continue;
    }
    defaultDeny(sf, sf, diagnostics);
    diagnostics.push(...tdzDiagnostics(sf, loaded.checker));
  }
  diagnostics.push(...duplicateClassNames(loaded.sourceFiles));
  if (diagnostics.length > 0) throw new DiagnosticError(diagnostics);
}

// Class names are program-global in the backend: methods are emitted as `Class.method` and the
// vtable/instanceof tables are keyed by the source name. Two files each declaring `class Point`
// would therefore collide into one set of symbols — a silent wrong-dispatch, so it is rejected.
// (Functions and variables are immune: they are already renamed per tsc symbol.)
function duplicateClassNames(sourceFiles: readonly ts.SourceFile[]): Diagnostic[] {
  const seen = new Map<string, ts.SourceFile>();
  const out: Diagnostic[] = [];
  for (const sf of sourceFiles) {
    for (const stmt of sf.statements) {
      if (!ts.isClassDeclaration(stmt) || !stmt.name) continue;
      const name = stmt.name.text;
      const prior = seen.get(name);
      if (prior) {
        out.push({
          code: CODE.DUPLICATE_CLASS,
          message: `class \`${name}\` is declared in two files (also in \`${prior.fileName}\`)`,
          span: spanOf(stmt.name, sf),
          suggestion:
            "class names are global in the generated code; rename one of them so their " +
            "methods and vtables stay distinct",
        });
        continue;
      }
      seen.set(name, sf);
    }
  }
  return out;
}

function collectTailored(
  node: ts.Node,
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
  out: Diagnostic[],
): void {
  const hit = tailoredRejection(node, sf, checker);
  if (hit) out.push(hit);
  ts.forEachChild(node, (child) => collectTailored(child, sf, checker, out));
}

// Reject any node kind not on the allowlist. Descends only through admitted kinds — an
// un-admitted kind is reported once and not recursed into (its children are moot).
function defaultDeny(node: ts.Node, sf: ts.SourceFile, out: Diagnostic[]): void {
  if (!isTrivialToken(node.kind) && !ALLOWED_KINDS.has(node.kind)) {
    out.push(notInSubset(ts.SyntaxKind[node.kind], node, sf));
    return;
  }
  // Operator-granularity gating: an admitted expression kind must not smuggle in an operator
  // codegen can't lower. Reject the unsupported operator specifically, then stop descending.
  if (ts.isBinaryExpression(node) && !SUPPORTED_BINARY_OPS.has(node.operatorToken.kind)) {
    out.push(notInSubset(`operator ${ts.tokenToString(node.operatorToken.kind)}`, node, sf));
    return;
  }
  if (ts.isPrefixUnaryExpression(node) && !SUPPORTED_UNARY_OPS.has(node.operator)) {
    out.push(notInSubset(`unary operator ${ts.tokenToString(node.operator)}`, node, sf));
    return;
  }
  ts.forEachChild(node, (child) => defaultDeny(child, sf, out));
}

function notInSubset(what: string, node: ts.Node, sf: ts.SourceFile): Diagnostic {
  return {
    code: CODE.NOT_IN_SUBSET,
    message: `${what} is not in the ChadScript subset yet`,
    span: spanOf(node, sf),
    suggestion: "this construct has no allowlist rule + fixture yet; see PLAN.md phases",
  };
}

// Punctuation and template-fragment tokens are not independently gated — their parent node kind
// is what the allowlist decides on. But literal-VALUE tokens (Numeric/BigInt/String/Jsx/Regex/
// NoSubstitutionTemplate, the FirstLiteralToken..LastLiteralToken band) are semantically load-
// bearing: each must be individually allowlisted or rejected. Leaving them in the trivial band
// let un-admitted literals (bigint, JSX text, regex) silently slip default-deny and ICE in
// lowering — a fail-OPEN hole. Excluding them makes the admitted ones (StringLiteral, NumericLiteral,
// NoSubstitutionTemplateLiteral) pass via ALLOWED_KINDS and the rest reject as CS1000.
function isTrivialToken(kind: ts.SyntaxKind): boolean {
  if (kind >= ts.SyntaxKind.FirstLiteralToken && kind <= ts.SyntaxKind.LastLiteralToken) {
    return false;
  }
  return kind >= ts.SyntaxKind.FirstToken && kind <= ts.SyntaxKind.LastPunctuation;
}

export function spanOf(node: ts.Node, sf: ts.SourceFile): Span {
  const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return { file: sf.fileName, line: line + 1, col: character + 1 };
}
