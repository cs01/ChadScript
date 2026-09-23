# Memory and the garbage collector

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

## The runtime it lives in

The runtime (`runtime/*.milo`) is written in [Milo](https://github.com/milo-language/milo), a
systems language that compiles to LLVM IR. It provides strings and number formatting (JS-exact),
shapes and inline-cache misses, `Map`/`Set`, `util.inspect`-compatible printing, JSON, `fs` and
`path`, exceptions, and the async machinery: fibers on `ucontext`, a microtask queue, timers and
an I/O loop, and the garbage collector. What Milo cannot express (a few C macros and platform-specific structures) lives in
`runtime/residue.c`, about 20 lines of code, each item commented with why.

The compiler commit is pinned in `scripts/milo-pin.sh`. The driver runs `milo emit-ir` on
`runtime/lib.milo`, compiles it with the same clang and flags as the program, and caches the
object by content hash.

Next: [Testing philosophy](/internals/testing).
