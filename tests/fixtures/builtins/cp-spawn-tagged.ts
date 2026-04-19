// @test expectTestPassed
// Verifies spawnTagged — callbacks receive a per-session tag as first arg,
// enabling multi-session demux without module-level state juggling.
let got: string = "";

function onOut(tag: string, data: string): void {
  got = got + tag + ":" + data;
}
function onErr(tag: string, data: string): void {}
function onExit(tag: string, code: number): void {
  if (got === "s1:hello\n" && code === 0) {
    console.log("TEST_PASSED");
  } else {
    console.log("FAIL: got='" + got + "' code=" + code);
  }
}

child_process.spawnTagged("s1", "echo", ["hello"], onOut, onErr, onExit);
runEventLoop();
