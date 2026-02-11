function add(acc: number, x: number): number {
  return acc + x;
}

function testReduceSum(): void {
  const nums: number[] = [1, 2, 3, 4, 5];
  const sum = nums.reduce(add, 0);
  if (sum !== 15) {
    console.log("FAIL: sum should be 15");
    process.exit(1);
  }

  const product = nums.reduce((acc: number, x: number): number => acc * x, 1);
  if (product !== 120) {
    console.log("FAIL: product should be 120");
    process.exit(1);
  }

  const noInit: number[] = [10, 20, 30];
  const sumNoInit = noInit.reduce(add);
  if (sumNoInit !== 60) {
    console.log("FAIL: sumNoInit should be 60");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testReduceSum();
