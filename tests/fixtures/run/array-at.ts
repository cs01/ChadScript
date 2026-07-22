const arr = [10, 20, 30, 40];
console.log(arr.at(0) ?? -1);
console.log(arr.at(-1) ?? -1);
console.log(arr.at(-2) ?? -1);
console.log(arr.at(4) ?? -1);
console.log(arr.at(-5) ?? -1);
const words = ["a", "b", "c"];
console.log(words.at(-1) ?? "none");
console.log(words.at(5) ?? "none");
