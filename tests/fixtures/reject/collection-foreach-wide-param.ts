// @expect-reject: CS1222
// forEach hands the callback unboxed numbers; a wider parameter would read them as Value words.
const s = new Set<number>([1, 2]);
s.forEach((v: number | string) => console.log(v));
