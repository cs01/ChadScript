import { join } from "node:path";

console.log(join("a", "b"));
console.log(join("/a", "b", "c"));
console.log(join("a/", "/b"));
console.log(join("a", "", "b"));
console.log(join(""));
console.log(join("a", ".."));
console.log(join("a", "b", "..", "c"));
console.log(join("/", "a"));
console.log(join("..", "a"));
console.log(join("a//b", "c"));
console.log(join("a/b/", ""));
console.log(join("../..", "a"));
console.log(join("a", "../../b"));
console.log(join(".", "a"));
console.log(join("a", "."));
console.log(join("/a/b/c", "../../.."));
