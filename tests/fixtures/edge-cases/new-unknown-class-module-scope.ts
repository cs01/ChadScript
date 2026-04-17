// @test-compile-error: cannot determine type of module-scope variable
// @test-description: new UnknownClass() at module scope emits compile error instead of segfault
const x = new UnknownClass();
