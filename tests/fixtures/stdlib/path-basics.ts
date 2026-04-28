import path from "node:path";

console.log(path.basename("/foo/bar/baz.ts"));
console.log(path.dirname("/foo/bar/baz.ts"));
console.log(path.extname("/foo/bar/baz.ts"));
console.log(path.extname("noext"));
console.log(path.join("foo", "bar"));
console.log(path.join("/foo", "bar", "baz"));
console.log(path.dirname("foo"));
console.log(path.basename("file.txt"));
console.log(path.sep);
