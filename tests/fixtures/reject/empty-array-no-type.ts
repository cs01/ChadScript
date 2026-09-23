// @expect-reject: CS1233
console.log([].length);
for (const x of []) console.log(x);
