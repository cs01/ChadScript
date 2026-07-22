// @expect-reject: CS1222
const s = new Set<number>([1, 2]);
s.forEach((v) => console.log(v));
