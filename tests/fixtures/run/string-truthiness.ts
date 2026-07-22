// String truthiness: only "" is falsy; every non-empty string (whitespace, "0", "false", "\0")
// is truthy. Exercised in if, ternary, &&/||, and Boolean().
function truthy(s: string): string {
  return s ? "yes" : "no";
}
console.log(truthy("")); // no
console.log(truthy("a")); // yes
console.log(truthy(" ")); // yes — whitespace is non-empty
console.log(truthy("0")); // yes — string "0" is NOT falsy (unlike number 0)
console.log(truthy("false")); // yes
console.log(truthy("\0")); // yes — a NUL byte is length 1

const s: string = "hi";
if (s) console.log("if-branch"); // taken
const e: string = "";
if (!e) console.log("not-empty"); // taken

console.log(Boolean("x")); // true
console.log(Boolean("")); // false
console.log(e || "fallback"); // fallback — empty is falsy, || picks right
console.log(s && "second"); // second — both truthy, && picks right
