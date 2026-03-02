// Word Count - count lines, words, and characters in files (like wc)
import { ArgumentParser } from "chadscript/argparse";

const parser = new ArgumentParser("word-count", "Count lines, words, and characters in a file");
parser.addFlag("lines", "l", "Only show line count");
parser.addFlag("words", "w", "Only show word count");
parser.addFlag("chars", "c", "Only show character count");
parser.addPositional("file", "File to count");
parser.parse(process.argv);

const filePath = parser.getPositional(0);
if (filePath.length === 0) {
  console.error("word-count: missing file argument");
  console.error("Try 'word-count --help' for more information");
  process.exit(1);
}

const showLines = parser.getFlag("lines");
const showWords = parser.getFlag("words");
const showChars = parser.getFlag("chars");
// If no specific flag, show all
const showAll = !showLines && !showWords && !showChars;

const content = fs.readFileSync(filePath);

// Count lines
let lines = 0;
let i = 0;
while (i < content.length) {
  if (content.charAt(i) === "\n") {
    lines = lines + 1;
  }
  i = i + 1;
}

// Count words (split by spaces)
const wordArray = content.split(" ");
const words = wordArray.length;
const chars = content.length;

if (showAll) {
  console.log("  " + lines + " lines  " + words + " words  " + chars + " chars  " + filePath);
} else {
  if (showLines) {
    console.log("  " + lines + " " + filePath);
  }
  if (showWords) {
    console.log("  " + words + " " + filePath);
  }
  if (showChars) {
    console.log("  " + chars + " " + filePath);
  }
}
