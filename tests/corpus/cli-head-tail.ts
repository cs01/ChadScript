// @category: cli
// @args: -n 2 fixtures/words.txt fixtures/graph.txt
// `head` and `tail` in one tool: prints the first and last N lines of each file with a header,
// the way the coreutils versions do for several files.
import { readFileSync, existsSync } from "node:fs";

function parse(argv: string[]): { n: number; files: string[] } {
  let n = 10;
  const files: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-n") {
      const v = argv[i + 1];
      i++;
      if (v === undefined || !/^\d+$/.test(v)) {
        console.log("head-tail: -n needs a non-negative integer");
        process.exit(2);
      }
      n = parseInt(v, 10);
    } else if (a !== undefined) {
      files.push(a);
    }
  }
  return { n, files };
}

function lines(text: string): string[] {
  const out = text.split("\n");
  if (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}

const { n, files } = parse(process.argv.slice(2));
let status = 0;
for (let i = 0; i < files.length; i++) {
  const file = files[i] as string;
  if (!existsSync(file)) {
    console.log(`head-tail: cannot open '${file}' for reading: No such file or directory`);
    status = 1;
    continue;
  }
  const all = lines(readFileSync(file, "utf8"));
  if (files.length > 1) console.log(`${i > 0 ? "\n" : ""}==> ${file} <==`);
  const head = all.slice(0, n);
  const tail = all.slice(Math.max(n, all.length - n));
  for (const line of head) console.log(line);
  if (tail.length > 0) {
    const skipped = all.length - head.length - tail.length;
    if (skipped > 0) console.log(`... (${skipped} more lines) ...`);
    for (const line of tail) console.log(line);
  }
}
process.exit(status);
