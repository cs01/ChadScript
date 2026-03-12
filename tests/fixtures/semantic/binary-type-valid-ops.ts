// @test-description: valid binary operations should compile fine
const a = 1 + 2;
const b = "hello" + " world";
const c = 10 - 3;
const d = 4 * 5;
const e = a > 0 ? "yes" : "no";
const f = a === 3;
const g = "abc" < "def";
const h = "count: " + 42;

if (a === 3 && b === "hello world" && c === 7 && d === 20 && f === true && g === true && h === "count: 42") {
  console.log("TEST_PASSED");
}
