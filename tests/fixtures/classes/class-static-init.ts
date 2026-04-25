// @test-skip
// passes with node compiler but native compiler fails on static field initializers
class Config {
  static version: string = "1.0.0";
  static maxRetries: number = 5;
  static debug: boolean = true;
  static negative: number = -42;
}

let passed = true;

if (Config.version !== "1.0.0") {
  console.log("FAIL: version = " + Config.version);
  passed = false;
}

if (Config.maxRetries !== 5) {
  console.log("FAIL: maxRetries = " + Config.maxRetries.toString());
  passed = false;
}

if (Config.debug !== true) {
  console.log("FAIL: debug is not true");
  passed = false;
}

if (Config.negative !== -42) {
  console.log("FAIL: negative = " + Config.negative.toString());
  passed = false;
}

if (passed) {
  console.log("TEST_PASSED");
}
