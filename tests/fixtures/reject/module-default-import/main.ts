// @expect-reject: CS1226
// A default export/import has no name to bind to a symbol; every binding in the subset is named.
import helper from "./helper.ts";
console.log(helper());
