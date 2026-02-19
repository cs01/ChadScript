import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const NEEDLE = "console.log";
const SEARCH_DIR = "src";

let totalMatches = 0;

function searchFile(filePath) {
  const content = readFileSync(filePath, "utf8");
  if (content.length === 0) return;
  const lines = content.split("\n");
  for (const line of lines) {
    if (line.indexOf(NEEDLE) !== -1) {
      totalMatches++;
    }
  }
}

function searchDir(dirPath) {
  const entries = readdirSync(dirPath);
  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    const st = statSync(fullPath);
    if (st.isFile()) {
      searchFile(fullPath);
    } else if (st.isDirectory()) {
      searchDir(fullPath);
    }
  }
}

const start = performance.now();

searchDir(SEARCH_DIR);

const elapsed = (performance.now() - start) / 1000;

console.log(`Matches:  ${totalMatches}`);
console.log(`Time:     ${elapsed.toFixed(3)}s`);
