import fs from "fs";
import path from "node:path";

const tmpDir = path.join("/tmp", "__chadscript_readdir_test");
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir);
}
fs.writeFileSync(path.join(tmpDir, "only.txt"), "x");
const entries = fs.readdirSync(tmpDir);
console.log(entries.length);
console.log(entries[0]);
fs.unlinkSync(path.join(tmpDir, "only.txt"));
