// @test-description: trampoline bridge alloc/get/free round-trip — PR1 wiring smoke
// PR1: proves trampoline-bridge.o is linked and cs_tramp_alloc/get/free
// round-trip correctly. No closures yet — PR2 wires these to cs_spawn.
// The `_d` suffix shims wrap the int32 API for ChadScript's double-based
// `number` ABI — codegen-emitted call sites will use the int32 entry points.
declare function cs_tramp_alloc_d(env: string): number;
declare function cs_tramp_get_d(handle: number): string;
declare function cs_tramp_free_d(handle: number): void;

const h = cs_tramp_alloc_d("hello");
if (h < 0) {
  console.log("FAIL: alloc returned " + h.toString());
} else {
  const got = cs_tramp_get_d(h);
  cs_tramp_free_d(h);
  if (got === "hello") {
    console.log("TEST_PASSED");
  } else {
    console.log("FAIL: got " + got);
  }
}
