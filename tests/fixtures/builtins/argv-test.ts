// Test process.argv and string array access
// This should reproduce the argparse-cli issue

// Get first positional arg (should be empty)
const arg = process.argv[1];

console.log("Got arg");

// Test length
if (arg.length === 0) {
  console.log("Arg is empty");
  process.exit(10);
}

console.log("Arg is NOT empty");
process.exit(1);
