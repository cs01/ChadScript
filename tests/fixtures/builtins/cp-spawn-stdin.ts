// @test expectTestPassed
let collected = "";
let handle: string = "";

function onStdout(data: string): void {
  collected = collected + data;
}

function onStderr(data: string): void {}

function onExit(code: number): void {
  if (collected === "hello world\n" && code === 0) {
    console.log("TEST_PASSED");
  } else {
    console.log("FAIL: collected='" + collected + "' code=" + code);
  }
}

handle = child_process.spawn("cat", [], onStdout, onStderr, onExit);
child_process.writeStdin(handle, "hello world\n");
child_process.endStdin(handle);
runEventLoop();
