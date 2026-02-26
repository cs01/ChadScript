// @test-compile-error: has members with different native representations
// @test-description: inline union types with different representations are a compile error
function process(x: string | number): void {
  console.log("unreachable");
}
process("hello");
