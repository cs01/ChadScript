// The definition of done, as DATA. `docs/architecture-review-2026-07-22.md` states the stopping
// point in prose, which makes "are we there yet?" a reading rather than a check. This manifest is
// the executable version: each item names the fixtures that PROVE it, and dod.test.ts fails if a
// `done` item cites a fixture that does not exist or is not actually executed by a suite.
//
// The rule that keeps it honest: a `todo`/`deferred` item may cite NO evidence. Adding a fixture
// is therefore not enough to look finished — someone has to flip the status deliberately, and the
// flip fails until the evidence is real and running.
//
// Evidence paths are relative to tests/fixtures/, so `run/x.ts` and `reject/y.ts`. A multi-file
// fixture is named by its entry: `run/modules-basic/main.ts`.

export type DodStatus = "done" | "todo" | "deferred";

export interface DodItem {
  id: string;
  title: string;
  status: DodStatus;
  evidence: string[];
  /** Required on todo/deferred: what is missing, or why it is intentionally out of scope. */
  note?: string;
}

export const DOD: DodItem[] = [
  {
    id: "control-flow",
    title: "scalar control flow (if/else, loops, switch, ternary)",
    status: "done",
    evidence: [
      "run/if-elseif.ts",
      "run/for-basic.ts",
      "run/while-sum.ts",
      "run/loop-break.ts",
      "run/switch-fallthrough.ts",
      "run/ternary-nested.ts",
    ],
  },
  {
    id: "functions-closures",
    title: "functions and closures",
    status: "done",
    evidence: [
      "run/fn-basic.ts",
      "run/fn-recursion.ts",
      "run/fn-mutual.ts",
      "run/closure-capture.ts",
      "run/closure-return-fn.ts",
    ],
  },
  {
    id: "arrays",
    title: "arrays and their admitted methods",
    status: "done",
    evidence: [
      "run/array-basic.ts",
      "run/array-map-filter.ts",
      "run/array-reduce.ts",
      "run/array-sort-comparator.ts",
      "run/array-spread.ts",
    ],
  },
  {
    id: "objects",
    title: "closed-shape objects",
    status: "done",
    evidence: [
      "run/object-basic.ts",
      "run/object-nested.ts",
      "run/object-optional-narrow.ts",
      "run/object-spread.ts",
      "run/destructure-object.ts",
    ],
  },
  {
    id: "classes",
    title: "the class subset (fields, methods, inheritance, instanceof)",
    status: "done",
    evidence: [
      "run/class-basic.ts",
      "run/class-inheritance.ts",
      "run/class-override-chain.ts",
      "run/class-instanceof.ts",
      "run/class-super-method.ts",
    ],
  },
  {
    id: "errors-finally",
    title: "complete errors and finally semantics",
    status: "done",
    evidence: [
      "run/try-catch-recovery.ts",
      "run/try-finally-propagate.ts",
      "run/finally-overrides-abrupt.ts",
      "run/return-through-finally.ts",
      "run/break-continue-through-finally.ts",
      "run/catch-binding.ts",
      "run/throw-terminates.ts",
    ],
  },
  {
    id: "strings",
    title: "strings, ASCII-exact, with an embedded-NUL guarantee",
    status: "done",
    evidence: [
      "run/str-methods-basic.ts",
      "run/str-methods-search.ts",
      "run/str-template-types.ts",
      "run/embedded-nul.ts",
      "run/string-equality-value.ts",
    ],
  },
  {
    id: "collections",
    title: "Map and Set",
    status: "done",
    evidence: [
      "run/map-basic.ts",
      "run/map-iteration.ts",
      "run/map-samevaluezero.ts",
      "run/set-basic.ts",
      "run/set-iteration.ts",
    ],
  },
  {
    id: "stdlib-tier1",
    title: "tier 1 stdlib: console inspection, Math, Number, String/parseInt/parseFloat",
    status: "done",
    evidence: [
      "run/console-inspect-object.ts",
      "run/console-inspect-collections.ts",
      "run/math-minmax-nan.ts",
      "run/number-predicates.ts",
      "run/number-constants.ts",
      "run/global-parseint.ts",
      "run/global-parsefloat.ts",
    ],
  },
  {
    id: "json-stringify",
    title: "JSON.stringify over the admitted value subset",
    status: "done",
    evidence: [
      "run/json-stringify.ts",
      "run/json-stringify-pretty.ts",
      "run/json-stringify-optional.ts",
    ],
  },
  {
    id: "json-parse-typed",
    title: "typed JSON.parse with runtime shape validation",
    status: "done",
    evidence: [
      "run/json-parse-scalars.ts",
      "run/json-parse-nested.ts",
      "run/json-parse-roundtrip.ts",
      "reject/json-parse-unannotated.ts",
      "reject/json-parse-reviver.ts",
    ],
    note: "Spelled `const x: Shape = JSON.parse(text)` rather than `JSON.parse<Shape>(text)`: lib's signature takes no type argument, and redeclaring the JSON global would collide. The annotation IS the target, so `any` never enters the type domain. DELIBERATE DIVERGENCE: for JSON that parses but does not match the target, Node returns the wrong-shaped object and we throw — there is no oracle to agree with, so those cases are pinned by tests/json-parse-runtime.test.ts (automatic, just not differential) while valid input stays fully differential. Malformed input and non-ASCII are there for the same reason.",
  },
  {
    id: "modules-esm",
    title: "static local ESM modules",
    status: "done",
    evidence: ["run/modules-basic/main.ts"],
  },
  {
    id: "process-argv",
    title: "process.argv.slice(2)",
    status: "done",
    evidence: ["run/process-argv.ts"],
  },
  {
    id: "fs-sync-text",
    title: "synchronous text node:fs",
    status: "done",
    evidence: ["run/node-fs-sync.ts", "run/node-fs-missing-throws.ts"],
  },
  {
    id: "path-posix",
    title: "node:path, POSIX subset",
    status: "done",
    evidence: [
      "run/path-join.ts",
      "run/path-normalize.ts",
      "run/path-accessors.ts",
      "run/path-resolve.ts",
      "reject/path-namespace-import.ts",
      "reject/path-unsupported-export.ts",
    ],
  },
  {
    id: "async-await",
    title: "async functions and await",
    status: "done",
    evidence: [
      "run/async-basic.ts",
      "run/async-ordering.ts",
      "run/async-multi-await.ts",
      "run/async-try-catch.ts",
      "run/async-promise-all.ts",
      "run/async-unhandled-reject.ts",
      "run/async-concurrent.ts",
    ],
  },
  {
    id: "timers",
    title: "setTimeout",
    status: "done",
    evidence: [
      "run/timer-ordering.ts",
      "run/timer-nested.ts",
      "run/timer-async-interleave.ts",
      "run/timer-callback-forms.ts",
      "reject/timer-async-callback.ts",
      "reject/timer-cleartimeout.ts",
    ],
    note: "SCOPED DOWN from the review's bare 'timers'. setInterval and timer-vs-microtask starvation ordering are explicitly out — they are the unbounded part, and every other item on this list is bounded. clearTimeout is its own item below.",
  },
  {
    id: "cleartimeout",
    title: "clearTimeout",
    status: "todo",
    evidence: [],
    note: "needs an OPAQUE handle type: Node's setTimeout returns a Timeout object, so any printable stand-in diverges the moment a program logs it. The value domain has no opaque variant, so setTimeout returns void for now and clearTimeout is undeclared (CS0001).",
  },
  {
    id: "fn-decl-as-value",
    title: "references to declared functions as first-class values",
    status: "todo",
    evidence: [],
    note: "`const f = named` / `arr.map(named)` reached ice(\'reference to unbound variable\') because function declarations live outside the variable scope map. Now rejected as CS1232 (reject/fn-decl-as-value.ts) rather than ICEing. Arrow functions in variables already work, so this is a completeness gap, not a blocker.",
  },
  {
    id: "fs-promises",
    title: "a narrow node:fs/promises surface",
    status: "todo",
    evidence: [],
    note: "the review gates this behind a correct async scheduler; async-await is done, so this is unblocked.",
  },
  {
    id: "rejection-boundary",
    title: "precise compile-time rejection for everything outside the subset",
    status: "done",
    evidence: [
      "reject/any-annotation.ts",
      "reject/as-any.ts",
      "reject/date-new.ts",
      "reject/closure-mutable-capture.ts",
      "reject/const-reassign.ts",
    ],
    note: "default-DENY by SyntaxKind; admission-ice.test.ts additionally proves admitted constructs reach a diagnostic rather than an ICE.",
  },
];
