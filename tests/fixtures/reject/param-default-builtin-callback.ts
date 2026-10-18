// @expect-reject: CS1240
// map always passes the index, as a plain number; the default slot takes `number | undefined`.
console.log([1, 2].map((x, i = 5) => x + i));
