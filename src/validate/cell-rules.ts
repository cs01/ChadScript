// CS1241: a narrowed read of a variable a closure reassigns, where the narrowing may be stale.
//
// tsc narrows a `let` by assignment and by checks, and keeps that narrowing across calls even when
// a closure that reassigns the variable can run during the call (microsoft/TypeScript#9998). A
// variable shared with a closure (a heap cell, lower/cells.ts) whose declared type has more than
// one representation (a Value union, an optional, a union of object types) is therefore read at a
// narrowed type the value may no longer have, and lowering trusts that type to unbox it. Such a
// read is admitted only when no user code can run between the narrowing and the read: no call,
// `new` or `await` that could run user code precedes it in its function, or shares a loop with it.
// Everything else is rejected; reading through a closure (where tsc does not narrow a captured
// mutable variable) or re-checking right before use is the rewrite.

import ts from "typescript";
import type { Diagnostic } from "../diagnostics.js";
import type { LoadedProgram } from "../frontend/program.js";
import { findCellSymbols } from "../lower/cells.js";
import { UnrepresentableTypeError, valueTypeOfTsType } from "../lower/type-translation.js";
import { CODE } from "./codes.js";
import { spanOf } from "./validate.js";

function isFunctionLike(n: ts.Node): boolean {
  return (
    ts.isArrowFunction(n) ||
    ts.isFunctionExpression(n) ||
    ts.isFunctionDeclaration(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isConstructorDeclaration(n)
  );
}

function enclosingFunction(n: ts.Node): ts.Node {
  for (let p = n.parent; p; p = p.parent) if (isFunctionLike(p) || ts.isSourceFile(p)) return p;
  return n.getSourceFile();
}

function isLoop(n: ts.Node): boolean {
  return (
    ts.isForStatement(n) ||
    ts.isForOfStatement(n) ||
    ts.isForInStatement(n) ||
    ts.isWhileStatement(n) ||
    ts.isDoStatement(n)
  );
}

// A declared type whose narrowings change the machine representation or the field layout a read
// uses. A union of one representation (`boolean`, `"a" | "b"`) narrows harmlessly.
function narrowingMatters(t: ts.Type, at: ts.Node, checker: ts.TypeChecker): boolean {
  if (!(t.flags & ts.TypeFlags.Union)) return false;
  try {
    const vt = valueTypeOfTsType(t, at, checker);
    return vt.kind === "value" || vt.kind === "optional" || vt.kind === "object";
  } catch (e) {
    if (e instanceof UnrepresentableTypeError) return false; // reported where it is declared
    throw e;
  }
}

// Whether evaluating `n` can run user code: a call to anything declared outside the ambient
// declaration files, a builtin given a function argument (a callback), `new`, or `await` (which
// lets other fibers run).
function runsUserCode(n: ts.Node, checker: ts.TypeChecker): boolean {
  if (ts.isAwaitExpression(n) || ts.isNewExpression(n)) return true;
  if (!ts.isCallExpression(n)) return false;
  const sym = checker.getSymbolAtLocation(
    ts.isPropertyAccessExpression(n.expression) ? n.expression.name : n.expression,
  );
  const decl = sym?.declarations?.[0];
  if (!decl || !decl.getSourceFile().isDeclarationFile) return true;
  return n.arguments.some(
    (a) => checker.getSignaturesOfType(checker.getTypeAtLocation(a), ts.SignatureKind.Call).length,
  );
}

// Whether user code can run between entering `fn` and reaching `read`: a user-code expression of
// `fn` itself (nested functions only run when called, which is itself such an expression) that
// comes before the read in source order, or sits in a loop that also holds the read (it can run
// on an earlier iteration).
function userCodeCanPrecede(read: ts.Node, fn: ts.Node, checker: ts.TypeChecker): boolean {
  const loops = new Set<ts.Node>();
  for (let p = read.parent; p && p !== fn; p = p.parent) if (isLoop(p)) loops.add(p);
  let found = false;
  const visit = (n: ts.Node, inLoop: boolean): void => {
    if (found || isFunctionLike(n)) return;
    const loopHere = inLoop || loops.has(n);
    if (runsUserCode(n, checker) && (n.getStart() < read.getStart() || loopHere)) {
      found = true;
      return;
    }
    ts.forEachChild(n, (c) => visit(c, loopHere));
  };
  ts.forEachChild(fn, (c) => visit(c, false));
  return found;
}

export function cellNarrowingDiagnostics(loaded: LoadedProgram): Diagnostic[] {
  const checker = loaded.checker;
  const cells = findCellSymbols(loaded.sourceFiles, checker);
  if (cells.size === 0) return [];
  const out: Diagnostic[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const sym = checker.getSymbolAtLocation(node);
      const decl = sym?.valueDeclaration;
      const p = node.parent;
      const isWrite =
        ts.isBinaryExpression(p) &&
        p.left === node &&
        p.operatorToken.kind === ts.SyntaxKind.EqualsToken;
      if (sym && decl && cells.has(sym) && decl !== p && !isWrite) {
        const declared = checker.getTypeOfSymbolAtLocation(sym, decl);
        const here = checker.getTypeAtLocation(node);
        if (
          here !== declared &&
          narrowingMatters(declared, decl, checker) &&
          userCodeCanPrecede(node, enclosingFunction(node), checker)
        ) {
          out.push({
            code: CODE.STALE_NARROWING,
            message:
              `\`${node.text}\` is reassigned by a closure, so its narrowed type here can be stale ` +
              "(a call made after the narrowing may have run that closure)",
            span: spanOf(node, node.getSourceFile()),
            suggestion:
              `read it through a function, where tsc does not narrow it: ` +
              `\`const get = (): T => ${node.text};\`, then narrow the result of \`get()\``,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  for (const sf of loaded.sourceFiles) visit(sf);
  return out;
}
