// Math.imul / Math.clz32 (ToInt32 / ToUint32 semantics, wraparound) and Math.fround (binary32
// rounding), over edge values and a sweep.
const vals: number[] = [
  0,
  -0,
  1,
  -1,
  2,
  3.7,
  -3.7,
  0.5,
  255,
  65535,
  65536,
  2147483647,
  2147483648,
  -2147483648,
  4294967295,
  4294967296,
  4294967297,
  1e10,
  -1e10,
  1e300,
  5e-324,
  NaN,
  Infinity,
  -Infinity,
  0x7fffffff * 3,
  123456789,
  -987654321,
  9007199254740992,
  9007199254740994,
];
for (const a of vals) {
  console.log(a, Math.clz32(a), Math.fround(a), Math.imul(a, 3), Math.imul(a, -1), Math.imul(a, a));
}
console.log(Math.imul(0xffffffff, 5), Math.imul(0x7fffffff, 0x7fffffff), Math.imul(-5, 12));
// FNV-1a style hashing, the usual reason programs reach for imul.
let h = 2166136261;
const text = "the quick brown fox";
for (let i = 0; i < text.length; i++) {
  h = h ^ (text.charAt(i).length * (i + 97));
  h = Math.imul(h, 16777619) >>> 0;
}
console.log(h);
let x = 1;
for (let i = 0; i < 40; i++) {
  x = x * 1.37 + 0.1;
  console.log(i, Math.fround(x), Math.fround(-x / 7), Math.clz32(x), Math.imul(x, 2654435761));
}
console.log(Math.fround(0.1), Math.fround(1.1) === 1.1, Math.fround(3.4028235677973366e38));
console.log(
  Math.fround(3.4028236e38),
  Math.fround(1e-46),
  Math.fround(-1e-46),
  Math.fround(1.5e-45),
);
console.log([1.1, 2.2, 3.3].map(Math.fround), [0, 1, 1024].map(Math.clz32));
