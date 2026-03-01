// @test-description: json stringify inline object literal with boolean and number fields
const result = JSON.stringify({ success: true, count: 42, name: "chad" });
if (result.includes("true") && result.includes("42") && result.includes("chad")) {
  console.log("TEST_PASSED");
}
