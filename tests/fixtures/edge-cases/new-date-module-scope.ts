// @test-compile-error: cannot determine type of module-scope variable
// @test-description: new Date() at module scope emits clean compile error instead of segfault
const d = new Date();
