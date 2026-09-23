// @known-bug: includes on a plain number[] compares with ===, so NaN is never found; JS uses SameValueZero
const xs: number[] = [1, NaN, 3];
console.log(xs.includes(NaN), xs.indexOf(NaN), [0].includes(-0));
