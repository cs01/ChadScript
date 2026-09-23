// @expect-reject: CS1233
// Two array types in one union: a Value word only says "array", and number[] and string[] store
// their elements differently, so a printed or narrowed element could not be decoded.
function pick(flag: boolean): number[] | string[] {
  return flag ? [1, 2] : ["a"];
}
console.log(pick(true));
