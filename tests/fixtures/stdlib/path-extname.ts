import path from "node:path";

console.log(path.extname("index.html"));
console.log(path.extname("archive.tar.gz"));
console.log(path.extname(".hidden"));
console.log(path.extname("noext"));
console.log(path.extname("/path/to/file.ts"));
