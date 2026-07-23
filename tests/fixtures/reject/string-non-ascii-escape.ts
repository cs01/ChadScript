// @expect-reject: CS1216
// A unicode escape produces the same non-ASCII string as a literal character, so the boundary
// must be checked on the COOKED text rather than the source spelling.
const s = "caf\u00e9";
console.log(s.length);
