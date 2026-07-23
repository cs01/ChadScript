// Number.isInteger / isFinite / isNaN — no argument coercion (unlike the global isNaN).
console.log(Number.isInteger(5), Number.isInteger(5.5), Number.isInteger(-3), Number.isInteger(0));
console.log(Number.isInteger(NaN), Number.isInteger(1 / 0), Number.isInteger(4.0));
console.log(Number.isFinite(1), Number.isFinite(1e308), Number.isFinite(1 / 0));
console.log(Number.isFinite(-1 / 0), Number.isFinite(NaN));
console.log(Number.isNaN(NaN), Number.isNaN(0 / 0), Number.isNaN(5), Number.isNaN(1 / 0));
const xs = [1, 2.5, -3, 4.0, NaN, 1 / 0];
for (const x of xs) {
  console.log(x, Number.isInteger(x), Number.isFinite(x), Number.isNaN(x));
}
