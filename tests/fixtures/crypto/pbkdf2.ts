function testPbkdf2(): void {
  const result = crypto.pbkdf2("password", "salt", 1, 20);
  const expected = "0c60c80f961f0e71f3a9b524af6012062fe037a6";
  if (result !== expected) {
    console.log("FAILED: got " + result);
    process.exit(1);
  }
  console.log("TEST_PASSED");
}
testPbkdf2();
