// @test expectTestPassed
// Regression for dapweb note #11: spawn() returns i8* handle; storing it
// into a `handle: string` class field previously emitted a spurious
// `inttoptr i32 %h to i8*` because spawn's return temp had no tracked
// LLVM type, making assignment-generator treat it as an integer RHS.
function onOut(d: string): void {}
function onErr(d: string): void {}
function onExit(c: number): void {}
class SessionState {
  handle: string = "";
}
const s = new SessionState();
s.handle = child_process.spawn("echo", ["hi"], onOut, onErr, onExit);
runEventLoop();
console.log("TEST_PASSED");
