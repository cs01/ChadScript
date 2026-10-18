// A `!` whose assertion is false: Node would print `undefined`; the native build throws instead.
const m = new Map<string, number>();
console.log("before");
console.log(m.get("missing")! + 1);
