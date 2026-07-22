const nums = new Set<number>([1, 2, 2, 3, 3, 3]);
console.log(nums.size);
console.log(nums.has(2));
console.log(nums.has(9));
const words = ["apple", "banana", "apple", "cherry", "banana"];
const uniq = new Set<string>(words);
console.log(uniq.size);
