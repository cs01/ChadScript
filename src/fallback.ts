// `chad run --fallback=node`: a program the compiler rejects still runs, under Node. Node is given
// tsx as a loader (TypeScript syntax and module resolution), resolved from the compiler's own
// node_modules so it works from any directory without the program installing anything.

import { spawnSync } from "node:child_process";
import { constants } from "node:os";

const TSX_LOADER = import.meta.resolve("tsx");

// Run `entry` under Node with `args`, stdio inherited; returns the exit code to leave with.
export function runUnderNode(entry: string, args: string[]): number {
  const r = spawnSync("node", ["--import", TSX_LOADER, entry, ...args], { stdio: "inherit" });
  if (r.error) {
    process.stderr.write(
      `chad: --fallback=node could not start node (${r.error.message}); run \`chad doctor\`\n`,
    );
    return 127;
  }
  if (r.signal) {
    // A shell reports death by signal N as 128 + N.
    const n = constants.signals[r.signal] ?? 0;
    return 128 + n;
  }
  return r.status ?? 1;
}

export function nodeLoader(): string {
  return TSX_LOADER;
}
