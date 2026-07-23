// Temporal-dead-zone guard for module-scope variables.
//
// Top-level `let`/`const` are compiled to zero-initialized globals that `main` assigns when it
// reaches each declaration (see codegen's `globals` map). A function body can read one — that is
// the whole point — but if the read happens BEFORE main gets to the assignment, the program sees
// a zero where JavaScript throws `ReferenceError: Cannot access 'x' before initialization`. A
// zero is a silent wrong answer, so the shape is rejected instead.
//
// The check is per file, which is sufficient: modules are initialized in dependency order, so
// every other file's module variables are already assigned before this file's statements run.
// Only an intra-file "executes before it is declared" ordering can reach the dead zone.

import ts from "typescript";
import type { Diagnostic } from "../diagnostics.js";
import { CODE } from "./codes.js";

// Statements that only DECLARE. Everything else can run code at module load, and therefore can
// reach a function that reads a module variable declared further down.
function isDeclarationOnly(stmt: ts.Statement): boolean {
  return (
    ts.isFunctionDeclaration(stmt) ||
    ts.isClassDeclaration(stmt) ||
    ts.isInterfaceDeclaration(stmt) ||
    ts.isTypeAliasDeclaration(stmt) ||
    ts.isImportDeclaration(stmt) ||
    ts.isExportDeclaration(stmt) ||
    ts.isVariableStatement(stmt)
  );
}

// A variable statement can itself run code (`const x = f()`), so it bounds the dead zone too —
// but only from its own initializers, which is exactly what makes a LATER declaration unsafe.
function firstExecutablePosition(sf: ts.SourceFile): number {
  for (let i = 0; i < sf.statements.length; i++) {
    const stmt = sf.statements[i]!;
    if (ts.isVariableStatement(stmt)) {
      // `const x = compute()` executes at this point; a declaration after it is in the dead zone
      // for anything that call reaches.
      const runs = stmt.declarationList.declarations.some(
        (d) => d.initializer !== undefined && !isInertInitializer(d.initializer),
      );
      if (runs) return i;
      continue;
    }
    if (!isDeclarationOnly(stmt)) return i;
  }
  return sf.statements.length;
}

// Initializers that provably cannot call a function: literals, identifiers, and compositions of
// them. Anything else (a call, a `new`, a method access) might reach a function body.
function isInertInitializer(expr: ts.Expression): boolean {
  if (
    ts.isNumericLiteral(expr) ||
    ts.isStringLiteral(expr) ||
    ts.isNoSubstitutionTemplateLiteral(expr) ||
    expr.kind === ts.SyntaxKind.TrueKeyword ||
    expr.kind === ts.SyntaxKind.FalseKeyword ||
    expr.kind === ts.SyntaxKind.NullKeyword ||
    ts.isIdentifier(expr) ||
    ts.isArrowFunction(expr) ||
    ts.isFunctionExpression(expr)
  ) {
    return true;
  }
  if (ts.isPrefixUnaryExpression(expr)) return isInertInitializer(expr.operand);
  if (ts.isParenthesizedExpression(expr)) return isInertInitializer(expr.expression);
  if (ts.isBinaryExpression(expr)) {
    return isInertInitializer(expr.left) && isInertInitializer(expr.right);
  }
  if (ts.isArrayLiteralExpression(expr)) {
    return expr.elements.every((e) => isInertInitializer(e));
  }
  return false;
}

// Every module-scope variable symbol declared after `from`, mapped to the index of the top-level
// statement that declares it.
function lateModuleVars(
  sf: ts.SourceFile,
  from: number,
  checker: ts.TypeChecker,
): Map<ts.Symbol, { name: ts.Identifier; index: number }> {
  const out = new Map<ts.Symbol, { name: ts.Identifier; index: number }>();
  for (let i = from; i < sf.statements.length; i++) {
    const stmt = sf.statements[i]!;
    if (!ts.isVariableStatement(stmt)) continue;
    for (const d of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(d.name)) continue;
      const sym = checker.getSymbolAtLocation(d.name);
      if (sym) out.set(sym, { name: d.name, index: i });
    }
  }
  return out;
}

// The earliest top-level statement index from which a function can be CALLED. A `function`
// declaration is hoisted, so it is callable from the very top of the file. A function expression or
// arrow only exists once the statement holding it has run — so it cannot be called before that
// point, and it cannot observe a variable declared above it in the dead zone.
function earliestCallableIndex(fn: ts.Node, sf: ts.SourceFile): number {
  let hoisted = false;
  let node: ts.Node = fn;
  while (node.parent && node.parent !== sf) {
    if (ts.isFunctionDeclaration(node)) hoisted = true;
    node = node.parent;
  }
  if (ts.isFunctionDeclaration(node)) hoisted = true;
  if (hoisted) return 0;
  return sf.statements.indexOf(node as ts.Statement);
}

export function tdzDiagnostics(sf: ts.SourceFile, checker: ts.TypeChecker): Diagnostic[] {
  const from = firstExecutablePosition(sf);
  if (from >= sf.statements.length) return [];
  const late = lateModuleVars(sf, from, checker);
  if (late.size === 0) return [];

  const out: Diagnostic[] = [];
  const reported = new Set<ts.Symbol>();

  // A read is a hazard only if the reading function could RUN before the declaration does: the
  // function must be reachable from a statement that precedes the declaration.
  const walkBody = (node: ts.Node, callableFrom: number): void => {
    if (ts.isIdentifier(node)) {
      const sym = checker.getSymbolAtLocation(node);
      const decl = sym ? late.get(sym) : undefined;
      if (sym && decl && !reported.has(sym) && callableFrom < decl.index) {
        reported.add(sym);
        const { line, character } = sf.getLineAndCharacterOfPosition(decl.name.getStart(sf));
        out.push({
          code: CODE.TDZ_MODULE_VAR,
          message:
            `\`${decl.name.text}\` is read by a function that can run before this declaration ` +
            `is initialized`,
          span: { file: sf.fileName, line: line + 1, col: character + 1 },
          suggestion:
            "move this declaration above the code that runs first, so it is always initialized " +
            "before any function can read it",
        });
      }
      return;
    }
    ts.forEachChild(node, (c) => walkBody(c, callableFrom));
  };

  const findFunctions = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isGetAccessor(node) ||
      ts.isSetAccessor(node)
    ) {
      if (node.body) walkBody(node.body, earliestCallableIndex(node, sf));
    }
    ts.forEachChild(node, findFunctions);
  };
  findFunctions(sf);
  return out;
}
