const symbols: Map<string, string> = new Map();

symbols.set("foo", "hello");
symbols.set("bar", "world");

const value = symbols.get("foo");
console.log(value);
