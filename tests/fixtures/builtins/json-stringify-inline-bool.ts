// @test-description: json stringify inline object with only boolean fields
const a = JSON.stringify({ ok: true });
const b = JSON.stringify({ ok: false });
if (a.includes("true") && b.includes("false")) {
  console.log("TEST_PASSED");
}
