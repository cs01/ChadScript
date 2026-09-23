// Validator rules for the host APIs (node:net and the network modules built on it). Their members
// are declared in stdlib/globals.d.ts and lowered one by one in lower/host-api.ts; tsc already
// restricts a program to the declared members, so what is checked here is the FORM of a call:
// the parts lowering must see statically, and callbacks whose parameters could not receive what
// the runtime passes.

import ts from "typescript";
import type { Diagnostic } from "../diagnostics.js";
import { CODE } from "./codes.js";
import type { Hit } from "./type-rules.js";
import { hostTypeName, qualifiedAmbientName } from "../lower/host-types.js";
import { HOST_FUNCTIONS } from "../lower/host-api.js";
import { UnrepresentableTypeError, valueTypeOfTsType } from "../lower/type-translation.js";
import { callbackParamProblem } from "../lower/callback-adapt.js";
import type { ValueType } from "../hir/types.js";

// The host function a call names ("net.connect"), or null.
function hostFunctionOf(call: ts.CallExpression, checker: ts.TypeChecker): string | null {
  const callee = ts.isPropertyAccessExpression(call.expression)
    ? call.expression.name
    : call.expression;
  if (!ts.isIdentifier(callee)) return null;
  let sym = checker.getSymbolAtLocation(callee);
  if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
  const decl = sym?.declarations?.[0];
  if (!decl || !ts.isFunctionDeclaration(decl) || !decl.name) return null;
  const key = qualifiedAmbientName(decl, decl.name.text);
  return key !== null && key in HOST_FUNCTIONS ? key : null;
}

// A call to a host function or a method of a host handle. Their callbacks only ever run from the
// event loop, never during the call (tdz.ts relies on this).
export function isHostCall(
  call: ts.CallExpression | ts.NewExpression,
  checker: ts.TypeChecker,
): boolean {
  if (!ts.isCallExpression(call)) return false;
  if (hostFunctionOf(call, checker) !== null) return true;
  return (
    ts.isPropertyAccessExpression(call.expression) &&
    hostTypeName(checker.getTypeAtLocation(call.expression.expression)) !== null
  );
}

// `undefined` when `call` is not a host call (other rules apply); otherwise its diagnostic or null.
export function checkHostCall(
  call: ts.CallExpression,
  hit: Hit,
  checker: ts.TypeChecker,
): Diagnostic | null | undefined {
  const fn = hostFunctionOf(call, checker);
  const isMethod =
    ts.isPropertyAccessExpression(call.expression) &&
    hostTypeName(checker.getTypeAtLocation(call.expression.expression)) !== null;
  if (fn === null && !isMethod) return undefined;
  if (fn === "net.connect" || fn === "net.createConnection") {
    const opts = call.arguments[0];
    if (opts && !ts.isObjectLiteralExpression(skipParens(opts))) {
      return hit(
        CODE.HOST_CALL_FORM,
        "the connection options must be written as an object literal",
        "pass them inline: `net.connect({ port, host }, onConnect)`",
      );
    }
    if (opts && ts.isObjectLiteralExpression(skipParens(opts))) {
      for (const p of (skipParens(opts) as ts.ObjectLiteralExpression).properties) {
        if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) {
          return hit(
            CODE.HOST_CALL_FORM,
            "the connection options must be plain `port` and `host` properties",
            "write `{ port: p, host: h }` without spreads or methods",
          );
        }
      }
    }
  }
  return checkCallbacks(call, hit, checker);
}

// A local variable read by a closure created inside the variable's own initializer:
// `const c = net.connect(opts, () => c.write(s))`. That is fine when the closure can only run
// later (a network listener, a timer), and lowering gives the variable a cell for it
// (lower/cells.ts). Anywhere else the closure might run before the initializer finishes, where
// Node throws a ReferenceError and the cell would still be empty, so it is rejected.
export function checkSelfInitCapture(
  id: ts.Identifier,
  hit: Hit,
  checker: ts.TypeChecker,
): Diagnostic | null {
  const decl = checker.getSymbolAtLocation(id)?.valueDeclaration;
  if (!decl || !ts.isVariableDeclaration(decl) || !decl.initializer || decl.name === id)
    return null;
  // Module variables are globals, covered by the module-level dead-zone check (tdz.ts).
  if (ts.isSourceFile(decl.parent.parent.parent)) return null;
  let fn: ts.Node | undefined;
  for (let p: ts.Node = id; p !== decl.initializer; p = p.parent) {
    if (ts.isSourceFile(p)) return null;
    if (ts.isArrowFunction(p) || ts.isFunctionExpression(p)) fn = p;
  }
  // `fn` is the outermost function literal inside the initializer on the way to the read.
  if (!fn) return null;
  let at: ts.Node = fn;
  while (ts.isParenthesizedExpression(at.parent)) at = at.parent;
  const call = at.parent;
  const deferred =
    ts.isCallExpression(call) &&
    call.arguments.includes(at as ts.Expression) &&
    (isHostCall(call, checker) ||
      (ts.isIdentifier(call.expression) && call.expression.text === "setTimeout"));
  if (deferred) return null;
  return hit(
    CODE.SELF_INIT_CAPTURE,
    `\`${id.text}\` is read by a function created in its own initializer, which may run before \`${id.text}\` exists`,
    `declare \`${id.text}\` first and assign the function afterwards, or pass it to an API that calls it later (a listener or a timer)`,
  );
}

function skipParens(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return e;
}

// Every function argument must be able to receive the values the runtime calls it with: the
// parameter types of the callback type the resolved overload declares.
function checkCallbacks(
  call: ts.CallExpression,
  hit: Hit,
  checker: ts.TypeChecker,
): Diagnostic | null {
  const sig = checker.getResolvedSignature(call);
  if (!sig) return null;
  const params = sig.getParameters();
  for (let i = 0; i < call.arguments.length; i++) {
    const arg = call.arguments[i]!;
    const argSig = checker.getTypeAtLocation(arg).getCallSignatures()[0];
    const param = params[i];
    if (!argSig || !param) continue;
    const declaredCb = checker
      .getNonNullableType(checker.getTypeOfSymbolAtLocation(param, call))
      .getCallSignatures()[0];
    if (!declaredCb) continue;
    try {
      const passed = paramTypes(declaredCb, call, checker);
      const declared = paramTypes(argSig, arg, checker);
      const problem = callbackParamProblem(declared, passed);
      if (problem !== null) {
        return hit(
          CODE.HOST_CALL_FORM,
          `this callback cannot be called by the runtime: ${problem}`,
          "declare each parameter with exactly the type the API passes (see its declaration)",
        );
      }
    } catch (e) {
      // An unrepresentable parameter type is reported by the type rules at its declaration.
      if (e instanceof UnrepresentableTypeError) return null;
      throw e;
    }
  }
  return null;
}

function paramTypes(sig: ts.Signature, at: ts.Node, checker: ts.TypeChecker): ValueType[] {
  return sig
    .getParameters()
    .map((p) => valueTypeOfTsType(checker.getTypeOfSymbolAtLocation(p, at), at, checker));
}
