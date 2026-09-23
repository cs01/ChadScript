// @expect-reject: CS1000
const o = { x: 1 };
const y = o.x++;
console.log(y, o.x);
