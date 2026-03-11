function classify(n: number): string {
  if (n < 0) return "negative";
  if (n === 0) return "zero";
  return "positive";
}

let passed = true;
if (classify(-5) !== "negative") passed = false;
if (classify(0) !== "zero") passed = false;
if (classify(10) !== "positive") passed = false;

if (passed) {
  console.log("TEST_PASSED");
} else {
  console.log("FAILED");
}
