// Fixture auto-discovery. No registry: a file's annotations decide how it is tested.
//   // @expect-reject: CS1203   → rejection fixture, must fail with that exact code
//   // @args: alpha beta        → command-line arguments for BOTH node and the native binary
//   (no annotation)             → differential fixture (run vs Node; wired in a later phase)
// Only the first 10 lines are scanned for annotations.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface Fixture {
  path: string;
  expectReject: string | null; // the CSxxxx code if this is a rejection fixture
  args: string[]; // command-line arguments, given to node and the binary alike
}

const REJECT_RE = /@expect-reject:\s*(CS\d{4})/;
const ARGS_RE = /@args:\s*(.+)$/m;

export function discoverFixtures(root: string): Fixture[] {
  const out: Fixture[] = [];
  for (const path of walkTsFiles(root)) {
    const head = readFileSync(path, "utf8").split("\n", 10).join("\n");
    const m = REJECT_RE.exec(head);
    const a = ARGS_RE.exec(head);
    out.push({
      path,
      expectReject: m ? m[1]! : null,
      args: a ? a[1]!.trim().split(/\s+/) : [],
    });
  }
  return out;
}

// A directory containing `main.ts` is ONE multi-file fixture: `main.ts` is the entry and its
// siblings are the modules it imports. They must not also be discovered as standalone fixtures —
// an imported module run on its own is a different program (usually one that prints nothing).
function* walkTsFiles(dir: string): Generator<string> {
  const entries = readdirSync(dir);
  if (entries.includes("main.ts")) {
    yield join(dir, "main.ts");
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walkTsFiles(full);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      yield full;
    }
  }
}
