// @expect-reject: CS1240
// Arrays are covariant in TS, but a number[] stores raw doubles and a (number | string)[] stores
// Value words; the array is shared by reference, so the reader would decode the wrong words.
const nums: number[] = [1, 2];
const mixed: (number | string)[] = nums;
mixed.push("three");
console.log(nums, mixed);
