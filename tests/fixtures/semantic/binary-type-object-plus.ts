// @test-description: reject array + string at compile time
// @test-compile-error: error
const b = [1, 2, 3] + "hello";
