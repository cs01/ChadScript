// @expect-reject: CS1238
// `m.values()` is an iterator in Node, printed as `[Map Iterator] { 1 }`; the compiler materializes
// it as an array, so printing it directly would diverge. Spread it into an array first.
const m = new Map<string, number>();
m.set("a", 1);
console.log(m.values());
