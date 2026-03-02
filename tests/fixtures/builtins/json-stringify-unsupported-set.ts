// @test-compile-error: unsupported type — only string, number, boolean, interface, string[], number[], and object[] are supported
const s: Set<number> = new Set();
s.add(1);
JSON.stringify(s);
