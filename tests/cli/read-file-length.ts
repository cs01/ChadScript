// Prints the length of the file named by the first argument (see the non-ASCII cli test).
import { readFileSync } from "node:fs";
console.log(readFileSync(process.argv.slice(2)[0] ?? "", "utf8").length);
