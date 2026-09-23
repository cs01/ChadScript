// @category: cli
// @args: fixtures/words.txt fixtures/doc.md
// A `wc` clone: counts lines, words and bytes for each file given on the command line.
import { readFileSync } from "node:fs";

interface Counts {
  lines: number;
  words: number;
  chars: number;
}

function count(text: string): Counts {
  let lines = 0;
  let words = 0;
  let inWord = false;
  for (const ch of text) {
    if (ch === "\n") lines++;
    const isSpace = ch === " " || ch === "\n" || ch === "\t" || ch === "\r";
    if (isSpace) {
      inWord = false;
    } else if (!inWord) {
      inWord = true;
      words++;
    }
  }
  return { lines, words, chars: text.length };
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, " ");
}

function main(args: string[]): void {
  if (args.length === 0) {
    console.log("usage: wc <file>...");
    process.exit(2);
  }
  const total: Counts = { lines: 0, words: 0, chars: 0 };
  for (const file of args) {
    const c = count(readFileSync(file, "utf8"));
    total.lines += c.lines;
    total.words += c.words;
    total.chars += c.chars;
    console.log(`${pad(c.lines, 8)}${pad(c.words, 8)}${pad(c.chars, 8)} ${file}`);
  }
  if (args.length > 1) {
    console.log(`${pad(total.lines, 8)}${pad(total.words, 8)}${pad(total.chars, 8)} total`);
  }
}

main(process.argv.slice(2));
