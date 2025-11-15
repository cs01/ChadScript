// Test process.argv - verifies command line argument access works
// This should receive one argument and verify it

function testArgv(): void {
  // Check that we have at least 2 arguments (program name + 1 arg)
  if (process.argv.length < 2) {
    console.log("Error: not enough arguments");
    process.exit(1);
  }

  // Get the first actual argument (argv[1])
  const arg = process.argv[1];

  // Verify it's the expected test value "testarg"
  if (arg !== "testarg") {
    console.log("Error: argument value wrong");
    process.exit(2);
  }

  // Verify the length is correct
  if (arg.length !== 7) {
    console.log("Error: testarg.length should be 7");
    process.exit(3);
  }

  // All checks passed!
  console.log("TEST_PASSED");
}

testArgv();
