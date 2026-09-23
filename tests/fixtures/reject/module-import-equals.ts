// @expect-reject: CS1226
// `import x = require(...)` is TypeScript's CommonJS import form.
import path = require("node:path");

console.log(path.join("a", "b"));
