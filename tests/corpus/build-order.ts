// @category: algorithms
// A build system's dependency resolution: Kahn's topological sort, parallel build levels,
// cycle reporting with the cycle path, and transitive dependents of a changed package.
import { writeFileSync } from "node:fs";

type Graph = Map<string, string[]>;

function graphFrom(deps: Record<string, string[]>): Graph {
  const g: Graph = new Map();
  for (const [pkg, ds] of Object.entries(deps)) {
    g.set(pkg, ds);
    for (const d of ds) if (!g.has(d)) g.set(d, []);
  }
  return g;
}

function buildLevels(g: Graph): string[][] {
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const [pkg, deps] of g) {
    indegree.set(pkg, deps.length);
    for (const d of deps) dependents.set(d, [...(dependents.get(d) ?? []), pkg]);
  }
  let ready = [...g.keys()].filter((p) => indegree.get(p) === 0).sort();
  const levels: string[][] = [];
  let done = 0;
  while (ready.length > 0) {
    levels.push(ready);
    done += ready.length;
    const next: string[] = [];
    for (const p of ready) {
      for (const dep of dependents.get(p) ?? []) {
        const n = (indegree.get(dep) ?? 0) - 1;
        indegree.set(dep, n);
        if (n === 0) next.push(dep);
      }
    }
    ready = next.sort();
  }
  if (done !== g.size) throw new Error(`cycle detected: ${findCycle(g)?.join(" -> ")}`);
  return levels;
}

function findCycle(g: Graph): string[] | null {
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const visit = (n: string): string[] | null => {
    if (state.get(n) === "done") return null;
    if (state.get(n) === "visiting") return [...stack.slice(stack.indexOf(n)), n];
    state.set(n, "visiting");
    stack.push(n);
    for (const d of g.get(n) ?? []) {
      const c = visit(d);
      if (c) return c;
    }
    stack.pop();
    state.set(n, "done");
    return null;
  };
  for (const n of [...g.keys()].sort()) {
    const c = visit(n);
    if (c) return c;
  }
  return null;
}

function affectedBy(g: Graph, changed: string): string[] {
  const out = new Set<string>();
  let frontier = [changed];
  while (frontier.length) {
    const next: string[] = [];
    for (const [pkg, deps] of g) {
      if (!out.has(pkg) && deps.some((d) => frontier.includes(d))) {
        out.add(pkg);
        next.push(pkg);
      }
    }
    frontier = next;
  }
  return [...out].sort();
}

const monorepo = graphFrom({
  app: ["ui", "api-client", "utils"],
  ui: ["design-tokens", "utils"],
  "api-client": ["schema", "utils"],
  server: ["schema", "db", "utils"],
  db: ["utils"],
  schema: [],
  cli: ["api-client"],
});
const levels = buildLevels(monorepo);
levels.forEach((l, i) => console.log(`stage ${i + 1}: ${l.join(", ")}`));
writeFileSync("build-plan.json", JSON.stringify({ stages: levels }, null, 2) + "\n");
console.log(`changing utils rebuilds: ${affectedBy(monorepo, "utils").join(", ")}`);
console.log(`changing schema rebuilds: ${affectedBy(monorepo, "schema").join(", ")}`);
try {
  buildLevels(graphFrom({ a: ["b"], b: ["c"], c: ["a"], d: [] }));
} catch (e) {
  console.log((e as Error).message);
}
