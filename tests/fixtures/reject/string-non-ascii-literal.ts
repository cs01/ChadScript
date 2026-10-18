// @expect-reject: CS1216
// Non-ASCII in a string literal: `.length` would count UTF-8 bytes (6) where Node counts UTF-16
// code units (5), and `.slice` would cut a character in half. Rejected at compile time; runtime input is checked by runtime/ascii-gate.milo.
//
const s = "héllo";
console.log(s.length);
