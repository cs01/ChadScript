function testTryCatch() {
  console.log("before try");
  try {
    console.log("in try block");
  } catch (e) {
    console.log("in catch block");
  }
  console.log("after try-catch");
  return 0;
}

// Test try-catch (catch block is never reached in our simple implementation)
testTryCatch();
