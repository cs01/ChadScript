// @category: algorithms
// Word ladder: shortest transformation between words changing one letter at a time, via BFS
// over wildcard buckets, plus all shortest ladders for one pair.

const DICTIONARY = [
  "cold",
  "cord",
  "card",
  "ward",
  "warm",
  "worm",
  "word",
  "wore",
  "core",
  "care",
  "dare",
  "date",
  "gate",
  "hate",
  "have",
  "hive",
  "five",
  "fire",
  "fore",
  "fork",
  "cork",
  "work",
  "wart",
  "cart",
  "hot",
  "dot",
  "dog",
  "cog",
  "log",
  "lot",
  "hit",
  "hat",
  "cat",
  "cot",
  "cut",
  "hut",
];

function buckets(words: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const w of words) {
    for (let i = 0; i < w.length; i++) {
      const key = w.slice(0, i) + "_" + w.slice(i + 1);
      const list = map.get(key);
      if (list) list.push(w);
      else map.set(key, [w]);
    }
  }
  return map;
}

function neighbors(word: string, index: Map<string, string[]>): string[] {
  const out: string[] = [];
  for (let i = 0; i < word.length; i++) {
    for (const w of index.get(word.slice(0, i) + "_" + word.slice(i + 1)) ?? []) {
      if (w !== word) out.push(w);
    }
  }
  return out;
}

function ladder(from: string, to: string, words: string[]): string[] | null {
  const index = buckets(words);
  const prev = new Map<string, string>();
  const seen = new Set([from]);
  let frontier = [from];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const w of frontier) {
      for (const n of neighbors(w, index).sort()) {
        if (seen.has(n)) continue;
        seen.add(n);
        prev.set(n, w);
        if (n === to) {
          const path = [n];
          let cur = n;
          while (prev.has(cur)) {
            cur = prev.get(cur)!;
            path.unshift(cur);
          }
          return path;
        }
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}

function allShortest(from: string, to: string, words: string[]): string[][] {
  const index = buckets(words);
  const parents = new Map<string, string[]>();
  let level = new Set([from]);
  const visited = new Set([from]);
  let found = false;
  while (level.size > 0 && !found) {
    const next = new Set<string>();
    for (const w of level) {
      for (const n of neighbors(w, index)) {
        if (visited.has(n)) continue;
        if (n === to) found = true;
        next.add(n);
        parents.set(n, [...(parents.get(n) ?? []), w]);
      }
    }
    for (const n of next) visited.add(n);
    level = next;
  }
  const out: string[][] = [];
  const build = (w: string, acc: string[]): void => {
    if (w === from) {
      out.push([from, ...acc]);
      return;
    }
    for (const p of parents.get(w) ?? []) build(p, [w, ...acc]);
  };
  if (found) build(to, []);
  return out.sort((a, b) => a.join().localeCompare(b.join()));
}

for (const [a, b] of [
  ["cold", "warm"],
  ["hit", "cog"],
  ["fire", "work"],
  ["hot", "cold"],
]) {
  const path = ladder(a!, b!, DICTIONARY);
  console.log(
    `${a} -> ${b}: ${path ? `${path.join(" > ")} (${path.length - 1} steps)` : "no ladder"}`,
  );
}
console.log(allShortest("hit", "cog", DICTIONARY).map((p) => p.join(">")));
