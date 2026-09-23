// @expect-reject: CS1226
// CommonJS `require` is not part of the ESM subset.
const fs = require("node:fs");

console.log(fs.existsSync("/tmp"));
