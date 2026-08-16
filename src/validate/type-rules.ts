// Validator rules that consult the TYPE CHECKER, split from the syntax-driven rules in rules.ts
// (which the file-size ratchet, tests/unit/file-size.test.ts, keeps bounded).
//
// These answer questions ALLOWED_KINDS cannot: whether a construct that is syntactically admitted
// also has a runtime representation, and whether an identifier resolves to something the value
// domain can hold.

import ts from "typescript";
import type { Diagnostic } from "../diagnostics.js";
import { CODE, type Code } from "./codes.js";
import { UnrepresentableTypeError, valueTypeOfTsType } from "../lower/type-translation.js";

export type Hit = (code: Code, message: string, suggestion: string) => Diagnostic;

// Whether `node` is an identifier with this exact name.
function isNamedIdent(node: ts.Node, name: string): boolean {
  return ts.isIdentifier(node) && node.text === name;
}

// An ASYNC `function` declaration used as a VALUE rather than called.
//
// Synchronous declarations are now first-class (lowerFunctionRef wraps them in a forwarding
// closure). Async ones cannot be: a call to an async function spawns a fiber and returns a promise,
// while a forwarding wrapper would run the body synchronously — the resulting value would have the
// right type and the wrong semantics, which is exactly the "compiles but diverges from Node"
// category the charter forbids.
export function checkFunctionValueRef(
  id: ts.Identifier,
  hit: Hit,
  checker: ts.TypeChecker,
): Diagnostic | null {
  const parent = id.parent as ts.Node | undefined;
  if (!parent) return null;
  // Positions where the identifier is a NAME, not a value read.
  if (ts.isFunctionDeclaration(parent) && parent.name === id) return null;
  if (ts.isCallExpression(parent) && parent.expression === id) return null;
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return null;
  if (ts.isPropertyAssignment(parent) && parent.name === id) return null;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return null;
  if (ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return null;
  if (ts.isBindingElement(parent) && parent.propertyName === id) return null;
  if (ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent)) return null;

  const decl = checker.getSymbolAtLocation(id)?.valueDeclaration;
  if (!decl || !ts.isFunctionDeclaration(decl)) return null;

  // A SYNCHRONOUS function declaration is fine as a value: lowering wraps it in a forwarding
  // closure. An async one is not — calling it must spawn a fiber and yield a promise, and a
  // forwarding wrapper would run the body synchronously instead, so the value would be a lie.
  const isAsync = decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
  if (!isAsync) return null;

  return hit(
    CODE.FN_DECL_AS_VALUE,
    `\`${id.text}\` is an async function and cannot be used as a value`,
    `wrap the reference so the call still spawns: \`(...args) => ${id.text}(...args)\``,
  );
}

// Type-level default-deny, at the points where a value ENTERS the program's flow: a declaration, a
// parameter, or the merge point of a conditional. Syntax-level default-deny (ALLOWED_KINDS) admits
// `cond ? a : b`, but says nothing about whether the union of its arms has a runtime
// representation — that question belongs to the type domain.
//
// The predicate is not reimplemented here: it CALLS the real translator and catches the one error
// it raises for an unrepresentable type, so the validator and the lowerer can never disagree about
// what is representable. Anything else the translator throws is a genuine compiler bug and is left
// to propagate.
export function checkRepresentableType(
  node: ts.Node,
  hit: Hit,
  checker: ts.TypeChecker,
): Diagnostic | null {
  // A declaration with no initializer and no annotation has nothing to represent yet; `void`
  // positions (a statement-position call, a void return) are not values either.
  const t = checker.getTypeAtLocation(node);
  if (t.flags & (ts.TypeFlags.Void | ts.TypeFlags.Any | ts.TypeFlags.Never)) return null;
  try {
    valueTypeOfTsType(t, node, checker);
    return null;
  } catch (e) {
    if (!(e instanceof UnrepresentableTypeError)) throw e;
    return hit(CODE.UNREPRESENTABLE_TYPE, `this value has ${e.reason}`, e.suggestion);
  }
}

// An arrow or function expression carrying `async`. Only the literal forms are checked: a
// reference to an async function declaration is caught by the type system, because
// `() => Promise<void>` only slips through when the literal is contextually typed here.
export function isAsyncFunctionExpr(node: ts.Node): boolean {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return false;
  return node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
}

// Whether `call` targets the ambient global of that name declared in stdlib/globals.d.ts —
// resolved by SYMBOL, so a user function that shadows the name is left alone.
export function isAmbientGlobalCall(
  call: ts.CallExpression,
  name: string,
  checker: ts.TypeChecker,
): boolean {
  if (!isNamedIdent(call.expression, name)) return false;
  const decl = checker.getSymbolAtLocation(call.expression)?.declarations?.[0];
  return decl !== undefined && decl.getSourceFile().fileName.endsWith("stdlib/globals.d.ts");
}

// The same representability question asked of a written type node rather than of a value node.
export function checkRepresentableTypeNode(
  node: ts.TypeNode,
  hit: Hit,
  checker: ts.TypeChecker,
): Diagnostic | null {
  try {
    valueTypeOfTsType(checker.getTypeFromTypeNode(node), node, checker);
    return null;
  } catch (e) {
    if (!(e instanceof UnrepresentableTypeError)) throw e;
    return hit(CODE.UNREPRESENTABLE_TYPE, `this type is ${e.reason}`, e.suggestion);
  }
}

// An opaque runtime handle (setTimeout's `Timeout`) used as anything other than a value to store
// or hand back. Printing one is the case that matters: Node prints a `Timeout` object with
// internal fields, so any representation we chose would diverge — and the whole reason the type is
// opaque is that there is nothing faithful to print.
//
// Admitted positions: the call that MINTS it, a variable initializer, and an argument. Everything
// else — console.log, JSON.stringify, template interpolation, comparison — is rejected.
export function checkOpaqueHandleUse(
  node: ts.Expression,
  hit: Hit,
  checker: ts.TypeChecker,
): Diagnostic | null {
  const name = opaqueTypeName(node, checker);
  if (name === null) return null;

  const parent = node.parent as ts.Node | undefined;
  if (!parent) return null;
  // Positions where the identifier NAMES the handle rather than reading it. `const t = ...` has a
  // Timeout-typed identifier on both sides; only the right-hand one is a use.
  if (ts.isVariableDeclaration(parent) && parent.name === node) return null;
  if (ts.isParameter(parent) && parent.name === node) return null;
  if (ts.isBindingElement(parent) && parent.name === node) return null;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return null;
  // Minting it, storing it, discarding it, or passing it on are the supported uses. Discarding is
  // the COMMON case: `setTimeout(cb, 10);` as a statement never needs the handle.
  if (ts.isExpressionStatement(parent)) return null;
  if (ts.isVariableDeclaration(parent) && parent.initializer === node) return null;
  if (ts.isCallExpression(parent) && parent.arguments.includes(node)) {
    // ...but console.log/JSON.stringify take arguments too, and neither can render one.
    return isRenderingCall(parent) ? renderRefusal(name, hit) : null;
  }
  if (ts.isCallExpression(parent) && parent.expression === node) return null;
  if (ts.isReturnStatement(parent)) return null;
  return renderRefusal(name, hit);
}

function renderRefusal(name: string, hit: Hit): Diagnostic {
  return hit(
    CODE.OPAQUE_HANDLE_USE,
    `a \`${name}\` handle is opaque and cannot be used here`,
    `store it in a variable and pass it back (e.g. \`clearTimeout(handle)\`) — there is no faithful way to print or serialize it`,
  );
}

// The opaque type name of `node`, or null when its type is not an opaque handle. Mirrors
// type-translation.ts's recognition: name plus declaring file.
function opaqueTypeName(node: ts.Expression, checker: ts.TypeChecker): string | null {
  const sym = checker.getTypeAtLocation(node).getSymbol();
  const name = sym?.getName();
  if (name !== "Timeout") return null;
  const decl = sym?.declarations?.[0];
  if (!decl || !decl.getSourceFile().fileName.endsWith("stdlib/globals.d.ts")) return null;
  return name;
}

// Calls that turn a value into text and therefore cannot accept an opaque handle.
function isRenderingCall(call: ts.CallExpression): boolean {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  const recv = callee.expression;
  if (isNamedIdent(recv, "console")) return true;
  return isNamedIdent(recv, "JSON") && callee.name.text === "stringify";
}
