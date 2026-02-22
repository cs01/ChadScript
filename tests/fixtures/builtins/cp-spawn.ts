// @test expectTestPassed
let collected = "";

function onStdout(data: string): void {
  collected = collected + data;
}

function onStderr(data: string): void {
  // ignore stderr for this test
}

function onExit(code: number): void {
  if (collected === "hello\n" && code === 0) {
    console.log("TEST_PASSED");
  } else {
    console.log("FAIL: collected='" + collected + "' code=" + code);
  }
}

child_process.spawn("echo", ["hello"], onStdout, onStderr, onExit);
// Must run the event loop to process spawn callbacks
runEventLoop();
