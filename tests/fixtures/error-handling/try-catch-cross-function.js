// @test-description: cross-function exception propagation via longjmp
function throwError() {
  throw new Error("from inner");
}

function testCrossFunctionCatch() {
  let caught = "";
  try {
    throwError();
  } catch (e) {
    caught = "caught:" + e;
  }
  console.log(caught);
}

testCrossFunctionCatch();
console.log("TEST_PASSED");
