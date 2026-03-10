import { readFileSync, writeFileSync } from "fs";
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
writeFileSync("src/version.ts", `export const VERSION = "${pkg.version}";\n`);
