// Test process.argv and string array access
// User arguments start at index 0 (program name not included)

// Check if any user args were provided
if (process.argv.length === 0) {
  console.log("No args provided");
  process.exit(10);
}

// Get first positional arg
const arg = process.argv[0];

console.log("Got arg");

// Test length
if (arg.length === 0) {
  console.log("Arg is empty");
  process.exit(10);
}

console.log("Arg is NOT empty");
process.exit(1);
