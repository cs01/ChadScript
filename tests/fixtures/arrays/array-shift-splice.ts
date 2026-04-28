const nums: number[] = [1, 2, 3, 4, 5];
const first: number = nums.shift();
console.log(first);
console.log(nums.length);
console.log(nums[0]);

nums.unshift(10);
console.log(nums.length);
console.log(nums[0]);

const removed: number[] = nums.splice(1, 2);
console.log(removed.length);
console.log(removed[0]);
console.log(removed[1]);
console.log(nums.length);
console.log(nums.join(","));

const strs: string[] = ["a", "b", "c"];
const s: string = strs.shift();
console.log(s);
console.log(strs.length);

strs.unshift("z");
console.log(strs[0]);
console.log(strs.join(","));
