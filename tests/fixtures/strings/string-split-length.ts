// String split test - verifies split produces correct array elements
// This is a critical example from the README that must always work

function testSplit(): number {
  const str = "apple,banana,cherry,date,elderberry";
  const parts = str.split(",");

  // Verify we got 5 parts
  if (parts.length !== 5) {
    console.log("Error: wrong length");
    process.exit(1);
  }

  // Verify each part is correct
  if (parts[0] !== "apple") {
    console.log("Error: first element wrong");
    process.exit(2);
  }

  if (parts[1] !== "banana") {
    console.log("Error: second element wrong");
    process.exit(3);
  }

  if (parts[2] !== "cherry") {
    console.log("Error: third element wrong");
    process.exit(4);
  }

  if (parts[3] !== "date") {
    console.log("Error: fourth element wrong");
    process.exit(5);
  }

  if (parts[4] !== "elderberry") {
    console.log("Error: fifth element wrong");
    process.exit(6);
  }

  // Verify the length of each part
  if (parts[0].length !== 5) {
    console.log("Error: apple.length should be 5");
    process.exit(7);
  }

  if (parts[1].length !== 6) {
    console.log("Error: banana.length should be 6");
    process.exit(8);
  }

  if (parts[2].length !== 6) {
    console.log("Error: cherry.length should be 6");
    process.exit(9);
  }

  if (parts[3].length !== 4) {
    console.log("Error: date.length should be 4");
    process.exit(10);
  }

  if (parts[4].length !== 10) {
    console.log("Error: elderberry.length should be 10");
    process.exit(11);
  }

  // All checks passed!
  console.log("TEST_PASSED");
  process.exit(0);
  return 0; // Never reached but satisfies compiler
}

testSplit();
