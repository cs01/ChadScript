// @expect-reject: CS1222
// `m.values()` is an iterator in Node, printed as `[Map Iterator] { 1 }`; an iterator is only
// admitted as a for...of iterable or a spread operand. Spread it into an array first.
const m = new Map<string, number>();
m.set("a", 1);
console.log(m.values());
