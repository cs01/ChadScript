// @test-description: reject boolean + number at compile time
// @test-compile-error: cannot use '+' between 'boolean' and 'number'
const b = true + 8;
