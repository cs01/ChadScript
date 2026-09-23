// `node:fs` through its namespace and default forms: each `fs.x(...)` is a static reference to
// the same runtime entry the named import lowers to.
import * as fs from "node:fs";
import fsDefault from "node:fs";
import { writeFileSync as write } from "node:fs";

const p = "/tmp/chad-fs-ns-" + process.pid + ".txt";
write(p, "one");
fs.appendFileSync(p, " two");
console.log(fs.readFileSync(p, "utf8"));
console.log(fsDefault.existsSync(p));
fsDefault.unlinkSync(p);
console.log(fs.existsSync(p));
