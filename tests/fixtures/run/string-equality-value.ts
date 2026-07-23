// String ===/!== in value/boolean position (not just `switch`). Uses cs_str_eq: full-length,
// byte-exact, NUL-safe. Distinct from switch-equality, which was already wired.
function eq(a: string, b: string): boolean {
  return a === b;
}
const x: string = "hello";
const y: string = "hel" + "lo"; // built at runtime — not the same pointer, must compare by value
console.log(x === y); // true
console.log(x === "world"); // false
console.log(x !== "world"); // true
console.log(x !== y); // false
console.log(eq("", "")); // true
console.log(eq("a", "ab")); // false — prefix is not equal (length differs)
const flag: boolean = x === y && x !== "no";
console.log(flag); // true — used in a compound boolean
