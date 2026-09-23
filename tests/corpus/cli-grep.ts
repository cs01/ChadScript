// @category: cli
// @args: -n -i was fixtures/words.txt
// A tiny grep: flags -n (line numbers), -i (ignore case), -c (count only), -v (invert).
import { readFileSync } from "node:fs";

interface Options {
  lineNumbers: boolean;
  ignoreCase: boolean;
  countOnly: boolean;
  invert: boolean;
  pattern: string;
  files: string[];
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    lineNumbers: false,
    ignoreCase: false,
    countOnly: false,
    invert: false,
    pattern: "",
    files: [],
  };
  const positional: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith("-") && arg.length > 1) {
      for (const flag of arg.slice(1)) {
        switch (flag) {
          case "n":
            opts.lineNumbers = true;
            break;
          case "i":
            opts.ignoreCase = true;
            break;
          case "c":
            opts.countOnly = true;
            break;
          case "v":
            opts.invert = true;
            break;
          default:
            console.error(`grep: unknown flag -${flag}`);
            process.exit(2);
        }
      }
    } else {
      positional.push(arg);
    }
  }
  if (positional.length < 2) {
    console.error("usage: grep [-nicv] pattern file...");
    process.exit(2);
  }
  opts.pattern = positional[0]!;
  opts.files = positional.slice(1);
  return opts;
}

function matches(line: string, opts: Options): boolean {
  const hay = opts.ignoreCase ? line.toLowerCase() : line;
  const needle = opts.ignoreCase ? opts.pattern.toLowerCase() : opts.pattern;
  const found = hay.includes(needle);
  return opts.invert ? !found : found;
}

const opts = parseArgs(process.argv.slice(2));
let total = 0;
for (const file of opts.files) {
  const lines = readFileSync(file, "utf8").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  let count = 0;
  lines.forEach((line, i) => {
    if (!matches(line, opts)) return;
    count++;
    if (opts.countOnly) return;
    const prefix = opts.files.length > 1 ? `${file}:` : "";
    console.log(opts.lineNumbers ? `${prefix}${i + 1}:${line}` : `${prefix}${line}`);
  });
  if (opts.countOnly) console.log(opts.files.length > 1 ? `${file}:${count}` : String(count));
  total += count;
}
process.exit(total > 0 ? 0 : 1);
