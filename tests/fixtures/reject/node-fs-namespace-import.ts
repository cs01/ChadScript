// @expect-reject: CS1226
// `node:fs` is importable, but only by name: `import * as` needs a runtime module object.
import * as fs from "node:fs";
console.log(fs.existsSync("/tmp"));
