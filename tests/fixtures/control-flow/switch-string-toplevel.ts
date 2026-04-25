// @test-skip
// passes with node compiler but native compiler fails on toplevel switch-string in self-hosted stages
const s = "b";
switch (s) {
  case "a":
    console.log("FAIL: matched a");
    break;
  case "b":
    console.log("TEST_PASSED");
    break;
  default:
    console.log("FAIL: hit default");
}
