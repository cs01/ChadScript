// @category: text
// A word-level Markov chain text generator trained on a file, with a seeded PRNG so the output is
// reproducible, plus the transition table statistics.
import { readFileSync, writeFileSync } from "node:fs";

function xorshift(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

class MarkovChain {
  private table = new Map<string, Map<string, number>>();

  constructor(private order: number) {}

  train(words: string[]): void {
    for (let i = 0; i + this.order < words.length; i++) {
      const key = words.slice(i, i + this.order).join(" ");
      const next = words[i + this.order]!;
      const counts = this.table.get(key) ?? new Map<string, number>();
      counts.set(next, (counts.get(next) ?? 0) + 1);
      this.table.set(key, counts);
    }
  }

  private pick(counts: Map<string, number>, rand: () => number): string {
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    let r = rand() * total;
    for (const [word, n] of [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      r -= n;
      if (r < 0) return word;
    }
    return [...counts.keys()][0]!;
  }

  generate(start: string[], length: number, rand: () => number): string {
    const out = [...start];
    while (out.length < length) {
      const counts = this.table.get(out.slice(-this.order).join(" "));
      if (!counts) break;
      out.push(this.pick(counts, rand));
    }
    return out.join(" ");
  }

  stats(): { states: number; branching: number; deterministic: number } {
    let edges = 0;
    let deterministic = 0;
    for (const counts of this.table.values()) {
      edges += counts.size;
      if (counts.size === 1) deterministic++;
    }
    return { states: this.table.size, branching: edges / this.table.size, deterministic };
  }
}

const words = readFileSync("fixtures/words.txt", "utf8").toLowerCase().split(/\s+/).filter(Boolean);
const chain = new MarkovChain(1);
chain.train(words);
const s = chain.stats();
console.log(
  `states ${s.states}, avg branching ${s.branching.toFixed(3)}, deterministic ${s.deterministic}`,
);
const rand = xorshift(7);
const samples: string[] = [];
for (let i = 0; i < 4; i++) samples.push(chain.generate(["it"], 14, rand));
console.log(samples.join("\n"));
const chain2 = new MarkovChain(2);
chain2.train(words);
const two = chain2.generate(["we", "had"], 12, xorshift(99));
console.log(two);
writeFileSync("generated.txt", [...samples, two].join("\n") + "\n");
