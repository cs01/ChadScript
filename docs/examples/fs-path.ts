// node:fs (sync and promises) and node:path. The path includes the pid so concurrent runs of
// the same program (the test harness runs Node and two native builds at once) do not collide.
import { writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as path from "node:path";

const file = path.join("/tmp", `chad-docs-${process.pid}`, "..", `notes-${process.pid}.txt`);
console.log(path.basename(file).startsWith("notes-"), path.extname(file), path.dirname(file));

writeFileSync(file, "line one\nline two\n");
const lines = readFileSync(file, "utf8").trimEnd().split("\n");
console.log(lines.length, lines[1]);

async function main(): Promise<void> {
  const text = await readFile(file, "utf8");
  console.log("async read", text.length, "bytes");
  unlinkSync(file);
  console.log("exists after unlink:", existsSync(file));
}
main();
