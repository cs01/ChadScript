class Config {
  maxRetries: number = 5;
  name: string = "default";
  enabled: boolean = true;
  negative: number = -10;
}

const c = new Config();
let passed = true;

if (c.maxRetries !== 5) {
  console.log("FAIL: maxRetries = " + c.maxRetries.toString());
  passed = false;
}

if (c.name !== "default") {
  console.log("FAIL: name = " + c.name);
  passed = false;
}

if (c.enabled !== true) {
  console.log("FAIL: enabled is not true");
  passed = false;
}

if (c.negative !== -10) {
  console.log("FAIL: negative = " + c.negative.toString());
  passed = false;
}

if (passed) {
  console.log("TEST_PASSED");
}
