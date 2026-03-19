// @test-native-only
function sum(...nums: number[]): number {
  return nums.reduce((a: number, b: number): number => a + b, 0);
}

function first(...items: number[]): number {
  return items[0];
}

function testRestParams(): void {
  const args: number[] = [1, 2, 3, 4, 5];
  const result = sum(...args);
  if (result !== 15) {
    console.log("FAIL: sum should be 15");
    process.exit(1);
  }

  const f = first(...args);
  if (f !== 1) {
    console.log("FAIL: first should be 1");
    process.exit(1);
  }

  const moreArgs: number[] = [10, 20, 30];
  const result2 = sum(...moreArgs);
  if (result2 !== 60) {
    console.log("FAIL: sum should be 60");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testRestParams();
