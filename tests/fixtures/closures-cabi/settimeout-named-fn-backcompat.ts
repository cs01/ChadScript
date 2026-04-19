// @test-description: setTimeout with classic named function reference still works (tramp handle = -1)
// Back-compat smoke — the timer wrapper falls through to the bare-fn-ptr
// path when tramp handle is -1, so named function references behave exactly
// as they did pre-PR3.
let fired: number = 0;

function onTick(): void {
  fired = 1;
}

setTimeout(onTick, 10);
runEventLoop();

if (fired === 1) {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL: fired=" + fired);
}
