const arr = [3, 1, 4, 1, 5, 9];
arr.sort((a: number, b: number) => a - b);
console.log(arr);

const desc = [3, 1, 4, 1, 5, 9];
desc.sort((a: number, b: number) => b - a);
console.log(desc);

const nums = [5, 2, 8, 1, 9];
nums.sort();
console.log(nums);
