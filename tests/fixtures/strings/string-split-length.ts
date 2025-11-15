// String split test - verifies split produces correct array elements
// This is a critical example from the README that must always work

function testSplit(): number {
  const str = "apple,banana,cherry,date,elderberry";
  const parts = str.split(",");

  // Verify we got 5 parts
  if (parts.length !== 5) {
    return 1; // Error: wrong length
  }

  // Verify each part is correct
  if (parts[0] !== "apple") {
    return 2; // Error: first element wrong
  }

  if (parts[1] !== "banana") {
    return 3; // Error: second element wrong
  }

  if (parts[2] !== "cherry") {
    return 4; // Error: third element wrong
  }

  if (parts[3] !== "date") {
    return 5; // Error: fourth element wrong
  }

  if (parts[4] !== "elderberry") {
    return 6; // Error: fifth element wrong
  }

  // Verify the length of each part
  if (parts[0].length !== 5) {
    return 7; // Error: "apple".length should be 5
  }

  if (parts[1].length !== 6) {
    return 8; // Error: "banana".length should be 6
  }

  if (parts[2].length !== 6) {
    return 9; // Error: "cherry".length should be 6
  }

  if (parts[3].length !== 4) {
    return 10; // Error: "date".length should be 4
  }

  if (parts[4].length !== 10) {
    return 11; // Error: "elderberry".length should be 10
  }

  // All checks passed!
  return 0;
}

process.exit(testSplit());
