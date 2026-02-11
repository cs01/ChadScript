function testSpreadNumeric(): void {
  const a: number[] = [1, 2, 3];
  const b: number[] = [4, 5, 6];

  const merged: number[] = [...a, ...b];
  if (merged.length !== 6) {
    console.log("FAIL: merged length should be 6");
    process.exit(1);
  }
  if (merged[0] !== 1) {
    console.log("FAIL: merged[0] should be 1");
    process.exit(1);
  }
  if (merged[5] !== 6) {
    console.log("FAIL: merged[5] should be 6");
    process.exit(1);
  }

  const prepended: number[] = [0, ...a];
  if (prepended.length !== 4) {
    console.log("FAIL: prepended length should be 4");
    process.exit(1);
  }
  if (prepended[0] !== 0) {
    console.log("FAIL: prepended[0] should be 0");
    process.exit(1);
  }
  if (prepended[3] !== 3) {
    console.log("FAIL: prepended[3] should be 3");
    process.exit(1);
  }

  const appended: number[] = [...a, 99];
  if (appended.length !== 4) {
    console.log("FAIL: appended length should be 4");
    process.exit(1);
  }
  if (appended[3] !== 99) {
    console.log("FAIL: appended[3] should be 99");
    process.exit(1);
  }

  const copy: number[] = [...a];
  if (copy.length !== 3) {
    console.log("FAIL: copy length should be 3");
    process.exit(1);
  }
  if (copy[0] !== 1) {
    console.log("FAIL: copy[0] should be 1");
    process.exit(1);
  }

  const sandwich: number[] = [10, ...a, 20];
  if (sandwich.length !== 5) {
    console.log("FAIL: sandwich length should be 5");
    process.exit(1);
  }
  if (sandwich[0] !== 10) {
    console.log("FAIL: sandwich[0] should be 10");
    process.exit(1);
  }
  if (sandwich[4] !== 20) {
    console.log("FAIL: sandwich[4] should be 20");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testSpreadNumeric();
