// @test-description: Map<number, string> at module scope should emit compile error
// @test-compile-error: Map<number, string> is not supported
const m: Map<number, string> = new Map();
m.set(1, "one");
console.log(m.get(1));
