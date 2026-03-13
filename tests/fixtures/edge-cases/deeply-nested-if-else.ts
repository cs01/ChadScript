function classify(n: number): string {
  if (n < 0) {
    if (n < -100) {
      return "very negative";
    } else if (n < -10) {
      return "negative";
    } else {
      return "slightly negative";
    }
  } else if (n === 0) {
    return "zero";
  } else {
    if (n > 100) {
      return "very positive";
    } else if (n > 10) {
      return "positive";
    } else {
      return "slightly positive";
    }
  }
}

if (classify(-200) !== "very negative") process.exit(1);
if (classify(-50) !== "negative") process.exit(1);
if (classify(-5) !== "slightly negative") process.exit(1);
if (classify(0) !== "zero") process.exit(1);
if (classify(5) !== "slightly positive") process.exit(1);
if (classify(50) !== "positive") process.exit(1);
if (classify(200) !== "very positive") process.exit(1);

console.log("TEST_PASSED");
