// @test expectTestPassed
// Bare execSync() (not namespaced) should also work via the C bridge
function testBareExecSync(): void {
  const result = execSync("echo bare");
  if (result === "bare") {
    console.log("TEST_PASSED");
  } else {
    console.log("FAIL: expected 'bare', got '" + result + "'");
    process.exit(1);
  }
}
testBareExecSync();
