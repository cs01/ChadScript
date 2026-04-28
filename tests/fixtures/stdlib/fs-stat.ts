import fs from "fs";

console.log(fs.statSync("package.json").isFile());
console.log(fs.statSync("package.json").isDirectory());
console.log(fs.statSync("src").isFile());
console.log(fs.statSync("src").isDirectory());
