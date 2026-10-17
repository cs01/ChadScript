// The global isNaN/isFinite (not Number.*) on numbers, including NaN from parsing.
const xs: number[] = [1, NaN, Infinity, -Infinity, 0, parseFloat("abc"), Number("12")];
for (const x of xs) {
  console.log(x, isNaN(x), isFinite(x));
}
function isNaNLike(s: string): boolean {
  return isNaN(parseFloat(s));
}
console.log(isNaNLike("3.5"), isNaNLike("x"));
if (!isFinite(1 / 0)) console.log("infinite");
