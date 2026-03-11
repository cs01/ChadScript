function testChaining(): void {
  const nums: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  const result: number[] = nums
    .filter((n: number): boolean => {
      return n % 2 === 0;
    })
    .map((n: number): number => {
      return n * 10;
    });

  if (result.length !== 5) {
    console.log("FAIL: length should be 5, got " + result.length);
    process.exit(1);
  }

  if (result[0] !== 20) {
    console.log("FAIL: result[0] should be 20, got " + result[0]);
    process.exit(1);
  }

  if (result[4] !== 100) {
    console.log("FAIL: result[4] should be 100, got " + result[4]);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testChaining();
