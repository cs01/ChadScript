const nums: number[] = [3, 1, 4, 1, 5, 9];

nums.reverse();
console.log(nums[0]);
console.log(nums[5]);

nums.sort();
console.log(nums[0]);
console.log(nums[5]);

const a: number[] = [1, 2];
const b: number[] = [3, 4];
const c: number[] = a.concat(b);
console.log(c.length);
console.log(c[0]);
console.log(c[3]);

const strs: string[] = ["hello", "world", "foo"];
console.log(strs.indexOf("world"));
console.log(strs.indexOf("bar"));
console.log(strs.includes("foo"));
console.log(strs.includes("baz"));

const sslice: string[] = strs.slice(0, 2);
console.log(sslice.length);
console.log(sslice[0]);
console.log(sslice[1]);

strs.reverse();
console.log(strs[0]);
console.log(strs[2]);

const s1: string[] = ["a", "b"];
const s2: string[] = ["c", "d"];
const s3: string[] = s1.concat(s2);
console.log(s3.length);
console.log(s3[0]);
console.log(s3[3]);
