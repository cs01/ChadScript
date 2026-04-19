// @test-description: setInterval with arrow closure increments class-field counter, clearInterval stops it
// The arrow captures `t` (class-instance pointer) by value — field writes
// on the pointed-to object are visible outside the arrow, proving the
// trampoline correctly routes env on every libuv fire.
// The timer id is held in a local const (not a class field) because the
// closure-mutation-checker blocks reassigning an outer let.
class Ticker {
  n: number = 0;
}

const t = new Ticker();

const id: string = setInterval(() => {
  t.n = t.n + 1;
}, 5);

setTimeout(() => {
  clearInterval(id);
}, 30);

runEventLoop();

if (t.n >= 3) {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL: n=" + t.n);
}
