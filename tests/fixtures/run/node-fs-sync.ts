// Synchronous `node:fs`. The path is keyed on `process.pid` because the oracle, the -O0 binary
// and the -O2 binary all run CONCURRENTLY — a fixed path would have three processes writing and
// unlinking the same file. The pid itself is never printed (its value necessarily differs).

import { readFileSync, writeFileSync, appendFileSync, existsSync, unlinkSync } from "node:fs";

const path: string = "/tmp/chadscript-fixture-fs-" + process.pid + ".txt";

console.log(existsSync(path));

writeFileSync(path, "hello\n");
console.log(existsSync(path));
console.log(readFileSync(path, "utf8"));

// Append extends; write truncates.
appendFileSync(path, "world\n");
const both: string = readFileSync(path, "utf8");
console.log(both.length);
console.log(both);
writeFileSync(path, "x");
console.log(readFileSync(path, "utf8"));

// A file that was never created: append creates it, like Node.
const fresh: string = "/tmp/chadscript-fixture-fs-append-" + process.pid + ".txt";
appendFileSync(fresh, "made by append\n");
console.log(readFileSync(fresh, "utf8"));

unlinkSync(path);
unlinkSync(fresh);
console.log(existsSync(path));
console.log(existsSync(fresh));
