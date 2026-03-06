// @test-description: console.error writes to stderr, stdout has TEST_PASSED
console.error("error message");
console.error(42);
console.error(true);
console.log("TEST_PASSED");
