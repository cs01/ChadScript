// A `%` that is no printf directive prints as written, even with more arguments.
const n = 3;
console.log("50% done", n);
console.log("100%", n, "%x", "%s");
console.log("%s alone");
