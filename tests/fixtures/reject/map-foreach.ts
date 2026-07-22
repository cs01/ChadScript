// @expect-reject: CS1222
const m = new Map<string, number>();
m.set("a", 1);
m.forEach((v) => console.log(v));
