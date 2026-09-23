// @expect-reject: CS1222
// A held iterator would see the set() below in Node; only a for...of iterable or a spread is live
// or eager enough to match.
const m = new Map<string, number>();
m.set("a", 1);
const it = m.keys();
m.set("b", 2);
for (const k of it) console.log(k);
