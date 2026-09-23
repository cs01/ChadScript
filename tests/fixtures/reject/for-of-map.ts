// @expect-reject: CS1222
const m = new Map<string, number>();
m.set("a", 1);
for (const e of m) console.log(e);
