// @test-description: switch fall-through between cases

function classify(x: number): string {
  let result = "";
  switch (x) {
    case 1:
    case 2:
    case 3:
      result = "small";
      break;
    case 4:
      result = "medium";
      break;
    case 5:
    case 6:
      result = "large";
      break;
    default:
      result = "unknown";
      break;
  }
  return result;
}

if (classify(1) !== "small") {
  console.log("FAIL: 1 should be small, got " + classify(1));
  process.exit(1);
}
if (classify(2) !== "small") {
  console.log("FAIL: 2 should be small, got " + classify(2));
  process.exit(1);
}
if (classify(3) !== "small") {
  console.log("FAIL: 3 should be small, got " + classify(3));
  process.exit(1);
}
if (classify(4) !== "medium") {
  console.log("FAIL: 4 should be medium, got " + classify(4));
  process.exit(1);
}
if (classify(5) !== "large") {
  console.log("FAIL: 5 should be large, got " + classify(5));
  process.exit(1);
}
if (classify(6) !== "large") {
  console.log("FAIL: 6 should be large, got " + classify(6));
  process.exit(1);
}
if (classify(99) !== "unknown") {
  console.log("FAIL: 99 should be unknown, got " + classify(99));
  process.exit(1);
}

console.log("TEST_PASSED");
