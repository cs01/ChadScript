// @expect-reject: CS1240
// The generic body stores T as Value words; the caller's number[] holds raw doubles and is shared.
function firstOf<T>(xs: T[]): T | undefined {
  return xs[0];
}
const nums = [1, 2];
console.log(firstOf(nums));
