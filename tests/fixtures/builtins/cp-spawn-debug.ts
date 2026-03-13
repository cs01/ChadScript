let gotOutput = false;
let gotExit = false;

function onOut(data: string): void {
  if (data.indexOf("hello") !== -1) {
    gotOutput = true;
  }
}

function onErr(data: string): void {}

function onDone(code: number): void {
  gotExit = true;
}

child_process.spawn("echo hello", onOut, onErr, onDone);
runEventLoop();

if (gotOutput && gotExit) {
  console.log("TEST_PASSED");
}
