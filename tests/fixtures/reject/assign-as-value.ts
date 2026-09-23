// @expect-reject: CS1000
// An assignment whose value is passed on is not supported; make it a statement first.
let x = 0;
console.log((x = 5));
