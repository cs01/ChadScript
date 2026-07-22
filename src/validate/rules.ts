// Tailored rejection rules: constructs we reject with a specific code + rewrite, rather than
// the generic CS1000. Each returns a Diagnostic if it matches `node`, else null. These are
// the "better message" layer on top of default-deny — several (any, enum, ==, delete, with,
// index signatures, decorators, namespaces, eval) are PERMANENT non-goals per PLAN.md.

import ts from "typescript";
import type { Diagnostic } from "../diagnostics.js";
import { CODE, type Code } from "./codes.js";
import { spanOf } from "./validate.js";

export function tailoredRejection(
  node: ts.Node,
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
): Diagnostic | null {
  const hit = (code: Code, message: string, suggestion: string): Diagnostic => ({
    code,
    message,
    span: spanOf(node, sf),
    suggestion,
  });

  switch (node.kind) {
    case ts.SyntaxKind.AnyKeyword:
      return hit(CODE.ANY_TYPE, "`any` is not allowed", "give the value a concrete type");

    case ts.SyntaxKind.EnumDeclaration:
      return hit(
        CODE.ENUM,
        "`enum` is not supported",
        "use an `as const` object: `const Color = { Red: 0, Green: 1 } as const`",
      );

    case ts.SyntaxKind.NonNullExpression:
      return hit(
        CODE.NON_NULL_ASSERTION,
        "the non-null assertion `!` is not allowed",
        "narrow with an explicit `if (x !== null && x !== undefined)` check",
      );

    case ts.SyntaxKind.DeleteExpression:
      return hit(
        CODE.DELETE,
        "the `delete` operator is not supported",
        "model optional presence with `T | undefined` or a Map",
      );

    case ts.SyntaxKind.IndexSignature:
      return hit(
        CODE.INDEX_SIGNATURE,
        "index signatures (`[k: string]: T`) are not supported",
        "use `Map<string, T>` for dynamic keys",
      );

    case ts.SyntaxKind.Decorator:
      return hit(CODE.DECORATOR, "decorators are not supported", "call the wrapper explicitly");

    case ts.SyntaxKind.ModuleDeclaration:
      return hit(
        CODE.NAMESPACE,
        "`namespace` / `module` blocks are not supported",
        "use ESM `import` / `export`",
      );

    case ts.SyntaxKind.WithStatement:
      return hit(CODE.WITH, "`with` is not supported", "access properties explicitly");

    case ts.SyntaxKind.Parameter: {
      // Default (`x = v`) and optional (`x?`) parameters reach a lowering ICE today. Reject at
      // validate until argument-defaulting is implemented. A plain `x: T` param is unaffected.
      const p = node as ts.ParameterDeclaration;
      if (p.questionToken) {
        return hit(
          CODE.PARAM_FORM,
          "optional parameters (`x?`) are not supported yet",
          "declare it `x: T | undefined` and pass `undefined` explicitly at the call site",
        );
      }
      if (p.initializer) {
        return hit(
          CODE.PARAM_FORM,
          "default parameter values are not supported yet",
          "apply the default in the body: `const v = x === undefined ? DEFAULT : x`",
        );
      }
      return null;
    }

    // Regex literals sort into the literal-token band that default-deny treats as trivial, so they
    // slip the allowlist and would ICE in lowering. Reject here (tailored pass walks the whole tree)
    // until regex lands as a real feature.
    case ts.SyntaxKind.RegularExpressionLiteral:
      return hit(
        CODE.REGEX,
        "regular expression literals are not supported yet",
        "regex is a later phase; use string methods (includes/indexOf/replace/split) for now",
      );

    case ts.SyntaxKind.VariableDeclarationList:
      // `var` has function-scoped hoisting semantics we don't model. Only let/const.
      if (!(node.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const))) {
        return hit(CODE.VAR, "`var` is not supported", "use `let` or `const`");
      }
      return null;

    case ts.SyntaxKind.VariableDeclaration: {
      // `let x;` with no initializer ICEs in lowering (the slot type is taken from the initializer).
      // for-of/for-in loop variables and catch bindings are also initializer-less but valid — a
      // VariableStatement grandparent distinguishes a genuine declaration statement from those.
      const vd = node as ts.VariableDeclaration;
      if (
        !vd.initializer &&
        ts.isVariableDeclarationList(vd.parent) &&
        ts.isVariableStatement(vd.parent.parent)
      ) {
        return hit(
          CODE.UNINIT_VAR,
          "a variable declaration without an initializer is not supported yet",
          "initialize at the declaration: `let x: T = <initial value>`",
        );
      }
      return null;
    }

    case ts.SyntaxKind.ArrowFunction:
    case ts.SyntaxKind.FunctionExpression: {
      // Closures capture by value at creation, which is only sound for `const` bindings. A captured
      // mutable `let` would need capture-by-reference (heap boxing) — rejected until that lands
      // (mirrors the lowering-time check, hoisted here so it fails closed at validate, not as an ICE).
      const bad = findMutableCapture(node as ts.ArrowFunction | ts.FunctionExpression, checker);
      if (bad) {
        return hit(
          CODE.MUTABLE_CAPTURE,
          `a closure cannot capture the mutable variable \`${bad}\` yet`,
          "declare it `const`, or restructure so the closure does not close over an outer `let`",
        );
      }
      return null;
    }

    case ts.SyntaxKind.BinaryExpression:
      return checkBinary(node as ts.BinaryExpression, hit, checker);

    case ts.SyntaxKind.PropertyAccessExpression: {
      const pa = node as ts.PropertyAccessExpression;
      // `s.charCodeAt(...)`: byte value ≠ Node's UTF-16 code unit for non-ASCII. Gated (CS1216).
      if (pa.name.text === "charCodeAt") {
        return hit(
          CODE.STRING_UNICODE_OP,
          "`charCodeAt` is not supported yet",
          "it needs UTF-16 code-unit semantics over UTF-8 storage; use charAt for now",
        );
      }
      // Number formatting methods lowering doesn't have (toFixed's rounding ≠ JS half-away; the
      // others are unimplemented). Type-guarded so a user method of the same name is unaffected.
      if (UNSUPPORTED_NUMBER_METHODS.has(pa.name.text) && isNumberTyped(pa.expression, checker)) {
        return hit(
          CODE.NUMBER_METHOD,
          `\`${pa.name.text}\` on a number is not supported yet`,
          "build the string form manually, or use `.toString()` / template interpolation",
        );
      }
      return null;
    }

    case ts.SyntaxKind.ElementAccessExpression:
      // `s[i]` on a string yields a byte, not Node's UTF-16 code-unit character, for non-ASCII.
      // Gated (CS1216). Array element access (the common case) is unaffected.
      if (isStringTyped((node as ts.ElementAccessExpression).expression, checker)) {
        return hit(
          CODE.STRING_UNICODE_OP,
          "indexing a string with `[i]` is not supported yet",
          "it needs UTF-16 code-unit semantics; use `.charAt(i)` (or `.at(i)`) for now",
        );
      }
      return null;

    case ts.SyntaxKind.ForOfStatement:
      // `for (const c of str)` iterates UTF-8 bytes here, not Node's code points. Gated (CS1216).
      // Iterating arrays/Map/Set is unaffected.
      if (isStringTyped((node as ts.ForOfStatement).expression, checker)) {
        return hit(
          CODE.STRING_UNICODE_OP,
          "iterating a string with `for...of` is not supported yet",
          "it needs UTF-16/code-point semantics; index with `.charAt` over `.length` for now",
        );
      }
      return null;

    case ts.SyntaxKind.AsExpression:
    case ts.SyntaxKind.TypeAssertionExpression:
      return checkCast(node as ts.AsExpression | ts.TypeAssertion, hit);

    case ts.SyntaxKind.CallExpression:
      return checkCall(node as ts.CallExpression, hit, checker);

    case ts.SyntaxKind.NewExpression:
      return checkNew(node as ts.NewExpression, hit);

    default:
      return null;
  }
}

type Hit = (code: Code, message: string, suggestion: string) => Diagnostic;

const RELATIONAL_OPS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
]);

function checkBinary(
  node: ts.BinaryExpression,
  hit: Hit,
  checker: ts.TypeChecker,
): Diagnostic | null {
  const op = node.operatorToken.kind;
  if (op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken) {
    const strict = op === ts.SyntaxKind.EqualsEqualsToken ? "===" : "!==";
    const loose = op === ts.SyntaxKind.EqualsEqualsToken ? "==" : "!=";
    return hit(CODE.EQEQ, `\`${loose}\` is not supported`, `use \`${strict}\``);
  }
  // String `<`/`>`/`<=`/`>=`: byte-lexicographic order diverges from Node's UTF-16 code-unit order
  // for non-ASCII. Gated (CS1216) until exact semantics land. `===`/`!==` stay allowed (equality is
  // byte-exact for UTF-8). Uses the checker since the divergence is type-dependent.
  if (RELATIONAL_OPS.has(op) && isStringTyped(node.left, checker)) {
    return hit(
      CODE.STRING_UNICODE_OP,
      "relational comparison (`<` `>` `<=` `>=`) on strings is not supported yet",
      "it needs UTF-16 code-unit ordering; compare with === or compare numbers for now",
    );
  }
  return null;
}

// True when the expression's type is `string` (or a string literal type). Apparent type collapses
// string-literal unions to the primitive so `"a" < "b"` is caught too.
function isStringTyped(expr: ts.Expression, checker: ts.TypeChecker): boolean {
  const t = checker.getTypeAtLocation(expr);
  const base = checker.getBaseTypeOfLiteralType(t);
  return (base.flags & ts.TypeFlags.String) !== 0 || (t.flags & ts.TypeFlags.StringLiteral) !== 0;
}

function isNumberTyped(expr: ts.Expression, checker: ts.TypeChecker): boolean {
  const t = checker.getTypeAtLocation(expr);
  const base = checker.getBaseTypeOfLiteralType(t);
  return (base.flags & ts.TypeFlags.Number) !== 0 || (t.flags & ts.TypeFlags.NumberLiteral) !== 0;
}

const UNSUPPORTED_NUMBER_METHODS: ReadonlySet<string> = new Set([
  "toFixed",
  "toPrecision",
  "toExponential",
]);

// Map/Set instance methods lowering supports. `.size` is a property read, not a call — unaffected.
export const COLLECTION_METHODS: Record<"map" | "set", ReadonlySet<string>> = {
  map: new Set(["set", "get", "has", "delete", "keys", "values"]),
  set: new Set(["add", "has", "delete", "keys", "values"]),
};

// The instance methods codegen/lowering actually dispatch. Mirrors STR_METHODS + the special-cased
// forms in evalStrMethod/strAt (strings) and the array-method dispatch in lowerMethodCall (arrays).
// Kept as allowlists (default-DENY): any method absent here rejects, so an un-probed method fails
// closed rather than ICE'ing. The differential/valall gates catch an accidental over-rejection.
export const STRING_METHODS: ReadonlySet<string> = new Set([
  "toUpperCase",
  "toLowerCase",
  "trim",
  "trimStart",
  "trimEnd",
  "replaceAll",
  "repeat",
  "charAt",
  "replace",
  "split",
  "includes",
  "concat",
  "endsWith",
  "indexOf",
  "lastIndexOf",
  "padStart",
  "padEnd",
  "slice",
  "startsWith",
  "substr",
  "substring",
  "at",
]);
export const ARRAY_METHODS: ReadonlySet<string> = new Set([
  "push",
  "pop",
  "shift",
  "join",
  "at",
  "flat",
  "flatMap",
  "includes",
  "indexOf",
  "reduce",
  "map",
  "filter",
  "forEach",
  "find",
  "findIndex",
  "some",
  "every",
  "sort",
  "reverse",
  "slice",
  "concat",
]);

// True when `expr`'s type is an array (`T[]` / ReadonlyArray). Tuples are out of the subset already.
function isArrayTyped(expr: ts.Expression, checker: ts.TypeChecker): boolean {
  const name = checker.getTypeAtLocation(expr).symbol?.name;
  return name === "Array" || name === "ReadonlyArray";
}

// Whether `expr` is a Map or Set (by the global type's symbol name), else null.
function collectionKind(expr: ts.Expression, checker: ts.TypeChecker): "map" | "set" | null {
  const name = checker.getTypeAtLocation(expr).symbol?.name;
  if (name === "Map" || name === "ReadonlyMap") return "map";
  if (name === "Set" || name === "ReadonlySet") return "set";
  return null;
}

function checkCast(node: ts.AsExpression | ts.TypeAssertion, hit: Hit): Diagnostic | null {
  const k = node.type.kind;
  if (k === ts.SyntaxKind.AnyKeyword || k === ts.SyntaxKind.UnknownKeyword) {
    return hit(
      CODE.AS_ANY,
      "`as any` / `as unknown` escapes the type system",
      "narrow the value properly, or redesign so the type is known",
    );
  }
  return null;
}

function isNamedIdent(e: ts.Expression, name: string): boolean {
  return ts.isIdentifier(e) && e.text === name;
}

// The name of a mutable outer `let` captured by `fn`, or null if it captures none. Mirrors the
// lowering-time capture analysis exactly, so validate rejects precisely what lowering would.
function findMutableCapture(
  fn: ts.ArrowFunction | ts.FunctionExpression,
  checker: ts.TypeChecker,
): string | null {
  let found: string | null = null;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(node)) {
      const sym = checker.getSymbolAtLocation(node);
      const d = sym?.valueDeclaration;
      // Mutable capture iff: a `let` variable (not const, not a parameter) declared OUTSIDE fn.
      if (
        d &&
        ts.isVariableDeclaration(d) &&
        !(d.parent.flags & ts.NodeFlags.Const) &&
        !isDescendantOf(d, fn)
      ) {
        found = node.text;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
  return found;
}

function isDescendantOf(node: ts.Node, ancestor: ts.Node): boolean {
  for (let p: ts.Node | undefined = node; p; p = p.parent) if (p === ancestor) return true;
  return false;
}

function checkCall(node: ts.CallExpression, hit: Hit, checker: ts.TypeChecker): Diagnostic | null {
  if (isNamedIdent(node.expression, "eval")) {
    return hit(CODE.EVAL_OR_FUNCTION_CTOR, "`eval` is not supported", "there is no dynamic eval");
  }
  // JSON.* and Date.* are later phases — reject at validate so they fail closed with a rewrite,
  // rather than reaching the backend and ICE'ing (`unsupported method .stringify on object`).
  if (ts.isPropertyAccessExpression(node.expression)) {
    const recv = node.expression.expression;
    const m = node.expression.name.text;
    if (isNamedIdent(recv, "JSON") && (m === "stringify" || m === "parse")) {
      return hit(
        CODE.JSON_API,
        `\`JSON.${m}\` is not supported yet`,
        "JSON is a later phase; build or read the structure field-by-field for now",
      );
    }
    if (isNamedIdent(recv, "Date")) {
      return hit(CODE.DATE_API, `\`Date.${m}\` is not supported yet`, "Date is a later phase");
    }
    // String.fromCharCode / fromCodePoint build strings from UTF-16 code units — same UTF-16-over-
    // UTF-8 gap as charCodeAt, so gated (CS1216) rather than silently diverging on codes > 0x7F.
    if (isNamedIdent(recv, "String") && (m === "fromCharCode" || m === "fromCodePoint")) {
      return hit(
        CODE.STRING_UNICODE_OP,
        `\`String.${m}\` is not supported yet`,
        "it needs UTF-16 code-unit semantics over UTF-8 storage",
      );
    }
    // Map/Set instance methods: default-DENY against what lowering supports, so forEach/entries/
    // clear reject at validate instead of ICE'ing. Receiver type comes from the checker.
    const coll = collectionKind(recv, checker);
    if (coll && !COLLECTION_METHODS[coll].has(m)) {
      return hit(
        CODE.COLLECTION_METHOD,
        `\`${coll === "map" ? "Map" : "Set"}.${m}\` is not supported yet`,
        `supported: ${[...COLLECTION_METHODS[coll]].join(", ")} (iterate via .keys()/.values())`,
      );
    }
    // String instance methods: default-DENY against the set codegen dispatches (charCodeAt has its
    // own CS1216 rule, so skip it here to avoid a duplicate diagnostic).
    if (m !== "charCodeAt" && !STRING_METHODS.has(m) && isStringTyped(recv, checker)) {
      return hit(
        CODE.STRING_METHOD,
        `\`String.prototype.${m}\` is not supported yet`,
        `supported string methods: ${[...STRING_METHODS].join(", ")}`,
      );
    }
    // Array instance methods: default-DENY against the set lowering dispatches.
    if (!ARRAY_METHODS.has(m) && isArrayTyped(recv, checker)) {
      return hit(
        CODE.ARRAY_METHOD,
        `\`Array.prototype.${m}\` is not supported yet`,
        `supported array methods: ${[...ARRAY_METHODS].join(", ")}`,
      );
    }

    // Namespace statics: default-DENY against a per-namespace allowlist of what lowering supports,
    // so an unsupported one (Array.from, Number.isInteger, Object.assign, …) rejects at validate
    // instead of ICE'ing in the backend. Instance methods (`arr.map`, `n.toString`) are separate.
    if (ts.isIdentifier(recv)) {
      const allow = NAMESPACE_STATIC_ALLOW[recv.text];
      if (allow && !allow.has(m)) {
        const allowed = allow.size ? `; supported: ${[...allow].join(", ")}` : "";
        return hit(
          CODE.STDLIB_STATIC,
          `\`${recv.text}.${m}\` is not supported yet`,
          `this static is not in the subset yet${allowed}`,
        );
      }
    }

    // Method call on a PLAIN object (a function-valued field, or an interface method): only class
    // instances have callable methods in the subset, so these reach a lowering ICE. Guarded to
    // exclude class instances, arrays/Map/Set (handled above), and the global namespace receivers
    // whose calls are supported (console.log/process.exit/Math.floor/Object.keys/…).
    const rt = checker.getTypeAtLocation(recv);
    const isGlobalRecv = ts.isIdentifier(recv) && GLOBAL_RECEIVERS.has(recv.text);
    if (
      !isGlobalRecv &&
      (rt.flags & ts.TypeFlags.Object) !== 0 &&
      !isClassInstanceType(rt) &&
      !isArrayTyped(recv, checker) &&
      collectionKind(recv, checker) === null
    ) {
      return hit(
        CODE.OBJECT_METHOD,
        `calling \`.${m}()\` on a plain object is not supported yet`,
        "only class-instance methods are callable; use a class instead of a function-valued field",
      );
    }
  }
  return null;
}

// Global receivers whose method calls are supported (or gated by a dedicated rule above), so the
// plain-object-method check must not touch them.
const GLOBAL_RECEIVERS: ReadonlySet<string> = new Set([
  "console",
  "process",
  "Math",
  "Object",
  "JSON",
  "Date",
  "String",
  "Number",
  "Array",
  "Promise",
]);

// A class-instance type (its symbol is declared by a `class`), vs a plain object/interface type.
function isClassInstanceType(t: ts.Type): boolean {
  const vd = t.symbol?.valueDeclaration;
  return vd !== undefined && ts.isClassDeclaration(vd);
}

// Static (namespace) methods lowering supports, per global. A call `X.m(...)` with `X` in this
// table and `m` absent from its set is rejected (CS1220). Empty set = no static of that global is
// supported yet. Instance methods and the `X(...)` conversion calls are NOT gated here.
export const NAMESPACE_STATIC_ALLOW: Record<string, ReadonlySet<string>> = {
  Object: new Set(["keys", "values"]),
  Array: new Set(),
  Number: new Set(),
  // Math methods codegen actually lowers (evalMathCall). Others (hypot/pow/random/sin/…) ICE, so
  // reject them here. Math CONSTANTS (Math.PI) are property reads, not calls — unaffected.
  Math: new Set(["floor", "ceil", "trunc", "abs", "sqrt", "round", "sign", "pow", "max", "min"]),
  // Promise statics codegen lowers. `all`/`race`/`allSettled`/`reject` are later slices, so they
  // reject here until implemented.
  Promise: new Set(["resolve"]),
};

function checkNew(node: ts.NewExpression, hit: Hit): Diagnostic | null {
  if (isNamedIdent(node.expression, "Function")) {
    return hit(
      CODE.EVAL_OR_FUNCTION_CTOR,
      "the `Function` constructor is not supported",
      "write the function directly",
    );
  }
  if (isNamedIdent(node.expression, "Date")) {
    return hit(CODE.DATE_API, "`new Date()` is not supported yet", "Date is a later phase");
  }
  return null;
}
