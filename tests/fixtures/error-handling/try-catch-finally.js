function testFinallyWithThrow() {
  let result = "";
  try {
    result = result + "try ";
    throw new Error("boom");
  } catch (e) {
    result = result + "catch ";
  } finally {
    result = result + "finally";
  }
  console.log(result);
  return result;
}

function testFinallyNoThrow() {
  let result = "";
  try {
    result = result + "try ";
  } catch (e) {
    result = result + "catch ";
  } finally {
    result = result + "finally";
  }
  console.log(result);
  return result;
}

testFinallyWithThrow();
testFinallyNoThrow();
console.log("TEST_PASSED");
