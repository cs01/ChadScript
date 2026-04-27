let nums: number[] = [1, 2, 3, 4, 5];
nums.push(6);
console.log(nums.length);
console.log(nums[5]);

let popped: number = nums.pop();
console.log(popped);
console.log(nums.length);

console.log(nums.indexOf(3));
console.log(nums.indexOf(99));

console.log(nums.includes(4));
console.log(nums.includes(99));

let sliced: number[] = nums.slice(1, 3);
console.log(sliced.length);
console.log(sliced[0]);
console.log(sliced[1]);

let joined: string = nums.join(", ");
console.log(joined);

let words: string[] = ["foo", "bar", "baz"];
let wJoined: string = words.join(" ");
console.log(wJoined);
