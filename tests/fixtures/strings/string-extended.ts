const s = "hello world hello";

console.log(s.lastIndexOf("hello"));
console.log(s.lastIndexOf("xyz"));
console.log(s.lastIndexOf("o"));

console.log(s.replaceAll("hello", "hi"));
console.log("aaa".replaceAll("a", "bb"));
console.log("no match".replaceAll("xyz", "abc"));
