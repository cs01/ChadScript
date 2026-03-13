function testFilterResultOps(): void {
  const nums: number[] = [1, 2, 3, 4, 5, 6, 7, 8];
  const evens = nums.filter((n: number): boolean => n % 2 === 0);
  if (evens.length !== 4) process.exit(1);
  if (evens[0] !== 2) process.exit(1);
  if (evens[3] !== 8) process.exit(1);
  const idx = evens.indexOf(6);
  if (idx !== 2) process.exit(1);
  const mapped = nums.map((n: number): number => n * 10);
  if (mapped.length !== 8) process.exit(1);
  if (mapped[0] !== 10) process.exit(1);
  const mappedIdx = mapped.indexOf(50);
  if (mappedIdx !== 4) process.exit(1);
  console.log("TEST_PASSED");
}
testFilterResultOps();
