// @test expectTestPassed
// spawnSync with no args array runs through /bin/sh -c (shell mode)
function testSpawnSyncShell(): void {
  const result = child_process.spawnSync("echo hello && echo world");
  if (result.stdout !== "hello\nworld\n") {
    console.log("FAIL stdout: got '" + result.stdout + "'");
    process.exit(1);
  }
  if (result.status !== 0) {
    console.log("FAIL status: expected 0");
    process.exit(1);
  }
  console.log("TEST_PASSED");
}
testSpawnSyncShell();
