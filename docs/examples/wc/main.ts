// @args: docs/examples/wc/poem.txt docs/examples/wc/missing.txt docs/examples/wc/notes.txt
// A small `wc`: line, word and byte counts per file, a total, and exit status 1 if any file
// could not be read.
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

interface Counts {
  lines: number;
  words: number;
  bytes: number;
}

function count(text: string): Counts {
  const words = text
    .split("\n")
    .join(" ")
    .split(" ")
    .filter((w: string): boolean => w !== "");
  return {
    lines: text.split("\n").length - 1,
    words: words.length,
    bytes: text.length, // ASCII input: one byte per character
  };
}

function row(c: Counts, label: string): string {
  const cols = [c.lines, c.words, c.bytes].map((n: number): string => String(n).padStart(6));
  return `${cols.join("")} ${label}`;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.log("usage: wc <file>...");
  process.exit(2);
}

const total: Counts = { lines: 0, words: 0, bytes: 0 };
let failed = false;
for (const file of files) {
  if (!existsSync(file)) {
    console.log(`wc: ${basename(file)}: no such file`);
    failed = true;
    continue;
  }
  const c = count(readFileSync(file, "utf8"));
  total.lines += c.lines;
  total.words += c.words;
  total.bytes += c.bytes;
  console.log(row(c, basename(file)));
}
console.log(row(total, "total"));
if (failed) process.exit(1);
