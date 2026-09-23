// CS1246: a built-in function (readFileSync, Date.now, ...) used as a VALUE instead of being
// called. Lowering handles most built-ins at their call site (the argument types pick the runtime
// entry). String, Number, Boolean, parseInt, parseFloat, Math's functions and console.log are
// admitted as values where a function type says which arguments they receive
// (lower/builtin-values.ts); anything else, or one of those used without such a type, is rejected.

import ts from "typescript";
import type { Diagnostic } from "../diagnostics.js";
import { CODE } from "./codes.js";
import type { Hit } from "./type-rules.js";
import type { ValueType } from "../hir/types.js";
import { builtinIdOf, builtinValueProblem } from "../lower/builtin-values.js";
import { UnrepresentableTypeError, valueTypeOfTsType } from "../lower/type-translation.js";

export function checkBuiltinValueRef(
  ref: ts.Identifier | ts.PropertyAccessExpression,
  hit: Hit,
  checker: ts.TypeChecker,
): Diagnostic | null {
  const parent = ref.parent as ts.Node | undefined;
  if (!parent) return null;
  // The `floor` of `Math.floor` is checked as the whole access, where the access is visited.
  if (ts.isIdentifier(ref) && ts.isPropertyAccessExpression(parent) && parent.name === ref)
    return null;
  if (!isValuePosition(ref, parent)) return null;

  const nameNode = ts.isIdentifier(ref) ? ref : ref.name;
  const sym = checker.getSymbolAtLocation(nameNode);
  const target = sym && sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
  const decls = target?.declarations;
  if (!target || !decls || decls.length === 0) return null;
  // Built-ins are exactly what the ambient environment (stdlib/globals.d.ts) declares; the
  // program's own functions are ordinary closures when referenced.
  if (!decls.every((d) => d.getSourceFile().isDeclarationFile)) return null;
  const t = checker.getTypeOfSymbolAtLocation(target, ref);
  if (t.getCallSignatures().length === 0 && t.getConstructSignatures().length === 0) return null;

  const text = ref.getText();
  const id = builtinIdOf(ref, checker);
  let reason = "it is not one of the built-ins admitted as values";
  if (id !== null) {
    const ct = checker.getContextualType(ref);
    let use: ValueType | null = null;
    try {
      use = ct ? valueTypeOfTsType(ct, ref, checker) : null;
    } catch (e) {
      if (!(e instanceof UnrepresentableTypeError)) throw e;
    }
    const problem = builtinValueProblem(id, use);
    if (problem === null) return null;
    reason = problem;
  }
  return hit(
    CODE.BUILTIN_AS_VALUE,
    `\`${text}\` is a built-in function and cannot be used as a value here: ${reason}`,
    `call it inside an arrow function instead, e.g. \`(x) => ${text}(x)\``,
  );
}

// Whether `ref` (whose parent is `parent`) is read as a value, rather than called, constructed,
// used as a receiver, tested against with `instanceof`, or named in a type or declaration.
export function isValuePosition(ref: ts.Node, parent: ts.Node): boolean {
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === ref)
    return false;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === ref) return false;
  if (ts.isElementAccessExpression(parent) && parent.expression === ref) return false;
  if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
    parent.right === ref
  )
    return false;
  if (ts.isExpressionWithTypeArguments(parent)) return false; // `extends Error`
  if (ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent)) return false;
  if (ts.isQualifiedName(parent)) return false;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return false;
  if (ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return false;
  // A declaration's own name (a local that shadows a built-in is not a built-in anyway).
  if (
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isBindingElement(parent)) &&
    (parent as ts.NamedDeclaration).name === ref
  )
    return false;
  return true;
}
