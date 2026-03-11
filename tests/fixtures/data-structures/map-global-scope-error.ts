// @test-compile-error: Map operations at the top level are not supported
// @test-description: compile error for global scope map usage
const m = new Map<string, string>();
m.set("k", "v");
console.log(m.get("k"));
