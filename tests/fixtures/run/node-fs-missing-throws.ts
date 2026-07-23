// A missing path THROWS, exactly as Node does, so `try`/`catch` is the way to handle it — the
// runtime never returns a sentinel a caller could ignore. `existsSync` is the non-throwing answer.
// The message text is not compared: it is not reachable from the subset (no `as Error` yet).

import { readFileSync, unlinkSync, existsSync } from "node:fs";

const missing: string = "/tmp/chadscript-fixture-absent-" + process.pid + ".txt";

console.log(existsSync(missing));

try {
  const body: string = readFileSync(missing, "utf8");
  console.log("unreachable " + body);
} catch (e) {
  console.log("read threw");
}

try {
  unlinkSync(missing);
  console.log("unreachable");
} catch (e) {
  console.log("unlink threw");
}

console.log("still running");
