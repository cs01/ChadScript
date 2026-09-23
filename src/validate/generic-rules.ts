// Validator rules for erased generics. The boundary decisions themselves live in
// lower/generics.ts and are shared with lowering; this pass runs them over every call to a generic
// declaration (and every generic function used as a value) and reports what cannot cross as a
// coded diagnostic instead of an ICE:
//   CS1242  T instantiated with a value its erased word cannot describe (an array, Map, function...)
//   CS1240  a container whose element representation differs on the two sides and whose copy would
//           be observable (an array the caller still holds, a Map, a nested container)
// It also checks every field access, destructuring and spread that an object allocated by generic
// code can reach (its container fields hold T as Value words), and layout-rules.ts checks method
// calls against the erased signature.

import ts from "typescript";
import type { Diagnostic } from "../diagnostics.js";
import type { LoadedProgram } from "../frontend/program.js";
import type { ValueType } from "../hir/types.js";
import { UnrepresentableTypeError, valueTypeOfTsType } from "../lower/type-translation.js";
import { type Layout, layoutsOf } from "../lower/layouts.js";
import {
  GenericBoundaryError,
  elementPlan,
  fieldCompatible,
  genericSignatureOf,
  isGenericDeclaration,
  planArgument,
  planResult,
  slotIdentical,
} from "../lower/generics.js";
import { CODE, type Code } from "./codes.js";
import { spanOf } from "./validate.js";

function translate(t: ts.Type, at: ts.Node, checker: ts.TypeChecker): ValueType | null {
  try {
    return valueTypeOfTsType(t, at, checker);
  } catch (e) {
    if (e instanceof UnrepresentableTypeError) return null; // reported where it is declared
    throw e;
  }
}

// `x!` whose operand and result are both one Value word: an erased `T | undefined` narrowed to T.
export function isWordToWordAssertion(
  node: ts.NonNullExpression,
  checker: ts.TypeChecker,
): boolean {
  const inner = translate(checker.getTypeAtLocation(node.expression), node, checker);
  const outer = translate(checker.getTypeAtLocation(node), node, checker);
  return inner?.kind === "value" && outer?.kind === "value";
}

function checkCall(call: ts.CallExpression | ts.NewExpression, checker: ts.TypeChecker): void {
  const g = genericSignatureOf(call, checker);
  if (!g) return;
  const args = call.arguments ?? [];
  const fixed = g.rest ? g.erased.length - 1 : g.erased.length;
  args.forEach((a, i) => {
    if (i < fixed) {
      planArgument(g.erased[i]!, g.inst[i]!, a);
      return;
    }
    const restT = g.erased[fixed];
    const restInst = g.inst[fixed];
    if (restT?.kind !== "array" || restInst?.kind !== "array") return;
    if (ts.isSpreadElement(a)) {
      const src = translate(checker.getTypeAtLocation(a.expression), a, checker);
      // A spread copies, so a converted copy is exact; it only needs one word conversion each.
      if (src?.kind === "array" && !slotIdentical(src.element, restT.element)) {
        elementPlan(restT.element, src.element);
      }
      return;
    }
    planArgument(restT.element, restInst.element, a);
  });
  if (g.erasedRet === null || ts.isExpressionStatement(call.parent)) return;
  const inst = translate(checker.getTypeAtLocation(call), call, checker);
  if (inst) planResult(g.erasedRet, inst, g.decl, checker);
}

// A generic function declaration used as a value is wrapped with one word conversion per
// parameter and for the result (lower/declarations.ts lowerFunctionRef).
function checkFunctionRef(id: ts.Identifier, checker: ts.TypeChecker): void {
  const p = id.parent;
  if (ts.isCallExpression(p) && p.expression === id) return;
  const d = checker.getSymbolAtLocation(id)?.valueDeclaration;
  if (!d || !ts.isFunctionDeclaration(d) || d.name === id || !isGenericDeclaration(d)) return;
  const use = translate(checker.getTypeAtLocation(id), id, checker);
  const sig = checker.getSignatureFromDeclaration(d);
  if (use?.kind !== "function" || !sig) return;
  sig.parameters.forEach((s, i) => {
    const erased = translate(checker.getTypeOfSymbolAtLocation(s, d), d, checker);
    const inst = use.params[i];
    if (erased && inst) elementPlan(erased, inst);
  });
  const r = checker.getReturnTypeOfSignature(sig);
  const erasedRet =
    r.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined) ? null : translate(r, d, checker);
  if (erasedRet && use.ret) elementPlan(erasedRet, use.ret);
}

// A field of an object allocated by generic code holds what the ERASED code stored there (for a
// `T[]` field, an array of Value words). A read or write of it through a type that expects another
// container representation (`number[]`) would decode the wrong slots.
function checkGenericField(
  recv: ts.Type,
  layouts: readonly Layout[],
  name: string,
  at: ts.Node,
  checker: ts.TypeChecker,
): void {
  const siteProp = checker.getPropertyOfType(checker.getNonNullableType(recv), name);
  // Methods are dispatched, not read from a slot (layout-rules.ts checks their signatures).
  if (!siteProp || !(siteProp.flags & ts.SymbolFlags.Property)) return;
  const site = translate(checker.getTypeOfSymbolAtLocation(siteProp, at), at, checker);
  for (const l of layouts) {
    if (!(l.generic || l.inheritsGeneric) || l.site.kind === "json") continue;
    // The field as its DECLARATION types it: a subclass's view of an inherited generic field is
    // instantiated (`number[]`), but the base code that stores it is erased (`T[]`).
    const inherited = checker.getPropertyOfType(l.type, name);
    const declName = (inherited?.valueDeclaration as ts.NamedDeclaration | undefined)?.name;
    const prop = (declName && checker.getSymbolAtLocation(declName)) || inherited;
    const origin = l.site.kind === "class" ? l.site.decl : l.site.node;
    const stored = prop
      ? translate(checker.getTypeOfSymbolAtLocation(prop, origin), origin, checker)
      : null;
    if (site && stored && !fieldCompatible(stored, site)) {
      throw new GenericBoundaryError(
        "CS1240",
        `\`.${name}\` can belong to an object built by generic code, which stores it in its ` +
          "generic form; reading it here as the specific type is not supported",
        "use it inside the generic code, or expose it through a generic method (for an array, " +
          "one that returns a copy: `items(): T[] { return [...this.xs]; }`)",
      );
    }
  }
}

// Inside generic code a callback passed in is wrapped in an adapter (adaptClosure), one per
// crossing, so the function the generic code holds is not the caller's object: comparing or
// searching for functions there is CS1240. (Everywhere else a function value is one record, and
// every reference to a named function is the same static record: codegen/cells.ts.)
function functionIdentityProblem(
  node: ts.Node,
  checker: ts.TypeChecker,
): { code: Code; message: string; suggestion: string } | null {
  if (!isGenericDeclaration(node)) return null;
  const isFn = (e: ts.Expression): boolean =>
    translate(checker.getTypeAtLocation(e), e, checker)?.kind === "function";
  const suggestion =
    "compare something the functions compute, or keep the comparison outside the generic code";
  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken) &&
    (isFn(node.left) || isFn(node.right))
  ) {
    return {
      code: CODE.REPRESENTATION_MISMATCH,
      suggestion,
      message:
        "comparing functions with `===` inside generic code is not supported (a callback passed in is wrapped)",
    };
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ["includes", "indexOf"].includes(node.expression.name.text) &&
    node.arguments[0] !== undefined &&
    isFn(node.arguments[0])
  ) {
    return {
      code: CODE.REPRESENTATION_MISMATCH,
      suggestion,
      message:
        "searching for a function inside generic code is not supported (a callback passed in is wrapped)",
    };
  }
  return null;
}

export function genericDiagnostics(loaded: LoadedProgram): Diagnostic[] {
  const checker = loaded.checker;
  const analysis = layoutsOf(loaded);
  const out: Diagnostic[] = [];
  const visit = (node: ts.Node): void => {
    // `new Set<T>()` in a generic body has a type no declaration names, so the representability
    // check on declarations never sees it.
    if (ts.isNewExpression(node)) {
      try {
        valueTypeOfTsType(checker.getTypeAtLocation(node), node, checker);
      } catch (e) {
        if (!(e instanceof UnrepresentableTypeError)) throw e;
        out.push({
          code: CODE.UNREPRESENTABLE_TYPE,
          message: `this value has ${e.reason}`,
          span: spanOf(node, node.getSourceFile()),
          suggestion: e.suggestion,
        });
        return;
      }
    }
    const identity = functionIdentityProblem(node, checker);
    if (identity) {
      out.push({
        code: identity.code,
        message: identity.message,
        span: spanOf(node, node.getSourceFile()),
        suggestion: identity.suggestion,
      });
      return;
    }
    try {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) checkCall(node, checker);
      if (ts.isIdentifier(node)) checkFunctionRef(node, checker);
      if (analysis.generic && ts.isPropertyAccessExpression(node)) {
        const recv = checker.getTypeAtLocation(node.expression);
        checkGenericField(recv, analysis.reaching(node.expression), node.name.text, node, checker);
      }
      if (analysis.generic && ts.isObjectBindingPattern(node)) {
        const recv = checker.getTypeAtLocation(node.parent);
        const reaching = analysis.reachingType(recv);
        for (const el of node.elements) {
          const prop = el.propertyName ?? el.name;
          if (ts.isIdentifier(prop)) checkGenericField(recv, reaching, prop.text, el, checker);
        }
      }
      if (analysis.generic && ts.isSpreadAssignment(node)) {
        const recv = checker.getTypeAtLocation(node.expression);
        const reaching = analysis.reachingType(recv);
        for (const p of checker.getPropertiesOfType(checker.getNonNullableType(recv))) {
          checkGenericField(recv, reaching, p.name, node, checker);
        }
      }
    } catch (e) {
      if (e instanceof GenericBoundaryError) {
        out.push({
          code: e.code === "CS1242" ? CODE.GENERIC_TYPE_ARGUMENT : CODE.REPRESENTATION_MISMATCH,
          message: e.reason,
          span: spanOf(node, node.getSourceFile()),
          suggestion: e.suggestion,
        });
        return;
      }
      // An unrepresentable type is reported where it is declared.
      if (!(e instanceof UnrepresentableTypeError)) throw e;
    }
    ts.forEachChild(node, visit);
  };
  for (const sf of loaded.sourceFiles) visit(sf);
  return out;
}
