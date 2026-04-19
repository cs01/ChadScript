// @test expectTestPassed
// Regression for dapweb NOTES #16: calling an async function without
// await as a bare expression statement (fire-and-forget) used to error
// "async function 'X()' called without await". The concern — misusing
// the Promise pointer as a string/number — only applies when the result
// is CONSUMED. Discarded at statement level it's a valid fire-and-forget
// and the Promise is GC'd when no awaiters remain.
async function later(): Promise<void> {}
async function main(): Promise<void> {
  later(); // ← fire-and-forget, should compile
  console.log("TEST_PASSED");
}
main();
runEventLoop();
