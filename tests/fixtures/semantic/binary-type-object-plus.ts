// @test-description: reject array + string at compile time
// @test-exit-code: 1
// @test-skip
const b = [1, 2, 3] + "hello";
