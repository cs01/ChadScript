// @test expectTestPassed
// Regression for dapweb NOTES #14 stash pattern: Promise.deferred<T>()
// returns a promise handle that can be stored (Map, class field, whatever)
// and settled later via Promise.resolvePending / rejectPending from a
// completely separate scope — no closures required.
async function main(): Promise<void> {
  const pending: Map<string, Promise<string>> = new Map();
  const d = Promise.deferred<string>();
  pending.set("req-1", d);

  // Simulate a later callback (e.g. stdout parser) resolving the stashed
  // promise from an unrelated scope.
  const stashed = pending.get("req-1");
  Promise.resolvePending(stashed, "hello world");

  const v = await d;
  if (v === "hello world") console.log("TEST_PASSED");
}
main();
runEventLoop();
