import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const dtsPath = path.join(root, "chadscript.d.ts");
const outPath = path.join(root, "src", "codegen", "stdlib", "embedded-dts.ts");

const dtsContent = fs.readFileSync(dtsPath, "utf8");

const escaped = dtsContent.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n");

const output = `export function getDtsContent(): string {\n  return '${escaped}';\n}\n`;

fs.writeFileSync(outPath, output);
