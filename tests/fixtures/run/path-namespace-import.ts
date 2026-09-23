// `node:path` through its namespace and default forms, plus a renamed named import.
import * as path from "node:path";
import pathDefault from "node:path";
import { basename as base } from "node:path";

console.log(path.join("a", "b", "../c"));
console.log(pathDefault.dirname("/x/y/z.txt"), pathDefault.extname("z.tar.gz"));
console.log(base("/x/y/z.txt"), path.isAbsolute("/x"), path.normalize("a//b/./c"));
