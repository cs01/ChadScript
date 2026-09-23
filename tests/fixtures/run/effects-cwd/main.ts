// The effects oracle end to end: each run starts in its own working directory holding a private
// copy of this fixture's `fixtures/` directory. The program reads its input by a relative path,
// rewrites that input, creates and deletes files, and exits non-zero; the harness compares the
// resulting directory trees (names and bytes) and the exit code, not just stdout.
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

const input: string = readFileSync("fixtures/input.txt", "utf8");
const lines: string[] = input.split("\n").filter((l) => l.length > 0);
console.log(lines.length);

writeFileSync("report.txt", "lines: " + lines.length + "\n");
for (const line of lines) {
  appendFileSync("report.txt", line.toUpperCase() + "\n");
}

// Rewriting the input must stay private to this run.
writeFileSync("fixtures/input.txt", "consumed\n");

writeFileSync("scratch.tmp", "temporary");
unlinkSync("scratch.tmp");
console.log(existsSync("scratch.tmp"), existsSync("report.txt"));
process.exit(3);
