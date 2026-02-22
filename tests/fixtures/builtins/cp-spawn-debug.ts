// Debug test for spawn
function onOut(data: string): void {
  console.log("GOT STDOUT: " + data);
}

function onErr(data: string): void {
  console.log("GOT STDERR: " + data);
}

function onDone(code: number): void {
  console.log("GOT EXIT: " + code);
}

console.log("Before spawn");
child_process.spawn("echo hello", onOut, onErr, onDone);
console.log("After spawn, running event loop");
runEventLoop();
console.log("Event loop done");
