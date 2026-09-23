// @expect-reject: CS1226
// Printing a module namespace would need the module object Node builds at runtime.
import * as path from "node:path";

console.log(path);
