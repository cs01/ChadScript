function classify(n: number): string {
  if (n < 0) {
    return "negative";
  } else if (n === 0) {
    return "zero";
  } else if (n < 10) {
    return "small";
  } else if (n < 100) {
    return "medium";
  } else {
    return "large";
  }
}

function testNestedIfElse(): void {
  if (classify(-5) !== "negative") { console.log("FAIL: -5"); process.exit(1); }
  if (classify(0) !== "zero") { console.log("FAIL: 0"); process.exit(1); }
  if (classify(5) !== "small") { console.log("FAIL: 5"); process.exit(1); }
  if (classify(50) !== "medium") { console.log("FAIL: 50"); process.exit(1); }
  if (classify(500) !== "large") { console.log("FAIL: 500"); process.exit(1); }

  console.log("TEST_PASSED");
}

testNestedIfElse();
