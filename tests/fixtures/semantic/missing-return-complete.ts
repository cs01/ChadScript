// @test-description: function with returns on all paths should compile
function check(x: number): string {
  if (x > 0) {
    return "positive";
  } else {
    return "non-positive";
  }
}

if (check(1) === "positive" && check(-1) === "non-positive") {
  console.log("TEST_PASSED");
}
