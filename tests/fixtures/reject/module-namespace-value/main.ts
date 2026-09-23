// @expect-reject: CS1226
// A namespace import has no runtime object: `lib.A` is a static reference, but `lib` alone is not
// a value that can be stored, passed or printed.
import * as lib from "./lib";

const n = lib;
console.log(n.A);
