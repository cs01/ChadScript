// @category: algorithms
// Reads a maze from a file, finds the shortest path from S to E with BFS, compares with DFS path
// length, and writes the solved maze with the path drawn in.
import { readFileSync, writeFileSync } from "node:fs";

interface Point {
  r: number;
  c: number;
}

const grid = readFileSync("fixtures/maze.txt", "utf8")
  .split("\n")
  .filter((l) => l.length > 0)
  .map((l) => l.split(""));

function find(ch: string): Point {
  for (let r = 0; r < grid.length; r++) {
    const c = grid[r]!.indexOf(ch);
    if (c >= 0) return { r, c };
  }
  throw new Error(`no ${ch} in maze`);
}

const start = find("S");
const end = find("E");
const key = (p: Point): string => `${p.r},${p.c}`;
const DIRS: Point[] = [
  { r: -1, c: 0 },
  { r: 0, c: 1 },
  { r: 1, c: 0 },
  { r: 0, c: -1 },
];

function open(p: Point): boolean {
  const row = grid[p.r];
  return row !== undefined && row[p.c] !== undefined && row[p.c] !== "#";
}

function bfs(): Point[] | null {
  const prev = new Map<string, Point | null>([[key(start), null]]);
  const queue: Point[] = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.r === end.r && cur.c === end.c) {
      const path: Point[] = [];
      for (let p: Point | null = cur; p; p = prev.get(key(p)) ?? null) path.unshift(p);
      return path;
    }
    for (const d of DIRS) {
      const next = { r: cur.r + d.r, c: cur.c + d.c };
      if (open(next) && !prev.has(key(next))) {
        prev.set(key(next), cur);
        queue.push(next);
      }
    }
  }
  return null;
}

function dfsLength(): number {
  const seen = new Set<string>();
  const stack: { p: Point; depth: number }[] = [{ p: start, depth: 0 }];
  while (stack.length > 0) {
    const { p, depth } = stack.pop()!;
    if (seen.has(key(p))) continue;
    seen.add(key(p));
    if (p.r === end.r && p.c === end.c) return depth;
    for (const d of DIRS) {
      const next = { r: p.r + d.r, c: p.c + d.c };
      if (open(next)) stack.push({ p: next, depth: depth + 1 });
    }
  }
  return -1;
}

const path = bfs();
if (!path) {
  console.log("no path");
  process.exit(1);
}
console.log(`shortest path: ${path.length - 1} steps; dfs found a path of ${dfsLength()} steps`);
for (const p of path.slice(1, -1)) grid[p.r]![p.c] = "*";
const solved = grid.map((row) => row.join("")).join("\n");
console.log(solved);
writeFileSync("solved.txt", solved + "\n");
const turns = path.slice(2).filter((p, i) => {
  const a = path[i]!;
  return a.r !== p.r && a.c !== p.c;
}).length;
console.log(`turns: ${turns}`);
