// @expect-reject: CS1233
type Json = null | boolean | number | string | Json[];
const j: Json = [1, "a", [true, null]];
console.log(j);
