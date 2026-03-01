// @test-description: json stringify inline object with mixed string and number variable values
const name = "hello";
const count = 42;
const ts = 1234567890;
const result = JSON.stringify({ name: name, count: count, ts: ts });
if (result.includes("hello") && result.includes("42") && result.includes("1234567890")) {
  console.log("TEST_PASSED");
}
