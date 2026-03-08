function classify(n: number): string {
  if (n > 0) {
    return "positive";
  } else {
    return "non-positive";
  }
  // dead code — should not be emitted
}

const a = classify(5);
const b = classify(-3);
const c = classify(0);

if (a === "positive" && b === "non-positive" && c === "non-positive") {
  console.log("TEST_PASSED");
}
