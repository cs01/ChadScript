// @test-description: child_process.spawn with classic named-function callbacks still works (tramp handle = -1)
// Back-compat smoke — the bridge falls through to the bare-fn-ptr path
// when tramp handle is -1, so named function references behave exactly as
// they did pre-PR2.
let collected: string = "";

function onStdout(data: string): void {
  collected = collected + data;
}
function onStderr(data: string): void {}
function onExit(code: number): void {
  if (collected === "back\n" && code === 0) {
    console.log("TEST_PASSED");
  } else {
    console.log("FAIL: collected='" + collected + "' code=" + code);
  }
}

child_process.spawn("echo", ["back"], onStdout, onStderr, onExit);
runEventLoop();
