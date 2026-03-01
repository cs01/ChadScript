// @test-description: json stringify deeply nested inline object literal
const result = JSON.stringify({
  user: { name: "chad", meta: { active: true, level: 3 } },
  count: 42,
  enabled: true,
});
if (
  result.includes("chad") &&
  result.includes("active") &&
  result.includes("42") &&
  result.includes("true")
) {
  console.log("TEST_PASSED");
}
