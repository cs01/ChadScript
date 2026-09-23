// @category: algorithms
// Reads a weighted graph from a file and runs Dijkstra (with a binary heap), BFS components and
// path reconstruction.
import { readFileSync } from "node:fs";

interface Edge {
  to: string;
  weight: number;
}

class MinHeap {
  private items: [number, string][] = [];
  get size(): number {
    return this.items.length;
  }
  push(priority: number, value: string): void {
    this.items.push([priority, value]);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent]![0] <= this.items[i]![0]) break;
      [this.items[parent], this.items[i]] = [this.items[i]!, this.items[parent]!];
      i = parent;
    }
  }
  pop(): [number, string] | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.items[l]![0] < this.items[m]![0]) m = l;
        if (r < this.items.length && this.items[r]![0] < this.items[m]![0]) m = r;
        if (m === i) break;
        [this.items[m], this.items[i]] = [this.items[i]!, this.items[m]!];
        i = m;
      }
    }
    return top;
  }
}

function loadGraph(path: string): Map<string, Edge[]> {
  const graph = new Map<string, Edge[]>();
  const addEdge = (a: string, b: string, w: number): void => {
    if (!graph.has(a)) graph.set(a, []);
    graph.get(a)!.push({ to: b, weight: w });
  };
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [a, b, w] = line.split(/\s+/);
    if (a === undefined || b === undefined || w === undefined) continue;
    addEdge(a, b, Number(w));
    addEdge(b, a, Number(w));
  }
  return graph;
}

function dijkstra(graph: Map<string, Edge[]>, source: string) {
  const dist = new Map<string, number>([[source, 0]]);
  const prev = new Map<string, string>();
  const heap = new MinHeap();
  heap.push(0, source);
  while (heap.size > 0) {
    const [d, node] = heap.pop()!;
    if (d > (dist.get(node) ?? Infinity)) continue;
    for (const { to, weight } of graph.get(node) ?? []) {
      const nd = d + weight;
      if (nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd);
        prev.set(to, node);
        heap.push(nd, to);
      }
    }
  }
  return { dist, prev };
}

function pathTo(prev: Map<string, string>, target: string): string[] {
  const path = [target];
  let cur = target;
  while (prev.has(cur)) {
    cur = prev.get(cur)!;
    path.unshift(cur);
  }
  return path;
}

function components(graph: Map<string, Edge[]>): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const start of [...graph.keys()].sort()) {
    if (seen.has(start)) continue;
    const comp: string[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const n = queue.shift()!;
      comp.push(n);
      for (const e of graph.get(n) ?? []) {
        if (!seen.has(e.to)) {
          seen.add(e.to);
          queue.push(e.to);
        }
      }
    }
    out.push(comp.sort());
  }
  return out;
}

const graph = loadGraph("fixtures/graph.txt");
const { dist, prev } = dijkstra(graph, "A");
for (const node of [...graph.keys()].sort()) {
  const d = dist.get(node);
  console.log(
    d === undefined
      ? `${node}: unreachable`
      : `${node}: ${d} via ${pathTo(prev, node).join(" -> ")}`,
  );
}
console.log(
  "components:",
  components(graph)
    .map((c) => c.join(""))
    .join(" | "),
);
