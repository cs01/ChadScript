import { readFileSync } from "fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: jsonc-node <file>");
  process.exit(1);
}

let text = readFileSync(file, "utf8");
text = text.replace(/\/\/[^\n]*/g, "");
text = text.replace(/\/\*[\s\S]*?\*\//g, "");
text = text.replace(/,\s*([\]}])/g, "$1");

const parsed = JSON.parse(text);
process.stdout.write(JSON.stringify(parsed) + "\n");
