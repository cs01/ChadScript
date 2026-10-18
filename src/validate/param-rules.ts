// CS1217: the optional (`y?: T`) and defaulted (`y = v`) parameter forms lowering cannot make
// exact (lower/params.ts implements the rest). Such a parameter is passed as `T | undefined`, so
// its type must have a representation that can also hold undefined, and its default runs in the
// callee's prologue, in parameter order, so it may only read parameters bound before it.

import ts from "typescript";
import type { Diagnostic } from "../diagnostics.js";
import { CODE } from "./codes.js";
import type { Hit } from "./type-rules.js";
import { UnrepresentableTypeError, paramSlotType } from "../lower/type-translation.js";

export function checkParamForm(
  p: ts.ParameterDeclaration,
  hit: Hit,
  checker: ts.TypeChecker,
): Diagnostic | null {
  if (!p.questionToken && !p.initializer) return null;
  if (!ts.isIdentifier(p.name)) {
    return hit(
      CODE.PARAM_FORM,
      "a destructured parameter cannot be optional or have a default yet",
      "take the object as a plain parameter and destructure it in the body: " +
        "`function f(o: Opts = DEFAULT) { const { a, b } = o; }`",
    );
  }
  const sym = checker.getSymbolAtLocation(p.name);
  if (!sym) return null;
  try {
    const slot = paramSlotType(sym, p, checker);
    const holdsOnlyNullish =
      (slot.kind === "optional" &&
        (slot.inner.kind === "null" || slot.inner.kind === "undefined")) ||
      (slot.kind === "value" &&
        slot.members.every((m) => m.kind === "null" || m.kind === "undefined"));
    if (holdsOnlyNullish || (slot.kind !== "optional" && slot.kind !== "value")) {
      return hit(
        CODE.PARAM_FORM,
        "an optional or defaulted parameter whose type holds only `null`/`undefined` is not supported",
        "give the parameter a value type (`x?: number`), or drop it",
      );
    }
  } catch (e) {
    // Reported by the representable-type rule at the same parameter.
    if (e instanceof UnrepresentableTypeError) return null;
    throw e;
  }
  if (p.initializer) {
    const later = laterParamRead(p, checker);
    if (later !== null) {
      return hit(
        CODE.PARAM_FORM,
        `this default reads \`${later}\`, a parameter declared after it`,
        "reorder the parameters, or compute the value in the body",
      );
    }
  }
  return null;
}

// The name of a later parameter of the same function that `p`'s default refers to (possibly from
// inside a closure, which would capture it before the prologue binds it), or null.
function laterParamRead(p: ts.ParameterDeclaration, checker: ts.TypeChecker): string | null {
  const fn = p.parent;
  const later = new Set<ts.Node>(fn.parameters.slice(fn.parameters.indexOf(p) + 1));
  let found: string | null = null;
  const visit = (n: ts.Node): void => {
    if (found !== null) return;
    if (ts.isIdentifier(n)) {
      const d = checker.getSymbolAtLocation(n)?.valueDeclaration;
      if (d && later.has(d)) found = n.text;
    }
    ts.forEachChild(n, visit);
  };
  visit(p.initializer!);
  return found;
}

// `f.length` counts the parameters before the first optional or defaulted one, and `f.name` comes
// from where the function was defined; a function value here is only a {fnptr, env} record, so
// neither (nor call/apply/bind) has a lowering. A function type has no properties of its own, so
// any property read on it is one of the built-in Function members.
export function checkFunctionProperty(
  pa: ts.PropertyAccessExpression,
  hit: Hit,
  checker: ts.TypeChecker,
): Diagnostic | null {
  const recv = checker.getTypeAtLocation(pa.expression);
  if (recv.getCallSignatures().length === 0 || recv.getConstructSignatures().length > 0) {
    return null;
  }
  if (checker.getPropertiesOfType(recv).length > 0) return null;
  return hit(
    CODE.NOT_IN_SUBSET,
    `\`.${pa.name.text}\` of a function value is not supported`,
    "keep the value you need (an arity, a name) in a variable or field next to the function",
  );
}

// The `arguments` object (its length counts the arguments actually passed, which an omitted
// optional parameter's undefined slot cannot tell apart) has no lowering. Only tsc's built-in
// binding has no declaration; a user variable named `arguments` is ordinary.
export function checkArgumentsObject(
  id: ts.Identifier,
  hit: Hit,
  checker: ts.TypeChecker,
): Diagnostic | null {
  if (id.text !== "arguments") return null;
  const sym = checker.getSymbolAtLocation(id);
  if (!sym || (sym.declarations?.length ?? 0) > 0) return null;
  return hit(
    CODE.NOT_IN_SUBSET,
    "the `arguments` object is not supported",
    "declare the parameters explicitly, or a rest parameter (`...args: number[]`)",
  );
}
