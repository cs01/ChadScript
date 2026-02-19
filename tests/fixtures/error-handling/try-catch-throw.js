function testTryCatch() {
  console.log("before try");
  try {
    console.log("in try block");
    throw new Error("test error");
  } catch (e) {
    console.log("caught: " + e);
  }
  console.log("after try-catch");
}

testTryCatch();

console.log("TEST_PASSED");
