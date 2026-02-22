// @test expectTestPassed
function testSpawnSync(): void {
  const result = child_process.spawnSync("echo", ["hello"]);
  if (result.stdout !== "hello\n") {
    console.log("FAIL stdout: expected 'hello\\n', got '" + result.stdout + "'");
    process.exit(1);
  }
  if (result.stderr !== "") {
    console.log("FAIL stderr: expected '', got '" + result.stderr + "'");
    process.exit(1);
  }
  if (result.status !== 0) {
    console.log("FAIL status: expected 0");
    process.exit(1);
  }
  console.log("TEST_PASSED");
}
testSpawnSync();
