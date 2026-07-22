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

// SyntaxKinds the walker is allowed to descend through. PHASE 0 surface only — extend with
// each phase, never silently. Anything absent here is rejected by default-deny.
const ALLOWED_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
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
    collectTailored(sf, sf, tailored);
    if (tailored.length > 0) {
      diagnostics.push(...tailored);
      continue;
    }
    defaultDeny(sf, sf, diagnostics);
  }
  if (diagnostics.length > 0) throw new DiagnosticError(diagnostics);
}

function collectTailored(node: ts.Node, sf: ts.SourceFile, out: Diagnostic[]): void {
  const hit = tailoredRejection(node, sf);
  if (hit) out.push(hit);
  ts.forEachChild(node, (child) => collectTailored(child, sf, out));
}

// Reject any node kind not on the allowlist. Descends only through admitted kinds — an
// un-admitted kind is reported once and not recursed into (its children are moot).
function defaultDeny(node: ts.Node, sf: ts.SourceFile, out: Diagnostic[]): void {
  if (!isTrivialToken(node.kind) && !ALLOWED_KINDS.has(node.kind)) {
    out.push({
      code: CODE.NOT_IN_SUBSET,
      message: `${ts.SyntaxKind[node.kind]} is not in the ChadScript subset yet`,
      span: spanOf(node, sf),
      suggestion: "this construct has no allowlist rule + fixture yet; see PLAN.md phases",
    });
    return;
  }
  ts.forEachChild(node, (child) => defaultDeny(child, sf, out));
}

// Punctuation and structural keyword tokens are not independently gated — their parent node
// kind is what the allowlist decides on. Everything from the first keyword up to the last
// punctuation token falls in this band.
function isTrivialToken(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstToken && kind <= ts.SyntaxKind.LastPunctuation;
}

export function spanOf(node: ts.Node, sf: ts.SourceFile): Span {
  const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return { file: sf.fileName, line: line + 1, col: character + 1 };
}
