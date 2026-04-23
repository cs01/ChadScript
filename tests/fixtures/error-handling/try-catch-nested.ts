function testNested() {
  let result = "";
  try {
    result = result + "outer-try ";
    try {
      result = result + "inner-try ";
      throw new Error("inner error");
    } catch (e) {
      result = result + "inner-catch ";
    }
    result = result + "after-inner ";
    throw new Error("outer error");
  } catch (e) {
    result = result + "outer-catch";
  }
  console.log(result);
}

testNested();
console.log("TEST_PASSED");
