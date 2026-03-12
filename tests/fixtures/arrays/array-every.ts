function test(): void {
  const nums: number[] = [2, 4, 6, 8];
  const allEven = nums.every((n: number) => n % 2 === 0);
  if (!allEven) {
    console.log("FAIL: expected all even");
    return;
  }

  const mixed: number[] = [2, 3, 6];
  const allEven2 = mixed.every((n: number) => n % 2 === 0);
  if (allEven2) {
    console.log("FAIL: expected not all even");
    return;
  }

  const empty: number[] = [];
  const emptyResult = empty.every((n: number) => n > 0);
  if (!emptyResult) {
    console.log("FAIL: every on empty should be true");
    return;
  }

  console.log("TEST_PASSED");
}
test();
