// @test-compile-error: Set is not JSON-serializable
const s: Set<number> = new Set();
s.add(1);
JSON.stringify(s);
