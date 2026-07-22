// Fixture auto-discovery. No registry: a file's annotations decide how it is tested.
//   // @expect-reject: CS1203   → rejection fixture, must fail with that exact code
//   (no annotation)             → differential fixture (run vs Node; wired in a later phase)
// Only the first 10 lines are scanned for annotations.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface Fixture {
  path: string;
  expectReject: string | null; // the CSxxxx code if this is a rejection fixture
}

const REJECT_RE = /@expect-reject:\s*(CS\d{4})/;

export function discoverFixtures(root: string): Fixture[] {
  const out: Fixture[] = [];
  for (const path of walkTsFiles(root)) {
    const head = readFileSync(path, "utf8").split("\n", 10).join("\n");
    const m = REJECT_RE.exec(head);
    out.push({ path, expectReject: m ? m[1]! : null });
  }
  return out;
}

function* walkTsFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walkTsFiles(full);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      yield full;
    }
  }
}
