// @expect-reject: CS1217
// setTimeout calls its callback with no arguments, so `x` would never be passed.
setTimeout((x?: number) => console.log("t", x), 0);
