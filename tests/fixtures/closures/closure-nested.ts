function testNestedClosure(): void {
  const items: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const threshold: number = 5;

  const above: number[] = items.filter((n: number): boolean => n > threshold);
  if (above.length !== 5) {
    console.log("FAIL: above length should be 5, got " + above.length);
    process.exit(1);
  }

  const doubled: number[] = above.map((n: number): number => n * 2);
  if (doubled[0] !== 12) {
    console.log("FAIL: doubled[0] should be 12, got " + doubled[0]);
    process.exit(1);
  }

  const total: number = doubled.reduce((acc: number, n: number): number => acc + n, 0);
  if (total !== 80) {
    console.log("FAIL: total should be 80, got " + total);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testNestedClosure();
