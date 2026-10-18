// String indexing, for...of, relational order and charCodeAt over ASCII strings (the only
// strings a program can hold: runtime/ascii-gate.milo), where bytes are UTF-16 code units.
const s = "hello, World";
console.log(s[0], s[4], s[100], s[-1], s[1.5], s[-0]);
let n = 0;
for (const c of s) if (c === "l") n++;
console.log(n);
console.log("apple" < "banana", "Z" < "a", "abc" <= "abc", "abd" > "abc", "" < "a", "ab" < "abc");
console.log(s.charCodeAt(0), s.charCodeAt(99), s.charCodeAt(-1));
const words = ["pear", "Apple", "fig", "apple"];
words.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
console.log(words);
const t = s[2];
if (t !== undefined) console.log(t.toUpperCase());
console.log(s[0]! + s[1]!);
const hex = "0123456789abcdef";
let code = 0;
for (let i = 0; i < hex.length; i++) code = (code * 31 + hex.charCodeAt(i)) % 1000003;
console.log(code, hex.charCodeAt(2.9), hex.charCodeAt(NaN));
const pairs: string[] = [];
for (const a of ["", "a", "A", "aa", "b", "~", " "]) {
  for (const b of ["", "a", "A", "aa", "b"]) if (a < b) pairs.push(`${a}<${b}`);
}
console.log(pairs.join(" "));
let reversed = "";
for (const ch of "stressed") reversed = ch + reversed;
console.log(reversed, "x"[0], ""[0]);
