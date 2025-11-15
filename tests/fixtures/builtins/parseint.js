// Test parseInt with different radixes - verifies number parsing works
function testParseInt() {
  // Test base 10
  const base10 = parseInt("42");
  if (base10 !== 42) {
    console.log("Error: parseInt('42') should be 42");
    process.exit(1);
  }

  // Test base 16
  const base16 = parseInt("FF", 16);
  if (base16 !== 255) {
    console.log("Error: parseInt('FF', 16) should be 255");
    process.exit(2);
  }

  // Test base 2
  const base2 = parseInt("101", 2);
  if (base2 !== 5) {
    console.log("Error: parseInt('101', 2) should be 5");
    process.exit(3);
  }

  // All tests passed
  console.log("TEST_PASSED");
}

testParseInt();
