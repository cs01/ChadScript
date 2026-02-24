// Exercises console.error() to verify stderr codegen uses the correct
// platform symbol (@stderr on Linux vs @__stderrp on macOS).
// @test-description: cross-compile stderr symbol is platform-correct
console.error("stderr works");
console.log("TEST_PASSED");
