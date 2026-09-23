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

## Value model

Representation belongs to the value, not only to the static type, because TypeScript is
structural: a `{ y, x }` object can be passed where `{ x }` is expected.

- **Primitives are unboxed.** `number` is a `double`, `boolean` an `i1`, `string` a UTF-8
  `{ptr, len}` pair.
- **Shaped objects.** Every object starts with a pointer to an immutable runtime shape: field
  names to slots, method names to functions, class name, and per-shape print and JSON functions.
  Class instances and object literals share this model. Shapes never change after allocation,
  because the subset forbids adding and deleting properties.
- **Static slots where possible, inline caches otherwise.** The program is compiled whole, so for
  each static type the compiler knows every allocation layout that can reach it. If they all put
  `x` at the same slot, `p.x` is one load. Otherwise the site gets an inline cache: compare the
  shape pointer, load; on a miss, look the field up by name in the shape.
- **`Value` words for mixed unions.** A union of different representations, a type parameter or
  `unknown` is one 64-bit word: numbers offset by 2^49, pointers stored raw with a 3-bit tag,
  `undefined` as 0. Boxing and unboxing are explicit HIR nodes. Narrowing is a tag test.
- **Generics by erasure.** A generic declaration compiles once, with its type parameters as
  `Value` words. Calls convert at the boundary.
- **Mutable captures live in heap cells** shared by the frame and its closures.

## Runtime in Milo

The runtime (`runtime/*.milo`) is written in [Milo](https://github.com/milo-language/milo), a
systems language that compiles to LLVM IR. It provides strings and number formatting (JS-exact),
shapes and inline-cache misses, `Map`/`Set`, `util.inspect`-compatible printing, JSON, `fs` and
`path`, exceptions, and the async machinery: fibers on `ucontext`, a microtask queue, timers and
an I/O loop, and the garbage collector. What Milo cannot express (a few C macros and platform-specific structures) lives in
`runtime/residue.c`, about 20 lines of code, each item commented with why.

The compiler commit is pinned in `scripts/milo-pin.sh`. The driver runs `milo emit-ir` on
`runtime/lib.milo`, compiles it with the same clang and flags as the program, and caches the
object by content hash.

## Memory

The runtime has its own garbage collector, written in Milo (`runtime/gc.milo`); there is no GC
library to install or link. Its design, from [the plan](https://github.com/cs01/ChadScript/blob/main/PLAN.md#memory-our-own-gc-in-milo-phase-6-done):

- **Conservative roots, precise heap.** Registers, the running stack, every suspended fiber
  stack and the program's writable data segment are scanned conservatively, because Milo frames
  carry no stack maps. Heap objects are traced precisely: every object has a header word naming
  its layout (atomic, values, record, struct with a pointer bitmap, or conservative), and marking
  follows exactly the pointer slots the layout names. Numbers and booleans are never traced.
- **Immix-style allocation.** 32 KB blocks of 128-byte lines inside 1 MB chunks, with a
  bump-pointer fast path inlined into generated code and lazy sweeping of free lines. Objects
  over 8 KB go to a large-object space. The collector does not move objects.
- **Policy.** Collect when the bytes allocated since the last collection exceed twice the live
  heap (at least 1 MB).
- **Gates.** `CHAD_GC_STRESS=N` collects before every Nth allocation and runs over the whole
  differential suite in CI; `CHAD_GC_VERIFY=1` poisons freed lines and checks traced slots; under
  AddressSanitizer freed lines are poisoned, so a read of a collected object is reported.

Not yet: evacuation or compaction, returning memory to the OS, a generational nursery.

## Testing

Correctness is defined by Node, never by the compiler's own expectations.

- **Differential suite** (`tests/fixtures/run/`, plus `examples/` and every sample on this site):
  each program runs under Node and as a native binary at `-O0` and at `-O2`. stdout and the exit
  code must match exactly; a crash or hang is always a failure. The emitted IR must also pass
  `opt -passes=verify`. An `-O0`/`-O2` mismatch means undefined behavior in the generated code.
- **Rejection suite** (`tests/fixtures/reject/`): each file names the `CS####` code it must fail
  with. Every validator rule has at least one.
- **Known bugs** are fixtures marked `@known-bug`: they must keep diverging from Node, so a fix
  cannot land unnoticed and a bug cannot be forgotten.
- **Seeded fuzzers** generate programs inside the subset and diff them against Node: expressions
  and control flow, structural subtyping (reordered and extra fields across interfaces, literals
  and classes), unions, closures with generics, and `console.log` formatting.
- **Sanitized lane**: the whole suite again with the runtime and every program built under
  AddressSanitizer and UndefinedBehaviorSanitizer.
- **GC stress lane**: the differential suite with a collection forced every few allocations, so
  a missed root or a wrong layout shows up as a divergence.
- **Architecture tests**: only `src/lower` may import TypeScript, the runtime's struct layouts
  match the IR builder's view of them, file-size ratchets, and the generated docs match their
  sources.

The fast lane (`bun run test`) stays under ten seconds; the slow lanes run in the background and
in CI on Linux and macOS.
