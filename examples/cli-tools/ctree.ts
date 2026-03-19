import { ArgumentParser } from "chadscript/argparse";

const parser = new ArgumentParser("ctree", "Display directory tree — like tree, but blazing fast");
parser.addFlag("all", "a", "Show hidden files");
parser.addFlag("dirs-only", "d", "Only show directories");
parser.addOption("level", "L", "Max display depth", "0");
parser.addFlag("size", "s", "Show file sizes");
parser.addFlag("no-color", "C", "Disable colorized output");
parser.addPositional("dir", "Directory to display (default: .)");
parser.parse(process.argv);

let root = parser.getPositional(0);
if (root.length === 0) {
  root = ".";
}

const showAll = parser.getFlag("all");
const dirsOnly = parser.getFlag("dirs-only");
const maxLevelStr = parser.getOption("level");
let maxLevel = 0;
if (maxLevelStr !== "0") {
  maxLevel = parseInt(maxLevelStr);
}
const showSize = parser.getFlag("size");
const noColor = parser.getFlag("no-color");

const colorBlue = "\x1b[1;34m";
const colorGreen = "\x1b[32m";
const colorCyan = "\x1b[36m";
const colorYellow = "\x1b[33m";
const colorReset = "\x1b[0m";

let dirCount = 0;
let fileCount = 0;

function formatSize(size: number): string {
  if (size < 1024) return "" + size + "B";
  if (size < 1048576) return "" + Math.floor(size / 1024) + "K";
  if (size < 1073741824) return "" + Math.floor(size / 1048576) + "M";
  return "" + Math.floor(size / 1073741824) + "G";
}

function colorize(name: string, isDir: boolean): string {
  if (noColor) return name;
  if (isDir) return colorBlue + name + colorReset;
  if (name.endsWith(".ts") || name.endsWith(".js")) return colorGreen + name + colorReset;
  if (name.endsWith(".json") || name.endsWith(".yaml") || name.endsWith(".yml"))
    return colorCyan + name + colorReset;
  if (name.endsWith(".sh") || name.endsWith(".bash")) return colorYellow + name + colorReset;
  return name;
}

function printTree(dirPath: string, prefix: string, depth: number): void {
  if (maxLevel > 0 && depth >= maxLevel) return;

  const entries = fs.readdirSync(dirPath);
  const filtered: string[] = [];
  let i = 0;
  while (i < entries.length) {
    const name = entries[i];
    if (!showAll && name.charAt(0) === ".") {
      i = i + 1;
      continue;
    }
    const entryPath = dirPath + "/" + name;
    const info = fs.statSync(entryPath);
    if (dirsOnly && info.isFile()) {
      i = i + 1;
      continue;
    }
    filtered.push(name);
    i = i + 1;
  }

  let idx = 0;
  while (idx < filtered.length) {
    const name = filtered[idx];
    const entryPath = dirPath + "/" + name;
    const info = fs.statSync(entryPath);
    const isLast = idx === filtered.length - 1;
    const connector = isLast ? "\u2514\u2500\u2500 " : "\u251c\u2500\u2500 ";
    const extension = isLast ? "    " : "\u2502   ";

    let line = prefix + connector;
    if (showSize && info.isFile()) {
      line = line + "[" + formatSize(info.size) + "] ";
    }
    line = line + colorize(name, info.isDirectory());

    console.log(line);

    if (info.isDirectory()) {
      dirCount = dirCount + 1;
      printTree(entryPath, prefix + extension, depth + 1);
    } else {
      fileCount = fileCount + 1;
    }
    idx = idx + 1;
  }
}

console.log(colorize(root, true));
dirCount = 1;
printTree(root, "", 0);

let summary = "\n" + dirCount + " director";
if (dirCount === 1) {
  summary = summary + "y";
} else {
  summary = summary + "ies";
}
if (!dirsOnly) {
  summary = summary + ", " + fileCount + " file";
  if (fileCount !== 1) {
    summary = summary + "s";
  }
}
console.log(summary);
