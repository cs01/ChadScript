// Simplest possible if test - verifies basic if statement works
function testSimpleIf(): number {
  const x = 0;

  if (x === 0) {
    console.log("TEST_PASSED");
    process.exit(0);
    return 0;
  }

  console.log("Error: if statement failed");
  process.exit(1);
  return 1;
}

testSimpleIf();
