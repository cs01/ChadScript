// @test expectTestPassed
// Regression for callHandler with non-string args: before the fix, the
// bitcast used a fixed double(i8*, i8*, ...)* shape and numeric args were
// passed as raw i64 where an i8* was expected — clang rejected the IR.
function onNum(n: number): void {
  if (n === 42) console.log("TEST_PASSED");
}
class S {
  f: ((n: number) => void) | null = null;
}
const s = new S();
s.f = onNum;
if (s.f !== null) callHandler(s.f, 42);
