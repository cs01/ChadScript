// @expect-reject: CS1214
const s = '{"a":1}';
const o = JSON.parse(s);
console.log(o);
