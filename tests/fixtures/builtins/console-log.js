// Test console.log and console.error - verifies console output works
function testConsole() {
  console.log(42);
  console.log("Hello, World!");
  console.error(123);

  // All output succeeded
  console.log("TEST_PASSED");
}

testConsole();
