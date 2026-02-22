// @test expectTestPassed
function testExecSync(): void {
  const result = child_process.execSync("echo hello");
  if (result === "hello") {
    console.log("TEST_PASSED");
  } else {
    console.log("FAIL: expected 'hello', got '" + result + "'");
    process.exit(1);
  }
}
testExecSync();
