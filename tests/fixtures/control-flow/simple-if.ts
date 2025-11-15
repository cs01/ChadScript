// Simplest possible if test - verifies basic if statement works
function testSimpleIf(): number {
  const x = 0;

  if (x === 0) {
    console.log("TEST_PASSED");
    process.exit(0);
    return 0;
  }

  throw new Error("if statement failed");
  return 1;
}

testSimpleIf();
