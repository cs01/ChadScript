import { ArgumentParser } from "chadscript/argparse";

const parser = new ArgumentParser(
  "cwc",
  "Count lines, words, and characters — like wc, but blazing fast",
);
parser.addFlag("lines", "l", "Only show line count");
parser.addFlag("words", "w", "Only show word count");
parser.addFlag("chars", "c", "Only show character count");
parser.addPositional("file", "File to count (reads stdin if omitted)");
parser.parse(process.argv);

const filePath = parser.getPositional(0);

const showLines = parser.getFlag("lines");
const showWords = parser.getFlag("words");
const showChars = parser.getFlag("chars");
const showAll = !showLines && !showWords && !showChars;

let content = "";
let label = "";
if (filePath.length === 0) {
  content = process.stdin.read();
  label = "";
} else {
  content = fs.readFileSync(filePath);
  label = filePath;
}

let lines = 0;
let i = 0;
while (i < content.length) {
  if (content.charAt(i) === "\n") {
    lines = lines + 1;
  }
  i = i + 1;
}

let words = 0;
let inWord = false;
i = 0;
while (i < content.length) {
  const ch = content.charAt(i);
  if (ch === " " || ch === "\n" || ch === "\t" || ch === "\r") {
    if (inWord) {
      words = words + 1;
      inWord = false;
    }
  } else {
    inWord = true;
  }
  i = i + 1;
}
if (inWord) {
  words = words + 1;
}

const chars = content.length;

function pad(n: number): string {
  const s = "" + n;
  if (s.length >= 8) return s;
  let result = "";
  let p = 0;
  while (p < 8 - s.length) {
    result = result + " ";
    p = p + 1;
  }
  return result + s;
}

if (showAll) {
  console.log(pad(lines) + pad(words) + pad(chars) + " " + label);
} else {
  let output = "";
  if (showLines) {
    output = output + pad(lines);
  }
  if (showWords) {
    output = output + pad(words);
  }
  if (showChars) {
    output = output + pad(chars);
  }
  console.log(output + " " + label);
}
