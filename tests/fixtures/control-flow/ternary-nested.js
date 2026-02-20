// Test nested ternary - verifies nested grade calculation works
function testTernaryNested(): void {
  const score = 85;

  // Nested ternary:
  // score >= 90 ? 10 : (score >= 80 ? 20 : 30)
  // For score 85: 85 >= 90 ? no : (85 >= 80 ? yes -> 20)
  const grade = score >= 90 ? 10 : score >= 80 ? 20 : 30;

  if (grade !== 20) {
    throw new Error("grade should be 20");
  }

  console.log("TEST_PASSED");
}

testTernaryNested();
