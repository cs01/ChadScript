// @expect-reject: CS1216
// Non-ASCII in a string literal: `.length` would count UTF-8 bytes (6) where Node counts UTF-16
// code units (5), and `.slice` would cut a character in half. Rejected at the only boundary
// through which a non-ASCII string can enter the program.
const s = "héllo";
console.log(s.length);
