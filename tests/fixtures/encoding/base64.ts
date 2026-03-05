// @test-description: btoa/atob round-trip

const encoded = btoa("hello world");
if (encoded !== "aGVsbG8gd29ybGQ=") {
  console.log("FAIL: btoa expected aGVsbG8gd29ybGQ= got " + encoded);
  process.exit(1);
}

const decoded = atob("aGVsbG8gd29ybGQ=");
if (decoded !== "hello world") {
  console.log("FAIL: atob expected 'hello world' got '" + decoded + "'");
  process.exit(1);
}

const round = atob(btoa("ChadScript rocks!"));
if (round !== "ChadScript rocks!") {
  console.log("FAIL: round-trip got '" + round + "'");
  process.exit(1);
}

console.log("TEST_PASSED");
