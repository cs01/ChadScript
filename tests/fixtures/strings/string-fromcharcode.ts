// @test-description: String.fromCharCode produces correct characters
const a = String.fromCharCode(65);
const b = String.fromCharCode(66);
const newline = String.fromCharCode(10);
if (a === "A" && b === "B" && newline === "\n") {
  console.log("TEST_PASSED");
}
