// @test-description: console.warn writes to stderr, stdout has TEST_PASSED
console.warn("warn message");
console.warn(99);
console.log("TEST_PASSED");
