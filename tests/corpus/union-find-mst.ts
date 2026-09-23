// @category: data-structures
// Disjoint-set union with path compression and union by rank, used for Kruskal's minimum
// spanning tree and for counting islands in a grid.

class DisjointSet {
  private parent: number[];
  private rank: number[];
  components: number;

  constructor(n: number) {
    this.parent = [];
    this.rank = [];
    for (let i = 0; i < n; i++) {
      this.parent.push(i);
      this.rank.push(0);
    }
    this.components = n;
  }

  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root] as number;
    while (this.parent[x] !== root) {
      const next = this.parent[x] as number;
      this.parent[x] = root;
      x = next;
    }
    return root;
  }

  union(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    const rankA = this.rank[ra] as number;
    const rankB = this.rank[rb] as number;
    if (rankA < rankB) this.parent[ra] = rb;
    else if (rankA > rankB) this.parent[rb] = ra;
    else {
      this.parent[rb] = ra;
      this.rank[ra] = rankA + 1;
    }
    this.components--;
    return true;
  }
}

interface WeightedEdge {
  a: number;
  b: number;
  w: number;
}

function kruskal(n: number, edges: WeightedEdge[]): { total: number; used: WeightedEdge[] } {
  const sorted = edges.slice().sort((x, y) => x.w - y.w || x.a - y.a || x.b - y.b);
  const dsu = new DisjointSet(n);
  const used: WeightedEdge[] = [];
  let total = 0;
  for (const e of sorted) {
    if (dsu.union(e.a, e.b)) {
      used.push(e);
      total += e.w;
    }
  }
  return { total, used };
}

function countIslands(map: string[]): number {
  const rows = map.length;
  const cols = rows > 0 ? (map[0] as string).length : 0;
  const dsu = new DisjointSet(rows * cols);
  let water = 0;
  for (let r = 0; r < rows; r++) {
    const line = map[r] as string;
    for (let c = 0; c < cols; c++) {
      if (line.charAt(c) !== "#") {
        water++;
        continue;
      }
      if (r + 1 < rows && (map[r + 1] as string).charAt(c) === "#")
        dsu.union(r * cols + c, (r + 1) * cols + c);
      if (c + 1 < cols && line.charAt(c + 1) === "#") dsu.union(r * cols + c, r * cols + c + 1);
    }
  }
  return dsu.components - water;
}

const cities = ["Avon", "Bree", "Cork", "Dale", "Eyre", "Fife"];
const roads: WeightedEdge[] = [
  { a: 0, b: 1, w: 7 },
  { a: 0, b: 3, w: 5 },
  { a: 1, b: 2, w: 8 },
  { a: 1, b: 3, w: 9 },
  { a: 1, b: 4, w: 7 },
  { a: 2, b: 4, w: 5 },
  { a: 3, b: 4, w: 15 },
  { a: 3, b: 5, w: 6 },
  { a: 4, b: 5, w: 8 },
];
const mst = kruskal(cities.length, roads);
console.log("MST weight:", mst.total);
for (const e of mst.used) console.log("  " + cities[e.a] + " - " + cities[e.b] + " (" + e.w + ")");

const grid = ["##..#", "#...#", "..#..", "....#", "##.##"];
console.log("islands:", countIslands(grid));
const d = new DisjointSet(10);
[
  [1, 2],
  [3, 4],
  [2, 3],
  [5, 6],
  [1, 4],
].forEach(([a, b]) => console.log(`union(${a}, ${b}) -> ${d.union(a as number, b as number)}`));
console.log(
  "components:",
  d.components,
  "same(1,4):",
  d.find(1) === d.find(4),
  "same(1,5):",
  d.find(1) === d.find(5),
);
