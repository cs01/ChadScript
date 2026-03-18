// @test-description: reject binary type error inside function body
// @test-compile-error: cannot use '-' between 'string' and 'number'
function foo(): number {
  return "hello" - 5;
}
