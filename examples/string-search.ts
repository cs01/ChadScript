import { ArgumentParser } from "../lib/argparse.js";

const parser = new ArgumentParser("string-search", "Search for a string pattern in files");
parser.addFlag("ignore-case", "i", "Case-insensitive search");
parser.addFlag("line-number", "n", "Show line numbers");
parser.addFlag("count", "c", "Only print a count of matching lines per file");
parser.addFlag("recursive", "r", "Recursively search directories");
parser.addFlag("invert-match", "v", "Select non-matching lines");
parser.addPositional("pattern", "The string to search for");
parser.addPositional("file", "File or directory to search");
parser.parse(process.argv);

const pattern = parser.getPositional(0);
const target = parser.getPositional(1);

if (pattern.length === 0 || target.length === 0) {
  console.error("string-search: missing pattern or file argument");
  console.error("Try 'string-search --help' for more information");
  process.exit(2);
}

const ignoreCase = parser.getFlag("ignore-case");
const showLineNumbers = parser.getFlag("line-number");
const countOnly = parser.getFlag("count");
const recursive = parser.getFlag("recursive");
const invertMatch = parser.getFlag("invert-match");

let searchPattern = pattern;
if (ignoreCase) {
  searchPattern = pattern.toLowerCase();
}

let totalMatches = 0;

function matchesLine(line: string): boolean {
  let haystack = line;
  if (ignoreCase) {
    haystack = line.toLowerCase();
  }
  const found = haystack.indexOf(searchPattern) !== -1;
  if (invertMatch) {
    return !found;
  }
  return found;
}

function searchFile(filePath: string, showPrefix: boolean): void {
  const content = fs.readFileSync(filePath);
  if (content.length === 0) {
    return;
  }

  const lines = content.split("\n");
  let matchCount = 0;
  let lineNum = 0;

  while (lineNum < lines.length) {
    if (matchesLine(lines[lineNum])) {
      matchCount = matchCount + 1;
      if (!countOnly) {
        let output = "";
        if (showPrefix) {
          output = filePath + ":";
        }
        if (showLineNumbers) {
          output = output + (lineNum + 1) + ":";
        }
        output = output + lines[lineNum];
        console.log(output);
      }
    }
    lineNum = lineNum + 1;
  }

  if (countOnly) {
    if (showPrefix) {
      console.log(filePath + ":" + matchCount);
    } else {
      console.log(matchCount);
    }
  }

  totalMatches = totalMatches + matchCount;
}

function searchDir(dirPath: string): void {
  const entries = fs.readdirSync(dirPath);
  let i = 0;
  while (i < entries.length) {
    const entryPath = dirPath + "/" + entries[i];
    const info = fs.statSync(entryPath);
    if (info.isFile()) {
      searchFile(entryPath, true);
    } else if (info.isDirectory()) {
      searchDir(entryPath);
    }
    i = i + 1;
  }
}

function main(): void {
  const info = fs.statSync(target);

  if (info.isDirectory()) {
    if (!recursive) {
      console.error("string-search: " + target + ": Is a directory (use -r to search recursively)");
      process.exit(2);
    }
    searchDir(target);
  } else {
    searchFile(target, false);
  }

  if (totalMatches === 0) {
    process.exit(1);
  }
  process.exit(0);
}

main();
