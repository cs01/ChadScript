// Mutable-capture analysis: which local variables must live in a heap cell.
//
// A closure copies what it captures into its env at creation. That is exact for a binding whose
// value never changes after it is captured, so those stay by-value (and compile exactly as before).
// A binding that is BOTH referenced from a nested function AND reassigned somewhere (inside the
// closure or outside it) must be shared storage instead: the declaring scope and every closure hold
// a pointer to one GC-allocated cell, and every read and write goes through it. Module-scope
// variables are never cells: they already live in globals every function reads directly.

import ts from "typescript";

// A node that starts a new function scope (and therefore a new frame the variable is not in).
function isFunctionScope(n: ts.Node): boolean {
  return (
    ts.isArrowFunction(n) ||
    ts.isFunctionExpression(n) ||
    ts.isFunctionDeclaration(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isConstructorDeclaration(n) ||
    ts.isGetAccessorDeclaration(n) ||
    ts.isSetAccessorDeclaration(n)
  );
}

// The nearest enclosing function scope of a node (the source file at module level). A parameter's
// scope is its own function, which the walk reaches as its parent.
function scopeOf(n: ts.Node): ts.Node {
  for (let p = n.parent; p; p = p.parent) {
    if (isFunctionScope(p) || ts.isSourceFile(p)) return p;
  }
  return n.getSourceFile();
}

// A `let`/`const` declared directly by a module-level statement: lowered to an IR global, so
// functions reach it by name and it never needs capturing.
export function isModuleVariable(d: ts.Declaration): boolean {
  return (
    ts.isVariableDeclaration(d) &&
    ts.isVariableDeclarationList(d.parent) &&
    ts.isVariableStatement(d.parent.parent) &&
    ts.isSourceFile(d.parent.parent.parent)
  );
}

function isLocalBinding(d: ts.Declaration): boolean {
  if (ts.isParameter(d)) return true;
  return ts.isVariableDeclaration(d) && !isModuleVariable(d);
}

function assignedIdentifier(node: ts.Node): ts.Identifier | null {
  if (ts.isBinaryExpression(node)) {
    const k = node.operatorToken.kind;
    if (k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment) {
      return ts.isIdentifier(node.left) ? node.left : null;
    }
    return null;
  }
  if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
    const op = node.operator;
    if (op === ts.SyntaxKind.PlusPlusToken || op === ts.SyntaxKind.MinusMinusToken) {
      return ts.isIdentifier(node.operand) ? node.operand : null;
    }
  }
  return null;
}

// The set of local bindings (by symbol) that must be heap cells.
export function findCellSymbols(
  files: readonly ts.SourceFile[],
  checker: ts.TypeChecker,
): Set<ts.Symbol> {
  const reassigned = new Set<ts.Symbol>();
  const captured = new Set<ts.Symbol>();
  const visit = (node: ts.Node): void => {
    const target = assignedIdentifier(node);
    if (target) {
      const sym = checker.getSymbolAtLocation(target);
      if (sym) reassigned.add(sym);
    }
    if (ts.isIdentifier(node)) {
      const sym = checker.getSymbolAtLocation(node);
      const d = sym?.valueDeclaration;
      if (sym && d && d !== node.parent && isLocalBinding(d) && scopeOf(node) !== scopeOf(d)) {
        captured.add(sym);
      }
    }
    ts.forEachChild(node, visit);
  };
  for (const sf of files) visit(sf);
  const cells = new Set<ts.Symbol>();
  for (const s of captured) if (reassigned.has(s)) cells.add(s);
  return cells;
}

// `{ cell: true }` when the binding named by `name` is a cell, else `{}`: spread into the HIR node
// so a non-cell binding's node is exactly what it was before cells existed.
export function cellFlag(
  name: ts.Identifier,
  cells: ReadonlySet<ts.Symbol>,
  checker: ts.TypeChecker,
): { cell?: true } {
  const sym = checker.getSymbolAtLocation(name);
  return sym && cells.has(sym) ? { cell: true } : {};
}
