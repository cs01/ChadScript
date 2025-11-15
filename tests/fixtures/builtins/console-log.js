// Test console.log and console.error - verifies console output works
function testConsole(): number {
  console.log(42);
  console.log("Hello, World!");
  console.error(123);

  // All output succeeded
  console.log("TEST_PASSED");
  process.exit(0);
  return 0;
}

testConsole();
