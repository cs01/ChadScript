// @expect-reject: CS1246
// String(undefined) is "undefined", a conversion the String wrapper does not model for an
// optional argument; and Date.now is not admitted as a value at all.
const xs: (number | undefined)[] = [1, undefined];
console.log(xs.map(String));
const clocks: (() => number)[] = [Date.now];
console.log(clocks.length);
