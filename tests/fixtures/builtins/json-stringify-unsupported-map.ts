// @test-compile-error: unsupported type — only string, number, boolean, interface, string[], number[], and object[] are supported
const m: Map<string, number> = new Map();
m.set("key", 42);
JSON.stringify(m);
