// String split test - verifies split produces correct array elements
// This is a critical example from the README that must always work

function testSplit(): void {
  const str = "apple,banana,cherry,date,elderberry";
  const parts = str.split(",");

  // Verify we got 5 parts
  if (parts.length !== 5) {
    throw new Error("wrong length");
  }

  // Verify each part is correct
  if (parts[0] !== "apple") {
    throw new Error("first element wrong");
  }

  if (parts[1] !== "banana") {
    throw new Error("second element wrong");
  }

  if (parts[2] !== "cherry") {
    throw new Error("third element wrong");
  }

  if (parts[3] !== "date") {
    throw new Error("fourth element wrong");
  }

  if (parts[4] !== "elderberry") {
    throw new Error("fifth element wrong");
  }

  // Verify the length of each part
  if (parts[0].length !== 5) {
    throw new Error("apple.length should be 5");
  }

  if (parts[1].length !== 6) {
    throw new Error("banana.length should be 6");
  }

  if (parts[2].length !== 6) {
    throw new Error("cherry.length should be 6");
  }

  if (parts[3].length !== 4) {
    throw new Error("date.length should be 4");
  }

  if (parts[4].length !== 10) {
    throw new Error("elderberry.length should be 10");
  }

  // All checks passed!
  console.log("TEST_PASSED");
}

testSplit();
