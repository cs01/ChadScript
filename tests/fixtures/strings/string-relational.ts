// String <, >, <=, >= : lexicographic by byte (ASCII-exact), via cs_str_cmp.
const a: string = "apple";
const b: string = "banana";
console.log(a < b); // true
console.log(b < a); // false
console.log(a > b); // false
console.log(a <= a); // true — equal
console.log(a >= a); // true — equal
console.log(a < a); // false — equal is not less
console.log("Z" < "a"); // true — uppercase sorts before lowercase in ASCII
console.log("ab" < "abc"); // true — prefix is less than the longer string
console.log("abc" <= "ab"); // false
