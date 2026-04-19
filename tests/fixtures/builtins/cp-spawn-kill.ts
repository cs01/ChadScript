// @test expectTestPassed
let handle: string = "";

function onStdout(data: string): void {}
function onStderr(data: string): void {}

function onExit(code: number): void {
  // killed by signal → non-zero exit (libuv reports signal in term_signal;
  // we only forward exit_status here, which for signal-killed procs is typically 0
  // or the signal number depending on OS). Just assert onExit fires.
  console.log("TEST_PASSED");
}

handle = child_process.spawn("sleep", ["30"], onStdout, onStderr, onExit);
child_process.kill(handle, 15);
runEventLoop();
