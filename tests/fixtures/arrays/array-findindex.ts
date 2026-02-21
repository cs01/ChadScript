function testArrayFindIndex(): void {
  let nums: number[] = [1, 3, 5, 8, 10];

  let idx = nums.findIndex((n: number): boolean => n > 4);
  if (idx !== 2) {
    console.log("FAIL: findIndex greater than 4");
    process.exit(1);
  }

  let notFound = nums.findIndex((n: number): boolean => n > 100);
  if (notFound !== -1) {
    console.log("FAIL: findIndex not found");
    process.exit(1);
  }

  let firstIdx = nums.findIndex((n: number): boolean => n === 1);
  if (firstIdx !== 0) {
    console.log("FAIL: findIndex first");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testArrayFindIndex();
