// @category: cli
// @args: fixtures/doc.md Project Program --out doc.edited.md --whole-word
// A find-and-replace CLI: literal search (optionally whole-word and case-insensitive), a count of
// replacements per line, and the edited file written to --out.
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

interface Opts {
  file: string;
  find: string;
  replace: string;
  out: string;
  wholeWord: boolean;
  ignoreCase: boolean;
}

function parseArgs(argv: string[]): Opts {
  const positional: string[] = [];
  let out = "";
  let wholeWord = false;
  let ignoreCase = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--out") out = argv[++i] ?? "";
    else if (a === "--whole-word") wholeWord = true;
    else if (a === "-i") ignoreCase = true;
    else positional.push(a);
  }
  const [file, find, replace] = positional;
  if (!file || !find || replace === undefined) {
    console.log("usage: replace <file> <find> <replace> [--out file] [--whole-word] [-i]");
    process.exit(2);
  }
  return { file, find, replace, out: out || `${basename(file)}.out`, wholeWord, ignoreCase };
}

function isWordChar(c: string | undefined): boolean {
  return c !== undefined && /[A-Za-z0-9_]/.test(c);
}

function replaceLine(line: string, o: Opts): { text: string; count: number } {
  const hay = o.ignoreCase ? line.toLowerCase() : line;
  const needle = o.ignoreCase ? o.find.toLowerCase() : o.find;
  let out = "";
  let count = 0;
  let i = 0;
  while (i < line.length) {
    const at = hay.indexOf(needle, i);
    if (at < 0) break;
    const ok = !o.wholeWord || (!isWordChar(line[at - 1]) && !isWordChar(line[at + needle.length]));
    out += line.slice(i, at) + (ok ? o.replace : line.slice(at, at + needle.length));
    if (ok) count++;
    i = at + needle.length;
  }
  return { text: out + line.slice(i), count };
}

const opts = parseArgs(process.argv.slice(2));
const lines = readFileSync(opts.file, "utf8").split("\n");
let total = 0;
const edited = lines.map((line, n) => {
  const r = replaceLine(line, opts);
  if (r.count > 0) console.log(`${opts.file}:${n + 1}: ${r.count} replacement(s): ${r.text}`);
  total += r.count;
  return r.text;
});
writeFileSync(opts.out, edited.join("\n"));
console.log(`${total} replacement(s) written to ${opts.out}`);
console.log(
  replaceLine("Projects and project and Project!", { ...opts, ignoreCase: true, wholeWord: true }),
);
