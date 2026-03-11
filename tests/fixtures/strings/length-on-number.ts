// @test-compile-error: .length is not available on type
// @test-description: accessing .length on a number is a compile error
const x: number = 42;
const len = x.length;
console.log(len);
