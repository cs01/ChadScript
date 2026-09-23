# How it works

The compiler is TypeScript, runs on bun, and never compiles itself. It is a straight pipeline;
each stage has one job and hands the next a fully checked result.

```text
.ts tree ──tsc (types, resolution)──▶ validate (default-deny) ──▶ lower ──▶ HIR (typed)
        ──▶ verifyHir ──▶ codegen ──▶ typed IR builder ──▶ clang ──▶ binary + runtime
```

| Stage      | Source         | Job                                                                                                                                                                                |
| ---------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| frontend   | `src/frontend` | Builds a tsc program from the entry file and its imports, with the strict options forced on. Any tsc diagnostic stops here (CS0001).                                               |
| validate   | `src/validate` | Walks every node and type. Admits only what an allowlist rule covers; everything else becomes a `CS####` diagnostic with a span and a rewrite.                                     |
| lower      | `src/lower`    | The **only** code that talks to tsc. Turns the checked AST into HIR, where every expression carries a resolved value type. A test enforces that nothing else imports `typescript`. |
| verifyHir  | `src/hir`      | Checks the HIR's invariants (types present, boxing explicit, representations consistent) before any IR exists.                                                                     |
| codegen    | `src/codegen`  | HIR to LLVM IR. It never infers anything: a missing fact is an internal compiler error, never a guess.                                                                             |
| IR builder | `src/ir`       | Typed values and basic blocks with exactly one terminator. Raw IR text is not allowed anywhere else.                                                                               |
| driver     | `src/driver`   | Compiles the runtime once (cached by content hash), then links it with the program through clang.                                                                                  |

## Why tsc is the type oracle

Earlier attempts inferred types during code generation, and every fix destabilized something
else. Here, tsc decides every type; the compiler only chooses how to represent values of that
type. If tsc cannot type something precisely (for example `any`), the program is rejected rather
than guessed at.

## Where to go next

- [Value model](/internals/value-model): shapes, inline caches and `Value` words.
- [Memory](/internals/memory): the garbage collector and the Milo runtime.
- [Testing philosophy](/internals/testing): why Node is the oracle, and what each test lane proves.
