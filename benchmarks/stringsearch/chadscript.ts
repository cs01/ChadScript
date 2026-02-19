const NEEDLE = "console.log";
const SEARCH_DIR = "src";

let totalMatches = 0;

function searchFile(filePath: string): void {
  const content = fs.readFileSync(filePath);
  if (content.length === 0) {
    return;
  }
  const lines = content.split("\n");
  let i = 0;
  while (i < lines.length) {
    if (lines[i].indexOf(NEEDLE) !== -1) {
      totalMatches = totalMatches + 1;
    }
    i = i + 1;
  }
}

function searchDir(dirPath: string): void {
  const entries = fs.readdirSync(dirPath);
  let i = 0;
  while (i < entries.length) {
    const entryPath = dirPath + "/" + entries[i];
    const info = fs.statSync(entryPath);
    if (info.isFile()) {
      searchFile(entryPath);
    } else if (info.isDirectory()) {
      searchDir(entryPath);
    }
    i = i + 1;
  }
}

function run(): void {
  const start = Date.now();

  searchDir(SEARCH_DIR);

  const elapsed = (Date.now() - start) / 1000;

  console.log("Matches:  " + totalMatches);
  console.log("Time:     " + elapsed + "s");
}

run();
