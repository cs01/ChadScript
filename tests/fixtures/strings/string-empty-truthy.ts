// @test-description: empty string is falsy in if conditions
const empty = "";
const nonEmpty = "hello";

let emptyResult = "not set";
if (empty) {
  emptyResult = "truthy";
} else {
  emptyResult = "falsy";
}

let nonEmptyResult = "not set";
if (nonEmpty) {
  nonEmptyResult = "truthy";
} else {
  nonEmptyResult = "falsy";
}

if (emptyResult === "falsy" && nonEmptyResult === "truthy") {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL: empty=" + emptyResult + " nonEmpty=" + nonEmptyResult);
}
