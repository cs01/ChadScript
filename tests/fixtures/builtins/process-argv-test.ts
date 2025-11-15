// Test process.argv - verifies command line argument access works
// This should receive one argument and verify it

function testArgv(): number {
  // Check that we have at least 2 arguments (program name + 1 arg)
  if (process.argv.length < 2) {
    return 1; // Error: not enough arguments
  }

  // Get the first actual argument (argv[1])
  const arg = process.argv[1];

  // Verify it's the expected test value "testarg"
  if (arg !== "testarg") {
    return 2; // Error: argument value wrong
  }

  // Verify the length is correct
  if (arg.length !== 7) {
    return 3; // Error: "testarg".length should be 7
  }

  // All checks passed!
  return 0;
}

process.exit(testArgv());
