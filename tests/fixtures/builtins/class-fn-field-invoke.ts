// @test expectTestPassed
// obj.fn(args) where fn is a function-typed class field (not a method) —
// previously errored "Method ${fn} not found in class ${C}" at compile time,
// forcing users to write `callHandler(obj.fn, ...args)` manually. Now the
// dispatcher recognizes function-typed fields and lowers directly.
function onNum(n: number): void {
  if (n === 42) console.log("TEST_PASSED");
}
class S {
  onEvent: ((n: number) => void) | null = null;
}
const s = new S();
s.onEvent = onNum;
if (s.onEvent !== null) {
  s.onEvent(42);
}
