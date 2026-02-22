// @test-exit-code: 0
function willThrow() {
  console.log("about to throw");
  throw new Error("test error");
}

function testNoThrow() {
  console.log("this function doesn't throw");
  return 42;
}

// Test a function that doesn't throw
testNoThrow();
