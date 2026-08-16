// @expect-reject: CS0001
// `relative` is not ported; only the names in the ambient declaration exist.
import { relative } from "node:path";

console.log(relative("/a", "/a/b"));
