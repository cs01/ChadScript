// @expect-reject: CS1000
// Top-level await: Node suspends the module; the compiled main has no fiber to suspend.
const v = await Promise.resolve(3);
console.log(v);
export {};
