// @test expectTestPassed
async function testExecAsync(): Promise<void> {
  const result = await child_process.exec("echo hello");
  if (result.stdout !== "hello\n") {
    console.log("FAIL stdout: expected 'hello\\n', got '" + result.stdout + "'");
    process.exit(1);
  }
  if (result.status !== 0) {
    console.log("FAIL status: expected 0");
    process.exit(1);
  }
  console.log("TEST_PASSED");
}
testExecAsync();
