// @expect-reject: CS1000
const m1 = new Map<string, number>([["a", 1]]);
const m2 = new Map<string, number>(m1);
console.log(m2.get("a"));
