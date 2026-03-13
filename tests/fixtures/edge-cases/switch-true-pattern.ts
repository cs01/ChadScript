function classify(n: number): string {
  switch (true) {
    case n < 0:
      return "negative";
    case n === 0:
      return "zero";
    case n < 10:
      return "small";
    case n < 100:
      return "medium";
    default:
      return "large";
  }
}

if (classify(-5) !== "negative") process.exit(1);
if (classify(0) !== "zero") process.exit(1);
if (classify(5) !== "small") process.exit(1);
if (classify(50) !== "medium") process.exit(1);
if (classify(500) !== "large") process.exit(1);

console.log("TEST_PASSED");
