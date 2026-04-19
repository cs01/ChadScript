// @test expectTestPassed
// Regression for dapweb NOTES #14: new Promise((resolve, reject) => {...})
// executor was never invoked — codegen dropped args[0]. Now inlines the
// body and routes resolve/reject calls to the @__Promise_resolve /
// @__Promise_reject bridges directly.
async function main(): Promise<void> {
  const p: Promise<string> = new Promise<string>((resolve, reject) => {
    resolve("ok");
  });
  const v = await p;
  if (v === "ok") console.log("TEST_PASSED");
}
main();
runEventLoop();
