// `new Promise<T>(executor)` (lower/promise-new.ts). The library types resolve as
// `(value: T | PromiseLike<T>) => void` and reject as `(reason?: any) => void`, neither of which has
// a representation here, so the executor must be written inline with both parameters annotated:
//
//   new Promise<T>((resolve: (value: T) => void, reject: (reason: Error) => void): void => { ... })
//
// (`resolve: () => void` for Promise<void>; `reject` may be left out). tsc accepts these
// annotations because the library's functions are assignable to them, and they are exactly the
// closures codegen builds.

import ts from "typescript";
import type { Diagnostic } from "../diagnostics.js";
import { CODE } from "./codes.js";
import type { Hit } from "./type-rules.js";
import { builtinErrorType } from "../lower/errors.js";

export function checkPromiseNew(
  node: ts.NewExpression,
  hit: Hit,
  checker: ts.TypeChecker,
): Diagnostic | null {
  if (!ts.isIdentifier(node.expression) || node.expression.text !== "Promise") return null;
  const decls = checker.getSymbolAtLocation(node.expression)?.declarations ?? [];
  if (!decls.every((d) => d.getSourceFile().isDeclarationFile)) return null;

  const valueType = checker.getTypeArguments(
    checker.getTypeAtLocation(node) as ts.TypeReference,
  )[0];
  const isVoid =
    valueType === undefined ||
    (valueType.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) !== 0;
  const t = valueType ? checker.typeToString(valueType) : "void";
  const shape = isVoid
    ? "(resolve: () => void, reject: (reason: Error) => void): void => { ... }"
    : `(resolve: (value: ${t}) => void, reject: (reason: Error) => void): void => { ... }`;
  const bad = (what: string): Diagnostic =>
    hit(
      CODE.NOT_IN_SUBSET,
      `\`new Promise\` needs its executor written inline with typed parameters: ${what}`,
      `write \`new Promise<${t}>(${shape})\` (reject may be left out)`,
    );

  const exec = node.arguments?.[0];
  if (!exec || node.arguments!.length !== 1) return bad("pass exactly one executor function");
  if (!ts.isArrowFunction(exec) && !ts.isFunctionExpression(exec)) {
    return bad("the executor is not an inline function");
  }
  if (exec.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
    return bad("the executor is `async` (Node drops what it throws after its first `await`)");
  }
  const [resolve, reject] = exec.parameters;
  if (resolve) {
    const fn = annotatedFunction(resolve);
    if (!fn) return bad("`resolve` has no function type annotation");
    const params = fn.parameters;
    if (isVoid ? params.length !== 0 : params.length !== 1) {
      return bad(`\`resolve\` must take ${isVoid ? "no arguments" : "exactly one argument"}`);
    }
    const p = params[0];
    if (p && valueType) {
      if (!p.type || p.questionToken || p.dotDotDotToken) {
        return bad("`resolve`'s parameter needs a plain type annotation");
      }
      const pt = checker.getTypeFromTypeNode(p.type);
      if (
        !checker.isTypeAssignableTo(pt, valueType) ||
        !checker.isTypeAssignableTo(valueType, pt)
      ) {
        return bad(`\`resolve\` must take the promise's own type \`${t}\``);
      }
    }
  }
  if (reject) {
    const fn = annotatedFunction(reject);
    const p = fn?.parameters[0];
    if (
      !fn ||
      fn.parameters.length !== 1 ||
      !p?.type ||
      p.questionToken ||
      builtinErrorType(checker.getTypeFromTypeNode(p.type)) === null
    ) {
      return bad("`reject` must be annotated `(reason: Error) => void`");
    }
  }
  return null;
}

// The function type `param` is annotated with, when it is a plain named parameter.
function annotatedFunction(param: ts.ParameterDeclaration): ts.FunctionTypeNode | null {
  if (!ts.isIdentifier(param.name) || param.questionToken || param.initializer) return null;
  let t = param.type;
  while (t && ts.isParenthesizedTypeNode(t)) t = t.type;
  return t && ts.isFunctionTypeNode(t) ? t : null;
}
