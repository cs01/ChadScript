// Effects oracle helpers: everything a program can observably do besides stdout. Each run gets its
// own working directory; afterwards we snapshot the directory tree (relative paths + bytes) and
// compare it between Node and the native binary, and we compare stderr with the one allowance
// Node's uncaught-error stack trace forces on us.

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";

// One entry per path under the root. Directories are recorded (so an empty `mkdir` result is an
// effect too); symlinks record their target text rather than being followed.
export type TreeEntry =
  | { kind: "file"; bytes: Buffer }
  | { kind: "dir" }
  | { kind: "symlink"; target: string };
export type Tree = Map<string, TreeEntry>;

export function snapshotTree(root: string): Tree {
  const out: Tree = new Map();
  const walk = (dir: string, rel: string): void => {
    // Sorted so the "first differing file" in a report is stable across filesystems.
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const relPath = rel === "" ? name : `${rel}/${name}`;
      const st = lstatSync(full);
      if (st.isSymbolicLink()) {
        out.set(relPath, { kind: "symlink", target: readlinkSync(full) });
      } else if (st.isDirectory()) {
        out.set(relPath, { kind: "dir" });
        walk(full, relPath);
      } else {
        out.set(relPath, { kind: "file", bytes: readFileSync(full) });
      }
    }
  };
  walk(root, "");
  return out;
}

function describe(e: TreeEntry | undefined): string {
  if (e === undefined) return "missing";
  switch (e.kind) {
    case "file":
      return `file (${e.bytes.length} bytes)`;
    case "dir":
      return "directory";
    case "symlink":
      return `symlink -> ${e.target}`;
    default: {
      const never: never = e;
      throw new Error(`unknown tree entry ${JSON.stringify(never)}`);
    }
  }
}

// Returns a description of the first differing path (in sorted order), or null when the trees are
// identical. `expected` is the oracle's tree.
export function diffTrees(expected: Tree, actual: Tree): string | null {
  const paths = [...new Set([...expected.keys(), ...actual.keys()])].sort();
  for (const p of paths) {
    const e = expected.get(p);
    const a = actual.get(p);
    if (e === undefined || a === undefined || e.kind !== a.kind) {
      return `${p}: node has ${describe(e)}, native has ${describe(a)}`;
    }
    if (e.kind === "file" && a.kind === "file" && !e.bytes.equals(a.bytes)) {
      return `${p}: contents differ: node ${preview(e.bytes)} != native ${preview(a.bytes)}`;
    }
    if (e.kind === "symlink" && a.kind === "symlink" && e.target !== a.target) {
      return `${p}: node has ${describe(e)}, native has ${describe(a)}`;
    }
  }
  return null;
}

function preview(b: Buffer): string {
  const s = b.toString("utf8");
  return JSON.stringify(s.length > 200 ? `${s.slice(0, 200)}...` : s);
}

// A fresh working directory for one run, seeded with a copy of the program's sibling `fixtures/`
// data directory when it has one. Each run gets its own copy, so a program that rewrites its input
// cannot leak that write into the other runs.
export function prepareRunDir(dir: string, seedDir: string | null): string {
  mkdirSync(dir, { recursive: true });
  if (seedDir !== null && existsSync(seedDir)) {
    cpSync(seedDir, join(dir, "fixtures"), { recursive: true });
  }
  // The realpath is what the process sees as its cwd (macOS temp dirs live behind /var -> /private).
  return realpathSync(dir);
}

// The runs live in different directories, so any output that names the cwd would differ for a
// reason that is not the program's behavior. Both spellings (as created and as resolved) map to
// the same placeholder.
export function normalizeCwd(text: string, cwds: string[]): string {
  let out = text;
  // Longest first, so `/private/var/x` is not partially rewritten by `/var/x`.
  for (const c of [...cwds].sort((a, b) => b.length - a.length)) {
    out = out.split(c).join("<cwd>");
  }
  return out;
}

// Node reports an uncaught error as a source excerpt (`file:line`, the source line, a caret line),
// a blank line, the error's own text, then a stack full of Node-internal paths. The comparable
// part is the error's first line, plus whatever the program itself wrote to stderr before it.
// Returns the lines to compare, or null when the stderr has no uncaught-error block.
export function uncaughtErrorLines(nodeStderr: string): string[] | null {
  const lines = nodeStderr.split("\n");
  const caret = lines.findIndex((l) => /^\s*\^+\s*$/.test(l));
  if (caret < 2) return null;
  let header = caret + 1;
  while (header < lines.length && lines[header]!.trim() === "") header++;
  if (header >= lines.length) return null;
  // Before the excerpt's two lines (location, source), minus the blank line Node sometimes adds.
  const before = lines.slice(0, caret - 2);
  while (before.length > 0 && before[before.length - 1]!.trim() === "") before.pop();
  return [...before, lines[header]!];
}

// Compare stderr. Exact, except when Node died of an uncaught error: then only the program's own
// earlier stderr output and the first line of the error are compared (the stack cannot match).
// Returns null when equal, otherwise a description.
export function compareStderr(
  nodeStderr: string,
  nativeStderr: string,
  nodeExit: number | null,
): string | null {
  if (nodeExit !== 0) {
    const want = uncaughtErrorLines(nodeStderr);
    if (want !== null) {
      const got = nativeStderr.split("\n").slice(0, want.length);
      return want.join("\n") === got.join("\n")
        ? null
        : `stderr (uncaught error) ${JSON.stringify(got.join("\n"))} != node ${JSON.stringify(want.join("\n"))}`;
    }
  }
  return nodeStderr === nativeStderr
    ? null
    : `stderr ${JSON.stringify(nativeStderr)} != node ${JSON.stringify(nodeStderr)}`;
}
