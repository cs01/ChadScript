// @category: text
// Classic word-frequency count: normalize, drop stop words, rank, and print a bar chart.
import { readFileSync } from "node:fs";

const STOP_WORDS = new Set(["the", "of", "it", "a", "to", "we", "us", "all", "and"]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

function frequencies(words: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const w of words) {
    if (STOP_WORDS.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  return freq;
}

const text = readFileSync("fixtures/words.txt", "utf8");
const words = tokenize(text);
const freq = frequencies(words);
const ranked = [...freq.entries()].sort((a, b) => {
  if (b[1] !== a[1]) return b[1] - a[1];
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
});

console.log(`total words: ${words.length}, distinct (no stop words): ${freq.size}`);
const longest = Math.max(...ranked.slice(0, 10).map(([w]) => w.length));
for (const [word, n] of ranked.slice(0, 10)) {
  console.log(`${word.padEnd(longest)} | ${"*".repeat(n)} (${n})`);
}

const byLength = new Map<number, string[]>();
for (const w of freq.keys()) {
  const list = byLength.get(w.length) ?? [];
  list.push(w);
  byLength.set(w.length, list);
}
const lengths = [...byLength.keys()].sort((a, b) => a - b);
for (const len of lengths) {
  console.log(`${len}: ${byLength.get(len)!.sort().join(" ")}`);
}
const avg = words.reduce((s, w) => s + w.length, 0) / words.length;
console.log(`average word length: ${avg.toFixed(3)}`);
