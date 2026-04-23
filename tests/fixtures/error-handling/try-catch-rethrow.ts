function testRethrow() {
  let result = "";
  try {
    try {
      throw new Error("original");
    } catch (inner) {
      result = result + "inner-caught ";
      throw new Error("rethrown");
    }
  } catch (outer) {
    result = result + "outer-caught:" + outer;
  }
  console.log(result);
}

testRethrow();
console.log("TEST_PASSED");
