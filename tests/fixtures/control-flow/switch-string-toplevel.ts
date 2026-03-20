// @test-skip
// native switch string matching fails in self-hosted stages on linux
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
