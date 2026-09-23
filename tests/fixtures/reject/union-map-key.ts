// @expect-reject: CS1233
// Map keys are hashed by one fixed kind; a key that may be a number or a string has none.
const m = new Map<number | string, boolean>();
m.set(1, true);
m.set("1", false);
console.log(m.size);
