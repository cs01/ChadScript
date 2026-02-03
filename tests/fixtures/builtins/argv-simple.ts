// Test process.argv with no user arguments

console.log("Checking argv.length");
if (process.argv.length === 0) {
  console.log("No user arguments passed (correct)");
  process.exit(0);
}

console.log("Unexpected: got arguments when none were passed");
process.exit(1);
