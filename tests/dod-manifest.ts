// The definition of done, as DATA. PLAN.md lists the phases in prose, which makes "are we there
// yet?" a reading rather than a check. This manifest is
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
      "run/path-namespace-import.ts",
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
    ],
    note: "SCOPED DOWN from the review's bare 'timers'. setInterval and timer-vs-microtask starvation ordering are explicitly out — they are the unbounded part, and every other item on this list is bounded. clearTimeout is its own item below.",
  },
  {
    id: "cleartimeout",
    title: "clearTimeout, with an opaque handle type",
    status: "done",
    evidence: [
      "run/timer-clear.ts",
      "reject/timer-handle-printed.ts",
      "reject/timer-handle-stringified.ts",
      "reject/timer-handle-interpolated.ts",
    ],
    note: "Added an `opaque` variant to the value domain: a pointer the program may store and hand back, with no other operations. Node's setTimeout returns a Timeout OBJECT, so any printable stand-in would diverge the first time a program logged it — CS1234 rejects printing, serializing, or interpolating one instead. Cancellation marks a tombstone rather than unlinking, so clearing twice (or clearing an already-fired timer) is trivially a no-op, as in Node.",
  },
  {
    id: "fn-decl-as-value",
    title: "references to declared functions as first-class values",
    status: "done",
    evidence: [
      "run/fn-ref-basic.ts",
      "run/fn-ref-higher-order.ts",
      "run/paren-type.ts",
      "reject/fn-ref-async.ts",
    ],
    note: "Lowering wraps a declared function in a forwarding lambda whose hidden `env` parameter makes it a valid closure record, so no codegen changes were needed. ASYNC declarations stay rejected (CS1232): a call to one must spawn a fiber and yield a promise, and a forwarding wrapper would run the body synchronously — right type, wrong semantics.",
  },
  {
    id: "mixed-union-ice",
    title: "mixed-representation unions reach a diagnostic rather than an ICE",
    status: "done",
    evidence: [
      "run/unions/mixed-union-conditional.ts",
      "run/unions/mixed-union-annotation.ts",
      "run/unions/mixed-union-param.ts",
      "reject/union-ambiguous-arrays.ts",
    ],
    note: "Phase 4 compiles mixed-representation unions as Value words, so these former CS1233 rejections run; CS1233 remains for a union no Value can represent (two array types, whose tags are identical but whose element representations differ). Type-level default-deny (CS1233), complementing the syntax-level ALLOWED_KINDS: syntax admits `cond ? a : b` but says nothing about whether the union of its arms has a runtime representation. The predicate is NOT reimplemented in the validator — it calls the real translator and catches UnrepresentableTypeError, so validator and lowerer cannot disagree about what is representable. Checked both at value nodes (inferred unions) and at written UnionType nodes (declared ones, where the type at the declaration is the narrowed initializer type instead).",
  },
  {
    id: "fs-promises",
    title: "a narrow node:fs/promises surface",
    status: "done",
    evidence: [
      "run/fs-promises-basic.ts",
      "run/fs-promises-ordering.ts",
      "reject/fs-promises-unsupported-export.ts",
      "run/fs-promises-namespace-import.ts",
    ],
    note: "readFile/writeFile/appendFile/unlink. The syscall runs synchronously at call time and only the SETTLEMENT is deferred, onto an I/O queue the loop drains after any already-due timers — blocking is not observable in output, only ordering is, and this keeps the phase model (microtasks, due timers, I/O) matching Node's. Failures reject rather than throwing synchronously. Racing a timer against a read is NOT fixtured: that ordering is genuinely nondeterministic in Node too, so there would be no oracle to agree with.",
  },
  {
    id: "rejection-boundary",
    title: "precise compile-time rejection for everything outside the subset",
    status: "done",
    evidence: [
      "reject/any-annotation.ts",
      "reject/as-any.ts",
      "reject/date-new.ts",
      "reject/stale-narrowing.ts",
      "reject/const-reassign.ts",
    ],
    note: "default-DENY by SyntaxKind; admission-ice.test.ts additionally proves admitted constructs reach a diagnostic rather than an ICE.",
  },
  // PLAN.md phases 1-7. Targets are recorded as @known-bug fixtures under run/value-model/ and
  // the KNOWN_BUG flag in slow/subtype-fuzz.test.ts; a phase closes by removing those markers
  // and citing the fixtures here.
  {
    id: "modules",
    title: "phase 1: full ESM surface (default/namespace imports, re-exports, TS-source packages)",
    status: "done",
    evidence: [
      "run/modules-basic/main.ts",
      "run/modules-specifiers/main.ts",
      "run/modules-default/main.ts",
      "run/modules-reexport/main.ts",
      "run/modules-namespace/main.ts",
      "run/modules-scoping/main.ts",
      "run/modules-package/main.ts",
      "run/modules-type-only/main.ts",
      "run/node-fs-namespace-import.ts",
      "run/path-namespace-import.ts",
      "run/fs-promises-namespace-import.ts",
      "reject/module-cycle/main.ts",
      "reject/module-namespace-value/main.ts",
      "reject/module-dts-package/main.ts",
      "reject/module-js-package/main.ts",
      "reject/module-require.ts",
      "reject/module-exports-cjs.ts",
      "reject/module-dynamic-import.ts",
    ],
  },
  {
    id: "runtime-milo",
    title: "phase 2: runtime ported from C to Milo, C residue under 100 lines",
    status: "done",
    // One or more differential fixtures per ported module (runtime/<module>.milo in comments).
    evidence: [
      "run/path-normalize.ts", // path
      "run/path-resolve.ts", // path (getcwd)
      "run/math-round.ts", // math
      "run/math-minmax-nan.ts", // math
      "run/date-now.ts", // time
      "run/process-argv.ts", // argv
      "run/array-shift.ts", // array
      "run/array-at.ts", // array + nullable
      "run/string-substring-pad.ts", // string-methods
      "run/string-replaceall-trim.ts", // string-methods
      "run/number-tostring.ts", // number (dtoa, radix)
      "run/console-inspect-object.ts", // strings (inspect) + print
      "run/map-samevaluezero.ts", // hashkey + map
      "run/set-from-array.ts", // set
      "run/json-stringify.ts", // json
      "run/json-parse-nested.ts", // json-parse
      "run/fs-promises-basic.ts", // fs + fs-promises
      "run/timer-ordering.ts", // timer
      "run/try-finally-propagate.ts", // errors (exceptions)
      "run/throw-terminates.ts", // errors (uncaught)
      "run/async-promise-all.ts", // async
      "run/async-unhandled-reject.ts", // async
    ],
    note: "C residue: runtime/residue.c (GC_INIT, marker globals, stdio handles, jmp_buf size, ucontext setup)",
  },
  {
    id: "shaped-objects",
    title: "phase 3: shaped objects, static field ordering, inline caches",
    status: "done",
    // Every record points at its runtime shape and stores NaN-boxed Values; access sites are
    // static slots when every reaching layout agrees, inline caches otherwise. The structural
    // subtyping fuzzer (tests/slow/subtype-fuzz.test.ts, KNOWN_BUG = false) is the other gate.
    evidence: [
      "run/value-model/subtype-extra-field.ts",
      "run/value-model/subtype-class-and-literal.ts",
      "run/value-model/subtype-reordered-alias.ts",
      "run/value-model/optional-field-through-map.ts",
      "run/value-model/interface-method-call.ts",
      "run/value-model/interface-dispatch-mixed.ts",
      "run/value-model/shape-print-through-interface.ts",
      "run/value-model/spread-subtype-source.ts",
      "run/value-model/discriminated-union.ts",
      "run/value-model/object-union-members.ts",
      "run/value-model/json-parse-key-order.ts",
      "run/value-model/json-parse-dynamic-layout.ts",
      "run/value-model/json-parse-nested-layout.ts",
      "run/object-method-call.ts",
      "reject/property-add.ts",
      "reject/spread-layout-limit.ts",
      "reject/method-representation-mismatch.ts",
      "reject/json-parse-spread.ts",
      "reject/json-parse-optional-write.ts",
    ],
  },
  {
    id: "value-unions",
    title: "phase 4: NaN-boxed Value, mixed unions, narrowing",
    status: "done",
    evidence: [
      "run/value-model/mixed-union.ts",
      "run/unions/locals-params-returns.ts",
      "run/unions/equality-and-strings.ts",
      "run/unions/printing-and-closures.ts",
      "run/unions/arrays-and-maps.ts",
      "run/unions/fields-and-narrowing.ts",
      "run/unions/field-write-widens.ts",
      "run/unions/json-parse-union-fields.ts",
      "run/unions/fuzz-finds.ts",
      "run/json-parse-undeclared-keys.ts",
      "reject/union-for-of.ts",
      "reject/union-member-access.ts",
      "reject/array-covariance-representation.ts",
      "reject/union-ambiguous-arrays.ts",
      "reject/union-map-key.ts",
    ],
    note: "A union whose members have different representations is ValueType `value`: one Value word (src/codegen/value.ts) in locals, params, returns, array elements, Map values and fields. Every representation change is an explicit box/unbox HIR node that verifyHir checks at both ends, and every slot a value lands in is checked for a missing one. Narrowing is tsc's: lower reads the narrowed type at each use and unboxes there; typeof/Array.isArray/instanceof/===/truthiness compile to tag tests. Un-narrowed operations beyond printing, String(), templates, ===, typeof, truthiness and ?? are CS1239; flows whose nested elements differ in representation (array covariance) are CS1240; CS1233 remains for unions no Value can represent (two array types). JSON.parse keeps undeclared keys as Value words. Seeded union fuzzer: tests/slow/union-fuzz.test.ts.",
  },
  {
    id: "captures-generics",
    title: "phase 5: heap-cell mutable captures, erased generics",
    status: "done",
    evidence: [
      "run/value-model/mutable-capture.ts",
      "run/value-model/generic-function.ts",
      "run/closure-mutable-capture.ts",
      "run/closures/counter-factory.ts",
      "run/closures/loop-bindings.ts",
      "run/closures/shared-cells.ts",
      "run/closures/async-capture.ts",
      "run/closures/update-value.ts",
      "run/generics/helpers.ts",
      "run/generics/stack.ts",
      "run/generics/constrained.ts",
      "run/generics/through-interface.ts",
      "run/generics/arrays.ts",
      "run/generics/closures.ts",
      "reject/generic-function-identity.ts",
      "reject/generic-subclass-field.ts",
      "run/array-includes-nan.ts",
      "reject/stale-narrowing.ts",
      "reject/generic-array-alias.ts",
      "reject/generic-returned-alias.ts",
      "reject/generic-container-type-arg.ts",
      "reject/generic-field-container.ts",
      "reject/generic-constructor-type.ts",
      "reject/generic-conditional-type.ts",
      "reject/generic-keyof.ts",
      "reject/update-field-value.ts",
    ],
    note: "A local captured by a closure AND reassigned anywhere lives in a GC heap cell (lower/cells.ts): the frame keeps the cell pointer in a stack slot, closures capture the pointer (HCapture.byRef); everything else is still captured by value and compiles to the same IR as before. `for (let ...)` header bindings that are cells move to a fresh cell before the first test and before each update (CreatePerIterationEnvironment); a cell `for...of` binding or body `let` gets a new cell per iteration. CS1219 is retired; CS1241 rejects a narrowed read of a multi-representation cell after a call that may have run the reassigning closure (tsc keeps such narrowings). Generics are erased: a type parameter is VALUE_ANY (a Value word of a self-describing value) or its constraint's representation; one body per declaration. Call boundaries (lower/generics.ts, shared by validate and lower) compare the declaration's erased signature with the call's resolved one: box/unbox scalars, build array-literal arguments in Value slots, adapt closures (adaptClosure), copy a returned array only when the callee built it (convertArray); CS1242 rejects non-self-describing type arguments, CS1240 container crossings whose copy would be observable, CS1243 conditional/mapped/indexed/keyof types, CS1244 constructor types. Generic layouts reach by instantiation (classes) or by member names (literals). `x!` is admitted word to word. Seeded closures+generics fuzzer: tests/slow/closure-fuzz.test.ts.",
  },
  {
    id: "precise-gc",
    title: "phase 6: precise GC in Milo, libgc dropped",
    status: "todo",
    evidence: [],
    note: "after the value model; gated by a collect-every-allocation stress lane",
  },
];
