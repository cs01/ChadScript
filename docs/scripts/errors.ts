// Generates docs/reference/errors.md: one entry per diagnostic code. The code list comes from the
// validator's table (src/validate/codes.ts); the prose is the hand-written map below. A unit test
// (tests/unit/docs-site.test.ts) fails when a code has no entry, an entry names a code that no
// longer exists, or the checked-in page differs from this output.
//
//   bun run docs/scripts/errors.ts

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { CODE } from "../../src/validate/codes.js";

interface Entry {
  title: string;
  meaning: string; // why the compiler refuses it (markdown)
  rewrite: string; // what to write instead (markdown)
  planned?: boolean; // true when a later phase is expected to admit it
  reserved?: boolean; // true when no validator rule emits the code today (a test checks this)
}

// Codes produced outside the validator table: tsc diagnostics and internal compiler errors.
const EXTRA: Record<string, Entry> = {
  CS0001: {
    title: "TypeScript error",
    meaning:
      "The program does not typecheck under the strict options ChadScript imposes (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`). TypeScript's checker decides every type, so a program with any type error is not compiled. Importing a name that a built-in module (`node:fs`, `node:path`) does not provide in the subset also lands here, because `stdlib/globals.d.ts` only declares what is supported.",
    rewrite: "Fix the type error tsc reports. The message after the code is tsc's own.",
  },
  CS9000: {
    title: "Internal compiler error",
    meaning:
      "A program passed the validator but a later stage could not compile it. This is always a compiler bug: the validator should have admitted the construct fully or rejected it with a code from this page.",
    rewrite:
      "Please [open an issue](https://github.com/cs01/ChadScript/issues) with the smallest program that triggers it. Until it is fixed, rewrite the construct named in the message.",
  },
};

export const EXPLANATIONS: Record<keyof typeof CODE, Entry> = {
  NOT_IN_SUBSET: {
    title: "Not in the subset",
    meaning:
      "The general rejection. The compiler accepts a construct only when it has a rule for it, backed by a test that checks the result against Node; anything else stops here. The message names the construct (for example `GetAccessor`, a method in an object literal, top-level `await`, a nested `function` declaration, an optional chain longer than one `?.`).",
    rewrite:
      "Follow the `help:` line, which is specific to the construct. The [subset reference](/reference/subset) lists every admitted syntax kind.",
    planned: true,
  },
  ANY_TYPE: {
    title: "`any`",
    meaning:
      "`any` switches off the type checker, and the compiler needs a static type for every value to choose its representation.",
    rewrite: "Give the value a concrete type, or a union of the types it can hold.",
  },
  ENUM: {
    title: "`enum`",
    meaning:
      "TypeScript enums generate a runtime object with reverse mappings; they are not in the subset.",
    rewrite:
      'Use a union of string literals (`type Color = "red" | "green"`) or an `as const` object.',
  },
  EQEQ: {
    title: "`==` and `!=`",
    meaning:
      "Loose equality applies JavaScript's coercion table; the subset only has strict equality.",
    rewrite: "Use `===` / `!==`. To test for both `null` and `undefined`, write both comparisons.",
  },
  NON_NULL_ASSERTION: {
    title: "Non-null assertion `x!`",
    meaning:
      "Node erases `x!` without a check. It is admitted only where it changes no representation (a no-op on a `Value` word); elsewhere it would need a representation change that Node never performs.",
    rewrite: "Narrow explicitly: `if (x !== undefined) { ... }`, or use `x ?? fallback`.",
  },
  AS_ANY: {
    title: "`as any` / `as unknown`",
    meaning: "Casting through `any` or `unknown` escapes the type system.",
    rewrite: "Narrow the value with `typeof`, `instanceof` or a discriminant instead.",
  },
  DELETE: {
    title: "`delete`",
    meaning:
      "Objects have a fixed shape after allocation; removing a property would change it at run time.",
    rewrite: "Model optional presence with an optional field (`x?: T`) or use a `Map`.",
  },
  INDEX_SIGNATURE: {
    title: "Index signatures",
    meaning:
      "`{ [k: string]: T }` describes an object whose keys are only known at run time, which the static shape model cannot lay out.",
    rewrite: "Use `Map<string, T>` for dynamic keys.",
  },
  DECORATOR: {
    title: "Decorators",
    meaning: "Decorators run arbitrary code against classes at definition time.",
    rewrite: "Call the wrapping function explicitly.",
  },
  NAMESPACE: {
    title: "`namespace` / `module` blocks",
    meaning: "TypeScript namespaces create runtime objects; the subset uses ES modules only.",
    rewrite: "Split the code into files and use `import` / `export`.",
  },
  WITH: {
    title: "`with`",
    meaning: "`with` makes name resolution dynamic.",
    rewrite: "Access the properties explicitly.",
  },
  EVAL_OR_FUNCTION_CTOR: {
    title: "`eval` / `new Function`",
    meaning: "There is no interpreter in a compiled binary, so code cannot be created at run time.",
    rewrite: "Write the function directly. Programs that need `eval` should run on Node.",
  },
  VAR: {
    title: "`var`",
    meaning: "`var` hoists to function scope; the subset uses block-scoped bindings only.",
    rewrite: "Use `let` or `const`.",
  },
  REGEX: {
    title: "Regular expressions",
    meaning: "Regex literals and `RegExp` are not in the subset yet.",
    rewrite:
      "Use string methods (`includes`, `indexOf`, `split`, `replace` with a string pattern).",
    planned: true,
  },
  JSON_API: {
    title: "`JSON.parse` form",
    meaning:
      "`JSON.parse` must have a declared target type, because the compiler checks the parsed document against it (and throws on a mismatch). The reviver argument, and targets that mix object types with other kinds in one union, are not supported.",
    rewrite:
      "Annotate the target: `const cfg: Config = JSON.parse(text);`. See [JSON](/guide/json).",
  },
  DATE_API: {
    title: "`Date`",
    meaning:
      "Only `Date.now()` is in the subset; `Date` instances need calendar arithmetic that has not landed.",
    rewrite: "Use `Date.now()` (epoch milliseconds).",
    planned: true,
  },
  STRING_UNICODE_OP: {
    title: "UTF-16 dependent string operation",
    meaning:
      "Strings are stored as UTF-8. Operations whose result depends on UTF-16 code units (`charCodeAt`, `s[i]`, `for...of` over a string, `<` on strings, non-ASCII literals) would diverge from Node for non-ASCII text, so they are gated until the Unicode decision in the plan.",
    rewrite:
      "Use `charAt(i)` or `at(i)`, compare strings with `===`, and keep literals ASCII for now.",
    planned: true,
  },
  PARAM_FORM: {
    title: "Optional or default parameter",
    meaning: "Optional (`x?`) and default (`x = v`) parameters are not supported yet.",
    rewrite:
      "Declare `x: T | undefined` and pass `undefined` explicitly, then apply the default in the body: `const v = x ?? DEFAULT`.",
    planned: true,
  },
  UNINIT_VAR: {
    title: "Declaration without initializer",
    meaning: "`let x: T;` without a value is not supported yet.",
    rewrite: "Initialize at the declaration: `let x: T = initial;`.",
    planned: true,
  },
  STDLIB_STATIC: {
    title: "Unsupported static method",
    meaning:
      "A static on a built-in namespace (`Array.*`, `Number.*`, `Object.*`, `Promise.*`, ...) that is not on the allowlist. The message lists the supported ones.",
    rewrite:
      "Use a supported static or write the loop. The [subset reference](/reference/subset#supported-namespace-statics) lists them.",
    planned: true,
  },
  NUMBER_METHOD: {
    title: "Unsupported number method",
    meaning: "`toFixed`, `toPrecision` and `toExponential` are not supported yet.",
    rewrite:
      "Use `String(n)`, template interpolation, or round first: `Math.round(n * 100) / 100`.",
    planned: true,
  },
  COLLECTION_METHOD: {
    title: "Unsupported `Map` / `Set` operation",
    meaning:
      "A `Map`/`Set` method outside the allowlist (for example `entries`), iterating a `Map` directly with `for...of`, or keeping an iterator from `keys()` / `values()` as a value.",
    rewrite:
      "Iterate keys and read values: `for (const k of m.keys()) { const v = m.get(k); }`, or snapshot with `[...m.keys()]`.",
    planned: true,
  },
  STRING_METHOD: {
    title: "Unsupported string method",
    meaning:
      "A `String.prototype` method outside the allowlist. The message lists the supported ones.",
    rewrite:
      "Use a supported method; the [subset reference](/reference/subset#supported-string-methods) lists them.",
    planned: true,
  },
  ARRAY_METHOD: {
    title: "Unsupported array method",
    meaning:
      "An `Array.prototype` method outside the allowlist. The message lists the supported ones.",
    rewrite:
      "Use a supported method; the [subset reference](/reference/subset#supported-array-methods) lists them.",
    planned: true,
  },
  OBJECT_METHOD: {
    title: "Method call on an unsupported receiver",
    meaning:
      "Calling a method on a value whose type is neither a class instance nor an interface or object type.",
    rewrite: "Call methods on class instances, or on objects typed by an interface or object type.",
  },
  MODULE_FORM: {
    title: "Unsupported module form",
    meaning:
      "An import or export the module system does not support: CommonJS (`require`, `export =`), dynamic `import()`, a package that ships only JavaScript and declarations, a namespace import used as a value, `export * as ns`, or an anonymous default class.",
    rewrite:
      "Use static ESM imports and named or default exports. A package must ship its TypeScript source. See [Modules](/guide/modules).",
  },
  DUPLICATE_CLASS: {
    title: "Duplicate class name",
    meaning: "Reserved for two classes in one program that share a name.",
    rewrite: "Rename one of them.",
    reserved: true,
  },
  TDZ_MODULE_VAR: {
    title: "Module variable read before its declaration runs",
    meaning:
      "A function reads a module-level variable, and code that calls the function runs before the declaration. Node throws `ReferenceError` there (the temporal dead zone).",
    rewrite: "Move the declaration above the code that runs first.",
  },
  ARGV_FORM: {
    title: "`process.argv` form",
    meaning:
      "`argv[0]` and `argv[1]` are the node binary and the script path, which have no equivalent in a compiled binary. Only `process.argv.slice(2)` means the same thing in both.",
    rewrite: "Write `const args = process.argv.slice(2);` and index into `args`.",
  },
  RECURSIVE_TYPE: {
    title: "Recursive type",
    meaning:
      "Reserved for types that refer to themselves. Recursive types such as trees and linked lists compile today.",
    rewrite: "Nothing to rewrite.",
    reserved: true,
  },
  TIMER_ASYNC_CALLBACK: {
    title: "Async timer callback",
    meaning:
      "TypeScript accepts `setTimeout(async () => ...)`, but a rejection inside it would have nothing to await it.",
    rewrite:
      "Make the callback synchronous, or have it call an async function whose promise you handle.",
  },
  FN_DECL_AS_VALUE: {
    title: "Async function used as a value",
    meaning: "An `async function` declaration referenced without calling it.",
    rewrite: "Wrap it: `(x) => f(x)`.",
  },
  UNREPRESENTABLE_TYPE: {
    title: "Type with no representation",
    meaning:
      "A value whose type the value domain cannot represent: a tuple with different element types, an empty `never[]` literal, a union no runtime tag can tell apart (two array types), or a union used as a `Map`/`Set` key.",
    rewrite:
      "Follow the `help:` line: usually an object with named fields, or an explicit element type.",
    planned: true,
  },
  OPAQUE_HANDLE_USE: {
    title: "Opaque handle used as a value",
    meaning:
      "A runtime handle (a timer id, a promise) used as anything but a stored or passed value.",
    rewrite:
      "Only store it, pass it, or give it back to the API that made it (`clearTimeout(id)`).",
  },
  PROPERTY_ADD: {
    title: "Property added at run time",
    meaning:
      "A write that can add a property to an object created without it. Objects keep the shape they were allocated with.",
    rewrite: "Create the object with the property (initialized to `undefined` if needed).",
  },
  LAYOUT_LIMIT: {
    title: "Too many layouts at one site",
    meaning:
      "A spread or `Object.values` that can see objects of too many runtime layouts, or an object made by `JSON.parse` whose key order is only known at run time.",
    rewrite: "Copy the fields you need explicitly: `{ a: src.a, b: src.b }`.",
  },
  METHOD_REPRESENTATION: {
    title: "Method implementations disagree on machine types",
    meaning:
      "A call through an interface where the implementations reachable at run time take or return different machine representations.",
    rewrite: "Give the implementations the same parameter and return types.",
  },
  UNRENDERABLE_VALUE: {
    title: "Value that cannot be printed",
    meaning:
      "`console.log`, `JSON.stringify` or a format directive given a value that can hold something the runtime cannot render the way Node does (for example a promise).",
    rewrite: "Print the fields you need, or await the promise first.",
  },
  VALUE_OPERATION: {
    title: "Operation on an un-narrowed union",
    meaning:
      "An operation such as `x + 1` or `x.length` on a union of different kinds. Printing, `String()`, templates, `===`, `typeof`, `??` and truthiness work on any union; everything else needs one kind.",
    rewrite: 'Narrow first: `if (typeof x === "number") { x + 1 }`.',
  },
  REPRESENTATION_MISMATCH: {
    title: "Representation mismatch",
    meaning:
      "A flow whose nested elements differ in representation, for example passing a `number[]` where a `(number | string)[]` is expected. Both would alias one array, and writes through the wider type would break the narrower one.",
    rewrite:
      "Copy into a new array of the wider type (`[...xs]` with an annotation), or use one element type throughout.",
  },
  STALE_NARROWING: {
    title: "Stale narrowing of a captured variable",
    meaning:
      "A variable that a closure reassigns is read with a narrowed type after a call. The call may have run the closure, so tsc's narrowing can be stale.",
    rewrite: "Copy the value into a `const` before the call and use the copy.",
  },
  GENERIC_TYPE_ARGUMENT: {
    title: "Generic instantiated with a container or function",
    meaning:
      "Generics are compiled once with each type parameter as one self-describing word. An array, map or function type argument does not fit in that word.",
    rewrite:
      "Wrap it in an object (`{ items: xs }`), or write a non-generic function for that type.",
    planned: true,
  },
  TYPE_COMPUTATION: {
    title: "Type-level computation",
    meaning: "Conditional, mapped, indexed-access and `keyof` types are not supported.",
    rewrite: "Write the resulting type out as an interface or a union of literals.",
  },
  CONSTRUCTOR_TYPE: {
    title: "Constructor type",
    meaning: "`new () => T`: generic code cannot construct its type parameter.",
    rewrite: "Pass a factory function instead: `make: () => T`.",
  },
  BUILTIN_AS_VALUE: {
    title: "Built-in function used as a value",
    meaning: "A built-in such as `String`, `Math.floor` or `console.log` passed as a value.",
    rewrite: "Wrap it in an arrow function: `xs.map((x) => String(x))`.",
  },
};

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Rejection fixtures per code, so each entry links to real programs that the suite proves fail
// with exactly that code.
function fixturesByCode(): Map<string, string[]> {
  const root = join(repo, "tests", "fixtures", "reject");
  const out = new Map<string, string[]>();
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir).sort()) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (e.endsWith(".ts")) {
        const head = readFileSync(full, "utf8").split("\n", 10).join("\n");
        const m = /@expect-reject:\s*(CS\d{4})/.exec(head);
        if (m) out.set(m[1]!, [...(out.get(m[1]!) ?? []), relative(repo, full)]);
      }
    }
  };
  walk(root);
  return out;
}

const BLOB = "https://github.com/cs01/ChadScript/blob/main/";

function entry(code: string, e: Entry, fixtures: string[]): string {
  const shown = fixtures.slice(0, 3).map((f) => `[\`${f.split("/").pop()}\`](${BLOB}${f})`);
  const more = fixtures.length > 3 ? ` and ${fixtures.length - 3} more` : "";
  const status = e.reserved
    ? "\n\n**Status:** reserved. No validator rule emits this code today."
    : e.planned
      ? "\n\n**Status:** planned to be admitted in a later phase."
      : "";
  const examples = shown.length > 0 ? `\n\n**Rejection tests:** ${shown.join(", ")}${more}` : "";
  return `## ${code}: ${e.title} {#${code.toLowerCase()}}\n\n${e.meaning}\n\n**Rewrite:** ${e.rewrite}${status}${examples}\n`;
}

export function generateErrorsMarkdown(): string {
  const fixtures = fixturesByCode();
  const rows: [string, Entry][] = [
    ["CS0001", EXTRA["CS0001"]!],
    ...Object.entries(CODE).map(([name, code]): [string, Entry] => {
      const e = EXPLANATIONS[name as keyof typeof CODE];
      return [code, e];
    }),
    ["CS9000", EXTRA["CS9000"]!],
  ];
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  const index = rows.map(([code, e]) => `| [${code}](#${code.toLowerCase()}) | ${e.title} |`);
  return `<!-- GENERATED by docs/scripts/errors.ts from src/validate/codes.ts. Do not edit; run \`bun run docs/scripts/errors.ts\`. -->

# Error reference

Every rejection carries a code, a source span, and a \`help:\` line with a rewrite. This page
explains each code. The list is generated from the validator's code table, so it always matches
the compiler; a test fails if a code is missing here.

\`\`\`text
error[CS1221]: \`toFixed\` on a number is not supported yet
  --> format.ts:2:31
  help: build the string form manually, or use \`.toString()\` / template interpolation
\`\`\`

| Code | Meaning |
| ---- | ------- |
${index.join("\n")}

${rows.map(([code, e]) => entry(code, e, fixtures.get(code) ?? [])).join("\n")}
Next: [CLI](/reference/cli) · [Is ChadScript for you?](/reference/limitations).
`;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const out = join(repo, "docs", "reference", "errors.md");
  writeFileSync(out, generateErrorsMarkdown());
  console.log(`wrote ${out}`);
}
