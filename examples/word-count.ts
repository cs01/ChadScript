// Word Count CLI - Count lines, words, and characters in a file
// Usage: ./word-count <filename>

function countStats(content: string): void {
  let lines = 0;
  let words = 0;
  let chars = content.length;

  // Count lines
  let i = 0;
  while (i < content.length) {
    if (content.charAt(i) === "\n") {
      lines = lines + 1;
    }
    i = i + 1;
  }

  // Count words (split by spaces)
  const wordArray = content.split(" ");
  words = wordArray.length;

  console.log("Lines: ");
  console.log(lines);
  console.log("Words: ");
  console.log(words);
  console.log("Chars: ");
  console.log(chars);
}

// Main
if (process.argv.length < 2) {
  console.log("Usage: word-count <filename>");
  process.exit(1);
}

const filename = process.argv[1];
const content = fs.readFileSync(filename);
countStats(content);
process.exit(0);
