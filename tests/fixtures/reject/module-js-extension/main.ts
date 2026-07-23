// @expect-reject: CS1226
// Node resolves the specifier literally when it runs the same source as the oracle, so a `.js`
// specifier resolves here (bundler-style) but fails there.
import { x } from "./lib.js";
console.log(x);
