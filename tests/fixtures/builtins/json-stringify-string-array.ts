// @test-description: json stringify string array
const tags: string[] = ["alpha", "beta", "gamma"];
const result = JSON.stringify(tags);
if (result.includes("alpha") && result.includes("beta") && result.includes("gamma")) {
  console.log("TEST_PASSED");
}
