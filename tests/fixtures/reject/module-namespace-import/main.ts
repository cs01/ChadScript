// @expect-reject: CS1226
// `import * as` needs a runtime module object; the subset has no such value.
import * as lib from "./lib.ts";
console.log(lib.A);
