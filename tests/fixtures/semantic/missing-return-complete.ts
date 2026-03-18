function classify(x: number): string {
  if (x > 0) {
    return "positive";
  } else {
    return "non-positive";
  }
}

const result = classify(5);
if (result === "positive") {
  console.log("TEST_PASSED");
}
