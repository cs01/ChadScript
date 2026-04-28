import fs from "fs";
import path from "node:path";
import process from "process";

const tmpFile = path.join(process.cwd(), "__test_fs_rw.tmp");
fs.writeFileSync(tmpFile, "hello from chadscript");
const contents = fs.readFileSync(tmpFile, "utf-8");
console.log(contents);
fs.unlinkSync(tmpFile);
console.log(fs.existsSync(tmpFile));
