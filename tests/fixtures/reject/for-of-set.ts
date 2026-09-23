// @expect-reject: CS1222
const s = new Set<number>([1, 2]);
for (const v of s) console.log(v);
