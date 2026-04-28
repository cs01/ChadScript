const s = "hello world hello";

console.log(s.lastIndexOf("hello"));
console.log(s.lastIndexOf("xyz"));
console.log(s.lastIndexOf("o"));

console.log(s.replaceAll("hello", "hi"));
console.log("aaa".replaceAll("a", "bb"));
console.log("no match".replaceAll("xyz", "abc"));

console.log("abcde".at(0));
console.log("abcde".at(-1));
console.log("abcde".at(2));

const nums = [10, 20, 30, 40, 50];
console.log(nums.at(0));
console.log(nums.at(-1));
console.log(nums.at(2));

const words = ["alpha", "beta", "gamma"];
console.log(words.at(0));
console.log(words.at(-1));
