// Syntactic forms that are tsc-clean but that lowering does not model, found by the ICE sweep
// (scripts/ice-sweep.ts). Each used to reach a lowering or codegen ICE; each is rejected here with
// its rewrite instead.

import ts from "typescript";
import type { Diagnostic } from "../diagnostics.js";
import { CODE } from "./codes.js";
import type { Hit } from "./type-rules.js";
import { isValuePosition } from "./builtin-rules.js";
import { UnrepresentableTypeError, valueTypeOfTsType } from "../lower/type-translation.js";
import { callbackParamProblem } from "../lower/callback-adapt.js";
import { builtinIdOf } from "../lower/builtin-values.js";
import type { ValueType } from "../hir/types.js";

export function checkForm(node: ts.Node, hit: Hit, checker: ts.TypeChecker): Diagnostic | null {
  switch (node.kind) {
    // Only top-level `function` declarations are lowered (as module functions). A nested one is
    // hoisted within its block and may recurse or be called before its declaration, which a
    // closure bound at that point cannot model.
    case ts.SyntaxKind.FunctionDeclaration:
      if (ts.isSourceFile(node.parent)) return null;
      return hit(
        CODE.NOT_IN_SUBSET,
        "a `function` declaration inside a function or block is not in the subset yet",
        "move it to the top level (pass what it needs as parameters), or bind an arrow function " +
          "with `const` before its first use",
      );

    // `[]` read where nothing gives it an element type (`[].length`, `for (const x of [])`) is a
    // `never[]`, which has no representation. (A declaration's `[]` is left to the declaration.)
    case ts.SyntaxKind.ArrayLiteralExpression: {
      const lit = node as ts.ArrayLiteralExpression;
      if (lit.elements.length > 0 || checker.getContextualType(lit) !== undefined) return null;
      let at: ts.Node = lit;
      while (ts.isParenthesizedExpression(at.parent)) at = at.parent;
      if (ts.isVariableDeclaration(at.parent)) return null;
      return hit(
        CODE.UNREPRESENTABLE_TYPE,
        "an empty array literal with no element type (`never[]`) is not supported here",
        "declare it with its element type first: `const xs: number[] = []`",
      );
    }

    // A literal's field names are identifiers or quoted strings. A numeric name, or a quoted one
    // that is an array index, is an integer key, which JS orders before every other key.
    case ts.SyntaxKind.PropertyAssignment: {
      const name = (node as ts.PropertyAssignment).name;
      const integerKey =
        ts.isNumericLiteral(name) || (ts.isStringLiteral(name) && /^(0|[1-9]\d*)$/.test(name.text));
      if (!integerKey) return null;
      return hit(
        CODE.NOT_IN_SUBSET,
        "a numeric property name in an object literal is not supported",
        "JS orders integer keys first; use a non-numeric name, or a `Map<number, T>`",
      );
    }

    // A Map iterated directly yields [key, value] entries, which need tuples. (A Set iterated
    // directly, and keys()/values() of either, iterate the table live: lower/statements.ts.)
    case ts.SyntaxKind.ForOfStatement: {
      const loop = node as ts.ForOfStatement;
      if (collectionName(loop.expression, checker) !== "Map") return null;
      return hit(
        CODE.COLLECTION_METHOD,
        "iterating a Map directly with `for...of` is not supported yet",
        "iterate its keys and read each value: `for (const k of m.keys())`",
      );
    }

    // `obj["name"]` on an object is a field READ by a literal name (how a quoted field is reached).
    // A computed key, a write, or a call through it is not lowered.
    case ts.SyntaxKind.ElementAccessExpression: {
      const ea = node as ts.ElementAccessExpression;
      if (!isObjectValue(ea.expression, checker)) return null;
      let key = ea.argumentExpression;
      while (ts.isParenthesizedExpression(key)) key = key.expression;
      let at: ts.Node = ea;
      while (ts.isParenthesizedExpression(at.parent)) at = at.parent;
      const p = at.parent;
      const written =
        (ts.isBinaryExpression(p) &&
          p.left === at &&
          p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          p.operatorToken.kind <= ts.SyntaxKind.LastAssignment) ||
        ((ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) &&
          (p.operator === ts.SyntaxKind.PlusPlusToken ||
            p.operator === ts.SyntaxKind.MinusMinusToken)) ||
        (ts.isCallExpression(p) && p.expression === at);
      if (ts.isStringLiteral(key) && !written) return null;
      return hit(
        CODE.NOT_IN_SUBSET,
        written
          ? 'writing or calling through `obj["name"]` is not supported yet'
          : "indexing an object with a computed key is not supported",
        written
          ? "read it into a local first, or give the field an identifier name and use `obj.name`"
          : "use `obj.name`, a `switch` over the key, or a `Map<string, T>` for dynamic keys",
      );
    }

    case ts.SyntaxKind.CallExpression: {
      const coll = collectionCall(node as ts.CallExpression, checker);
      return coll === null
        ? arrayCallbackProblem(node as ts.CallExpression, hit, checker)
        : checkCollectionCall(node as ts.CallExpression, coll, hit, checker);
    }

    // A read tsc narrowed to `never` (code its flow analysis proves unreachable, e.g. a test on a
    // variable inside an immediately-invoked arrow) has no value to lower.
    case ts.SyntaxKind.Identifier: {
      const parent = node.parent;
      if (!parent || !isValuePosition(node, parent)) return null;
      if (!(checker.getTypeAtLocation(node).flags & ts.TypeFlags.Never)) return null;
      return hit(
        CODE.UNREPRESENTABLE_TYPE,
        `TypeScript narrowed \`${(node as ts.Identifier).text}\` to \`never\` here, so this code cannot run`,
        "remove the unreachable code, or declare the variable with a type the narrowing keeps",
      );
    }

    default:
      return null;
  }
}

// `x.m(...)` on a Map or Set: the method name and the collection type, else null.
function collectionCall(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
): { method: string; kind: "Map" | "Set" } | null {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  const kind = collectionName(callee.expression, checker);
  return kind === null ? null : { method: callee.name.text, kind };
}

function checkCollectionCall(
  call: ts.CallExpression,
  coll: { method: string; kind: "Map" | "Set" },
  hit: Hit,
  checker: ts.TypeChecker,
): Diagnostic | null {
  // keys()/values() lower to a live walk only as a for...of's iterable, and to a snapshot as a
  // spread operand (eager in Node too). An iterator held anywhere else (`const it = m.keys()`)
  // would see later mutations in Node, which a snapshot cannot.
  if (coll.method === "keys" || coll.method === "values") {
    let at: ts.Node = call;
    while (ts.isParenthesizedExpression(at.parent)) at = at.parent;
    const p = at.parent;
    if ((ts.isForOfStatement(p) && p.expression === at) || ts.isSpreadElement(p)) return null;
    return hit(
      CODE.COLLECTION_METHOD,
      `a ${coll.kind} iterator from \`${coll.method}()\` is only supported as a for...of iterable or a spread`,
      `iterate it directly (\`for (const k of m.${coll.method}())\`), or take a snapshot array: \`[...m.${coll.method}()]\``,
    );
  }
  if (coll.method === "forEach") return forEachCallbackMismatch(call, coll.kind, hit, checker);
  return null;
}

// forEach calls its callback with (value, key, collection) in the collection's own
// representations; a wider parameter is converted by an adapter (lower/callback-adapt.ts) when
// one word conversion reaches it.
function forEachCallbackMismatch(
  call: ts.CallExpression,
  kind: "Map" | "Set",
  hit: Hit,
  checker: ts.TypeChecker,
): Diagnostic | null {
  const cb = call.arguments[0];
  const callee = call.expression as ts.PropertyAccessExpression;
  if (!cb || call.arguments.length !== 1) {
    return hit(
      CODE.COLLECTION_METHOD,
      `\`${kind}.forEach\` takes exactly one callback here`,
      "drop the thisArg; use an arrow function that captures what it needs",
    );
  }
  let passed: ValueType[] = [];
  try {
    const collType = valueTypeOfTsType(
      checker.getTypeAtLocation(callee.expression),
      callee.expression,
      checker,
    );
    passed =
      collType.kind === "map"
        ? [collType.value, collType.key, collType]
        : collType.kind === "set"
          ? [collType.element, collType.element, collType]
          : [];
  } catch (err) {
    if (err instanceof UnrepresentableTypeError) return null;
    throw err;
  }
  const problem = callbackProblem(cb, passed, checker);
  if (problem === null) return null;
  return hit(
    CODE.REPRESENTATION_MISMATCH,
    `this \`${kind}.forEach\` callback cannot be called with the ${kind}'s entries: ${problem}`,
    "declare the parameters with the element types (or leave them unannotated)",
  );
}

// The array methods whose callback a generated loop calls (codegen/array.ts), with what it passes.
const ARRAY_CALLBACK_METHODS: ReadonlySet<string> = new Set([
  "map",
  "filter",
  "forEach",
  "reduce",
  "find",
  "findIndex",
  "some",
  "every",
  "flatMap",
  "sort",
]);

function arrayCallbackProblem(
  call: ts.CallExpression,
  hit: Hit,
  checker: ts.TypeChecker,
): Diagnostic | null {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  const method = callee.name.text;
  const cb = call.arguments[0];
  if (!ARRAY_CALLBACK_METHODS.has(method) || !cb) return null;
  let passed: ValueType[];
  try {
    const recv = valueTypeOfTsType(
      checker.getTypeAtLocation(callee.expression),
      callee.expression,
      checker,
    );
    if (recv.kind !== "array") return null;
    if (method === "sort") passed = [recv.element, recv.element];
    else passed = [recv.element, { kind: "number" }, recv];
    if (method === "reduce") {
      passed.unshift(valueTypeOfTsType(checker.getTypeAtLocation(call), call, checker));
    }
  } catch (err) {
    if (err instanceof UnrepresentableTypeError) return null;
    throw err;
  }
  const problem = callbackProblem(cb, passed, checker);
  if (problem === null) return null;
  return hit(
    CODE.REPRESENTATION_MISMATCH,
    `this \`${method}\` callback cannot be called with the array's elements: ${problem}`,
    "declare the parameters with the element types (or leave them unannotated)",
  );
}

// Why callback `cb` cannot be called by a builtin loop passing `passed`, or null
// (lower/callback-adapt.ts converts what can be converted).
function callbackProblem(
  cb: ts.Expression,
  passed: readonly ValueType[],
  checker: ts.TypeChecker,
): string | null {
  // A builtin (`xs.forEach(console.log)`) is wrapped at exactly the type the loop passes, and
  // checked by builtin-rules.ts.
  let bare: ts.Expression = cb;
  while (ts.isParenthesizedExpression(bare)) bare = bare.expression;
  if (builtinIdOf(bare, checker) !== null || passed.length === 0) return null;
  const sig = checker.getSignaturesOfType(checker.getTypeAtLocation(cb), ts.SignatureKind.Call);
  if (sig.length !== 1) return null; // other rules own these
  const declared: ValueType[] = [];
  try {
    for (const p of sig[0]!.getParameters()) {
      const decl = p.valueDeclaration;
      if (decl && ts.isParameter(decl) && decl.dotDotDotToken) return "it takes a rest parameter";
      declared.push(valueTypeOfTsType(checker.getTypeOfSymbolAtLocation(p, cb), cb, checker));
    }
  } catch (err) {
    if (err instanceof UnrepresentableTypeError) return null;
    throw err;
  }
  return callbackParamProblem(declared, passed);
}

function collectionName(e: ts.Expression, checker: ts.TypeChecker): "Map" | "Set" | null {
  const name = checker.getTypeAtLocation(e).symbol?.name;
  if (name === "Map" || name === "ReadonlyMap") return "Map";
  if (name === "Set" || name === "ReadonlySet") return "Set";
  return null;
}

function isObjectValue(e: ts.Expression, checker: ts.TypeChecker): boolean {
  try {
    return valueTypeOfTsType(checker.getTypeAtLocation(e), e, checker).kind === "object";
  } catch (err) {
    if (err instanceof UnrepresentableTypeError) return false;
    throw err;
  }
}
