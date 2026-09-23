// @expect-reject: CS1000
const o = { "a-b": 1 };
o["a-b"] = 2;
console.log(o);
