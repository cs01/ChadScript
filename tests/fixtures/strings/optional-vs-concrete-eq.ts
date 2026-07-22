// ===/!== between an optional (`string | undefined`) and a concrete value. `str.at(i)` is
// `string | undefined`; comparing to a literal: absent never equals a concrete, present unwraps.
const s: string = "hi";
console.log(s.at(0) === "h"); // true — present, inner matches
console.log(s.at(0) !== "h"); // false
console.log(s.at(0) === "x"); // false — present, inner differs
console.log(s.at(5) === "h"); // false — absent (out of range)
console.log(s.at(5) !== "h"); // true — absent !== concrete
console.log("h" === s.at(0)); // true — optional on the right side too

const nums: number[] = [10, 20, 30];
const first = nums.find((n) => n > 15); // number | undefined
console.log(first === 20); // true
console.log(first !== 20); // false
console.log(nums.find((n) => n > 99) === 5); // false — absent
