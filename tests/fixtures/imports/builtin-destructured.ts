import { join, dirname, resolve } from "path";

const base = resolve("/tmp");
const full = join(base, "sub", "file.txt");
const dir = dirname(full);
console.log(base);
console.log(full);
console.log(dir);
