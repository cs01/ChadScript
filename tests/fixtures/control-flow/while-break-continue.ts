function testWhileBreakContinue(): void {
  let sum: number = 0;
  let i: number = 0;

  while (i < 10) {
    i = i + 1;
    if (i % 2 === 0) {
      continue;
    }
    sum = sum + i;
  }

  if (sum !== 25) {
    console.log("FAIL: sum of odd 1-9 should be 25, got " + sum);
    process.exit(1);
  }

  let val: number = 0;
  let j: number = 0;
  while (true) {
    j = j + 1;
    val = val + j;
    if (j >= 5) {
      break;
    }
  }

  if (val !== 15) {
    console.log("FAIL: val should be 15, got " + val);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testWhileBreakContinue();
