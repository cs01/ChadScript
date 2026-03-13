// @test-description: reject string - number at compile time
// @test-compile-error: cannot use '-' between 'string' and 'number'
const b = "hi" - 3;
