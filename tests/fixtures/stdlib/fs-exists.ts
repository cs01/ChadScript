import fs from "fs";

console.log(fs.existsSync("package.json"));
console.log(fs.existsSync("__nonexistent_file_xyz__"));
