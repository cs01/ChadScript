// Test process.argv - verifies command line argument access works
// This should receive one argument and verify it

function testArgv(): void {
  // Check that we have at least 1 argument (user args only, no program name)
  if (process.argv.length < 1) {
    throw new Error("not enough arguments");
  }

  // Get the first actual argument (argv[0], program name is not included)
  const arg = process.argv[0];

  // Verify it's the expected test value "testarg"
  if (arg !== "testarg") {
    throw new Error("argument value wrong");
  }

  // Verify the length is correct
  if (arg.length !== 7) {
    throw new Error("testarg.length should be 7");
  }

  // All checks passed!
  console.log("TEST_PASSED");
}

testArgv();
