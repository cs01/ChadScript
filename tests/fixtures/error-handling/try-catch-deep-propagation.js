// @test-description: deep cross-function exception propagation through multiple call frames
function level3() {
  throw new Error("deep");
}
function level2() {
  level3();
}
function level1() {
  level2();
}

function testDeep() {
  try {
    level1();
  } catch (e) {
    console.log("caught:" + e);
  }
}

testDeep();
console.log("TEST_PASSED");
