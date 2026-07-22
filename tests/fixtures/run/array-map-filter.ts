const nums = [1, 2, 3, 4, 5];
const doubled = nums.map((x: number): number => x * 2);
console.log(doubled.join(","));
const evens = nums.filter((x: number): boolean => x % 2 === 0);
console.log(evens.join(","));
const withIndex = nums.map((x: number, i: number): number => x + i);
console.log(withIndex.join(","));
