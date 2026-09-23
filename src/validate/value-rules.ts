// Validator rules for Value unions (a union whose members have different machine representations,
// ValueType `value`). Two questions the allowlist of syntax kinds cannot answer:
//
//   CS1239: an un-narrowed Value used by an operation the compiler does not implement for one. TS
//     accepts `x + 1`, `x.length` and `x < y` on `number | string`; JS defines them dynamically, and
//     the compiler implements only the operations listed in `valueUseProblem` (printing, String(),
//     templates, ===, typeof, truthiness, ??, flows into union-typed slots). Default-deny: any other
//     parent of a Value-typed expression is rejected, with "narrow it first" as the rewrite.
//
//   CS1240: a value flowing into a slot whose NESTED representation differs. TS arrays, maps and
//     function types are covariant (or bivariant), so `number[]` is assignable to
//     `(number | string)[]`. The top level of a flow is converted (box/unbox/wrap), but a container
//     is shared by reference: its slots hold raw doubles and the reader would decode them as Value
//     words. Converting would need a copy, which changes aliasing, so the flow is rejected.

import ts from "typescript";
import type { Diagnostic } from "../diagnostics.js";
import type { ValueType } from "../hir/types.js";
import { UnrepresentableTypeError, valueTypeOfTsType } from "../lower/type-translation.js";
import { CODE } from "./codes.js";
import { spanOf } from "./validate.js";

function vtOf(t: ts.Type, at: ts.Node, checker: ts.TypeChecker): ValueType | null {
  if (
    t.flags &
    (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.Void)
  ) {
    return null;
  }
  try {
    return valueTypeOfTsType(t, at, checker);
  } catch (e) {
    if (e instanceof UnrepresentableTypeError) return null; // reported where it is declared
    throw e;
  }
}

// Positions where an identifier NAMES something rather than reading a value.
function isNamePosition(id: ts.Identifier): boolean {
  const p = id.parent;
  if (!p) return true;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return true;
  if (ts.isQualifiedName(p) || ts.isTypeReferenceNode(p) || ts.isTypeQueryNode(p)) return true;
  if (ts.isExpressionWithTypeArguments(p)) return true;
  if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p)) return true;
  if (ts.isNamespaceImport(p) || ts.isBindingElement(p) || ts.isPropertySignature(p)) return true;
  if (ts.isPropertyAssignment(p) && p.name === id) return true;
  const named = p as ts.Node & { name?: ts.Node };
  return named.name === id;
}

function isValueExpression(node: ts.Node): node is ts.Expression {
  if (ts.isIdentifier(node)) return !isNamePosition(node);
  return (
    ts.isCallExpression(node) ||
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node) ||
    ts.isConditionalExpression(node) ||
    ts.isBinaryExpression(node) ||
    ts.isAwaitExpression(node) ||
    ts.isNewExpression(node) ||
    ts.isNonNullExpression(node)
  );
}

// A declaration from a `.d.ts` (the default lib or stdlib/globals.d.ts) is a builtin, whose
// parameters lowering does not coerce; anything else is program code, whose arguments it does.
function isUserCallee(call: ts.CallExpression | ts.NewExpression, checker: ts.TypeChecker) {
  const decl = checker.getResolvedSignature(call)?.declaration;
  return decl !== undefined && !decl.getSourceFile().isDeclarationFile;
}

function calleeName(call: ts.CallExpression): string | null {
  const c = call.expression;
  if (ts.isIdentifier(c)) return c.text;
  if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression)) {
    return `${c.expression.text}.${c.name.text}`;
  }
  return null;
}

function isArrayType(t: ts.Type, checker: ts.TypeChecker): boolean {
  return t.symbol?.name === "Array" || checker.isTupleType(t);
}

// Only primitive and nullish members have a String() form the compiler implements (an object's
// would call its toString, an array's would join its elements).
function primitiveOnly(vt: ValueType): boolean {
  return (
    vt.kind === "value" &&
    vt.members.every((m) => ["number", "string", "boolean", "null", "undefined"].includes(m.kind))
  );
}

// Why the Value-typed expression `e` (of union `vt`) cannot be used where it sits, or null.
function valueUseProblem(e: ts.Expression, vt: ValueType, checker: ts.TypeChecker): string | null {
  let at: ts.Node = e;
  while (ts.isParenthesizedExpression(at.parent)) at = at.parent;
  const p = at.parent;
  if (ts.isVariableDeclaration(p) && p.initializer === at) return null;
  if (ts.isReturnStatement(p) || ts.isExpressionStatement(p) || ts.isExportAssignment(p)) {
    return null;
  }
  if (ts.isArrowFunction(p) && p.body === at) return null;
  if (ts.isIfStatement(p) || ts.isWhileStatement(p) || ts.isDoStatement(p)) return null;
  if (ts.isForStatement(p) && p.condition === at) return null;
  if (ts.isConditionalExpression(p)) return null;
  if (ts.isTypeOfExpression(p)) return null;
  // `x!` is admitted only word to word (rules.ts), where it passes the word through; its own
  // use is checked as an expression in turn.
  if (ts.isNonNullExpression(p)) return null;
  if (ts.isSwitchStatement(p) || ts.isCaseClause(p)) return null;
  if (ts.isArrayLiteralExpression(p)) return null;
  if (ts.isPropertyAssignment(p) && p.initializer === at) return null;
  if (ts.isShorthandPropertyAssignment(p)) return null;
  if (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken) return null;
  if (ts.isTemplateSpan(p)) {
    return primitiveOnly(vt) ? null : "interpolating a union that can hold an object or array";
  }
  if (ts.isBinaryExpression(p)) {
    switch (p.operatorToken.kind) {
      case ts.SyntaxKind.EqualsToken:
      case ts.SyntaxKind.EqualsEqualsEqualsToken:
      case ts.SyntaxKind.ExclamationEqualsEqualsToken:
      case ts.SyntaxKind.QuestionQuestionToken:
        return null;
      case ts.SyntaxKind.PlusToken:
      case ts.SyntaxKind.PlusEqualsToken: {
        // `"v=" + x` is string concatenation, which converts x exactly like String(x).
        const result = vtOf(checker.getTypeAtLocation(p), p, checker);
        if (result?.kind === "string" && primitiveOnly(vt)) return null;
        return "`+` on a union of different kinds (narrow it, or concatenate with a string)";
      }
      case ts.SyntaxKind.InstanceOfKeyword:
        return p.left === at ? null : "`instanceof` with a union on the right";
      case ts.SyntaxKind.AmpersandAmpersandToken:
      case ts.SyntaxKind.BarBarToken: {
        // The result is one of the operands. When tsc narrows a Value left operand away entirely
        // (`x || d` with `x: 0 | ""`), the result is not a union and the left word could not be
        // read as it; keep the result a union.
        const result = vtOf(checker.getTypeAtLocation(p), p, checker);
        return result?.kind === "value" || p.right === at
          ? null
          : "a `&&`/`||` whose result drops the union's kinds";
      }
      default:
        return `the \`${ts.tokenToString(p.operatorToken.kind)}\` operator on a union of different kinds`;
    }
  }
  if (ts.isNewExpression(p))
    return isUserCallee(p, checker) ? null : "passing a union to a builtin";
  if (ts.isCallExpression(p)) {
    if (p.expression === at) return "calling a union";
    if (isUserCallee(p, checker)) return null;
    const name = calleeName(p);
    if (name === "console.log" || name === "Array.isArray" || name === "Boolean") return null;
    if (name === "JSON.stringify" && p.arguments[0] === at) return null;
    if (name === "String") {
      return primitiveOnly(vt) ? null : "String() of a union that can hold an object or array";
    }
    // Array and Map methods whose parameter is the element / value type take the word as is.
    const callee = p.expression;
    if (ts.isPropertyAccessExpression(callee)) {
      const recv = checker.getTypeAtLocation(callee.expression);
      const m = callee.name.text;
      if (isArrayType(recv, checker) && ["push", "includes", "indexOf"].includes(m)) return null;
      if (recv.symbol?.name === "Map" && m === "set" && p.arguments[1] === at) return null;
    }
    return `passing a union of different kinds to \`${name ?? "this builtin"}\``;
  }
  if (ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) {
    return "reading a property of a union of different kinds";
  }
  return `using a union of different kinds in a ${ts.SyntaxKind[p.kind]}`;
}

export function valueUseDiagnostic(node: ts.Node, checker: ts.TypeChecker): Diagnostic | null {
  // `xs.join()` stringifies each element like String(x), so an element union holding an object
  // (an erased `T[]`, a `(Pt | string)[]`) has no implemented form either.
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "join"
  ) {
    const recv = vtOf(checker.getTypeAtLocation(node.expression.expression), node, checker);
    const el = recv?.kind === "array" ? recv.element : null;
    const objectLike =
      el?.kind === "value"
        ? !primitiveOnly(el)
        : el?.kind === "optional" && !["number", "string", "boolean"].includes(el.inner.kind);
    if (objectLike) {
      return {
        code: CODE.VALUE_OPERATION,
        message: "`join` of an array whose elements can be objects is not supported",
        span: spanOf(node, node.getSourceFile()),
        suggestion: "map the elements to strings first: `xs.map((x) => ...).join()`",
      };
    }
  }
  if (!isValueExpression(node)) return null;
  const vt = vtOf(checker.getTypeAtLocation(node), node, checker);
  if (!vt || vt.kind !== "value") return null;
  const problem = valueUseProblem(node, vt, checker);
  if (!problem) return null;
  return {
    code: CODE.VALUE_OPERATION,
    message: `${problem} is not supported: \`${node.getText()}\` is \`${checker.typeToString(checker.getTypeAtLocation(node))}\``,
    span: spanOf(node, node.getSourceFile()),
    suggestion:
      'narrow it first (`typeof x === "number"`, `x !== undefined`, `Array.isArray(x)`), then use the narrowed value',
  };
}

// ---- CS1240: nested representation agreement ----

// The kinds a slot of type `t` can hold at its top level, each with its own representation.
function components(t: ValueType): ValueType[] {
  if (t.kind === "value") return t.members;
  if (t.kind === "optional") return [t.inner];
  return [t];
}

// Whether a value of type `src` can land in a slot of type `dst`: the top level is converted by
// lowering, so each kind `src` can hold only needs the matching kind of `dst` to agree NESTED.
export function flowAgrees(src: ValueType, dst: ValueType, depth = 0): boolean {
  if (depth > 6) return true; // recursive types: agreement near the surface is what matters
  for (const s of components(src)) {
    if (s.kind === "null" || s.kind === "undefined") continue;
    const d = components(dst).find((c) => c.kind === s.kind);
    if (d && !sameNested(s, d, depth)) return false;
  }
  return true;
}

// Whether two types have the same representation all the way down. Object records are shared by
// pointer but read through their own Value slots, so an object's fields only need to agree the
// way a flow does (flowAgrees), not exactly.
function sameNested(a: ValueType, b: ValueType, depth: number): boolean {
  if (depth > 6) return true;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "array":
      return sameNested(a.element, (b as typeof a).element, depth + 1);
    case "set":
      return sameNested(a.element, (b as typeof a).element, depth + 1);
    case "optional":
      return sameNested(a.inner, (b as typeof a).inner, depth + 1);
    case "promise":
      return sameNested(a.inner, (b as typeof a).inner, depth + 1);
    case "map": {
      const m = b as typeof a;
      return sameNested(a.key, m.key, depth + 1) && sameNested(a.value, m.value, depth + 1);
    }
    case "function": {
      // A closure is called with the slot type's machine arguments and returns its own result, so
      // each parameter both sides declare, and a result both sides have, must agree exactly. (A
      // parameter only one side lists is an argument the callee ignores, and a result the slot
      // type calls void is discarded.)
      const f = b as typeof a;
      const paramsOk = a.params.every((p, i) => {
        const q = f.params[i];
        return q === undefined || sameNested(p, q, depth + 1);
      });
      // A builtin callback typed `=> unknown` (find, some, every) has its result read at the
      // callback's own type (codegen asks the closure's type, not the slot's), so it matches any.
      const retOk =
        a.ret === null ||
        f.ret === null ||
        f.ret.kind === "unknown" ||
        sameNested(a.ret, f.ret, depth + 1);
      return paramsOk && retOk;
    }
    case "value": {
      const v = b as typeof a;
      return (
        a.members.length === v.members.length &&
        a.members.every((m) => {
          const o = v.members.find((n) => n.kind === m.kind);
          return o !== undefined && sameNested(m, o, depth + 1);
        })
      );
    }
    case "object": {
      const o = b as typeof a;
      return o.shape.fields.every((g) => {
        const f = a.shape.fields.find((x) => x.name === g.name);
        return f === undefined || flowAgrees(f.type, g.type, depth + 1);
      });
    }
    case "number":
    case "string":
    case "boolean":
    case "null":
    case "undefined":
    case "unknown":
    case "opaque":
      return true;
    default: {
      const never: never = a;
      return (never as unknown) === undefined;
    }
  }
}

// Expressions whose own type is not what reaches the slot: a literal takes its representation from
// the slot (resolveType), and a conditional or logical expression's operands are checked one by one.
function checkedThroughParts(e: ts.Expression): boolean {
  return (
    ts.isArrayLiteralExpression(e) ||
    ts.isObjectLiteralExpression(e) ||
    ts.isConditionalExpression(e) ||
    ts.isParenthesizedExpression(e) ||
    (ts.isBinaryExpression(e) &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(e.operatorToken.kind))
  );
}

export function flowDiagnostic(node: ts.Node, checker: ts.TypeChecker): Diagnostic | null {
  let src: ts.Type;
  let dst: ts.Type | undefined;
  let at: ts.Node = node;
  if (ts.isSpreadElement(node) && ts.isArrayLiteralExpression(node.parent)) {
    // `[...xs]` copies xs's slots as they are, so its elements must already be in the literal's.
    const lit = node.parent;
    const litType = checker.getContextualType(lit) ?? checker.getTypeAtLocation(lit);
    const litElem = arrayElem(litType, checker);
    const srcElem = arrayElem(checker.getTypeAtLocation(node.expression), checker);
    if (!litElem || !srcElem) return null;
    src = srcElem;
    dst = litElem;
    at = node.expression;
  } else if (ts.isAsExpression(node)) {
    src = checker.getTypeAtLocation(node.expression);
    dst = checker.getTypeAtLocation(node);
  } else {
    if (!ts.isExpression(node) || checkedThroughParts(node)) return null;
    if (ts.isIdentifier(node) && isNamePosition(node)) return null;
    dst = checker.getContextualType(node);
    if (!dst) return null;
    src = checker.getTypeAtLocation(node);
    // A callback handed to a builtin (map, flatMap, sort, setTimeout) is invoked by code that
    // reads the closure through its OWN type (codegen/array.ts uses the callback's ValueType), so
    // the builtin's declared callback type (`=> U | readonly U[]`) never meets its machine form.
    const parent = node.parent;
    if (
      (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
      parent.arguments?.includes(node) &&
      !isUserCallee(parent, checker) &&
      checker.getSignaturesOfType(src, ts.SignatureKind.Call).length > 0
    ) {
      return null;
    }
  }
  const s = vtOf(src, at, checker);
  const d = vtOf(dst, at, checker);
  if (!s || !d || flowAgrees(s, d)) return null;
  return {
    code: CODE.REPRESENTATION_MISMATCH,
    message: `\`${checker.typeToString(src)}\` cannot be used as \`${checker.typeToString(dst)}\`: their elements (or parameters) are stored differently, and both would share the same object`,
    span: spanOf(at, at.getSourceFile()),
    suggestion:
      "make a converted copy with the target's type, e.g. `xs.map((x): number | string => x)`, or declare the source with the target's type",
  };
}

function arrayElem(t: ts.Type, checker: ts.TypeChecker): ts.Type | undefined {
  if (t.symbol?.name !== "Array") return undefined;
  return checker.getTypeArguments(t as ts.TypeReference)[0];
}
