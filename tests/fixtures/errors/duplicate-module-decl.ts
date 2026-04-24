// @test-description: duplicate module-level declarations produce compile error
// @test-compile-error: duplicate module-level declaration

const FOO: number = 42;
const FOO: number = 99;

function main(): void {
  console.log("should not reach here");
}
main();
