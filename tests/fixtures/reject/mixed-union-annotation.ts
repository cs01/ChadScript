// @expect-reject: CS1233
// The same check on a declared type, not just an inferred one.
const value: string | number = "hello";
console.log(value);
