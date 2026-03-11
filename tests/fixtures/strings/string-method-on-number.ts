// @test-compile-error: .trim() is only available on strings
// @test-description: calling string methods on numbers is a compile error
const x: number = 42;
const result = x.trim();
console.log(result);
