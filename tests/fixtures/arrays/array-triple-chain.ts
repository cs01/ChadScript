// @test-description: three-level chained array method calls

const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const result = nums
  .filter((n: number) => n % 2 === 0)
  .map((n: number) => n * 10)
  .join(",");

if (result !== "20,40,60,80,100") {
  console.log("FAIL: got " + result);
  process.exit(1);
}

const words = ["hello", "world", "foo", "bar", "baz"];
const upper = words
  .filter((w: string) => w.length > 3)
  .map((w: string) => w.toUpperCase())
  .join(" ");

if (upper !== "HELLO WORLD") {
  console.log("FAIL: upper = " + upper);
  process.exit(1);
}

console.log("TEST_PASSED");
