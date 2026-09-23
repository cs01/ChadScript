<script setup>
import { data as stats } from "../stats.data";
</script>

# Testing philosophy

Correctness is defined by Node, never by the compiler's own expectations. A test never asserts
"the compiler printed what we think it should"; it asserts "the binary printed what Node printed".

Counted from the repository when this page was built: **{{ stats.differential }}** programs
checked against Node at `-O0` and `-O2` (test fixtures, `examples/` and every sample on this
site), **{{ stats.rejections }}** programs that must be rejected with a specific code,
**{{ stats.fuzzers }}** seeded fuzzers, **{{ stats.codes }}** documented error codes, and
**{{ stats.knownBugs }}** known bugs recorded as tests (listed on the
[limitations page](/reference/limitations)).

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

## Found a divergence?

A program that compiles but behaves differently from Node is treated as a P0 bug, never as a
known quirk. Please [report it](https://github.com/cs01/ChadScript/issues/new?title=divergence%3A+)
with the program, Node's output and the binary's output. It becomes a `@known-bug` fixture first,
then the fix.

Next: [Benchmarks](/benchmarks).
