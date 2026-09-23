// @category: data-structures
// A trie with insert, prefix search ranked by frequency, deletion, and a longest-common-prefix
// query, fed from a text file.
import { readFileSync } from "node:fs";

class TrieNode {
  children = new Map<string, TrieNode>();
  count = 0;
}

class Trie {
  private root = new TrieNode();
  private words = 0;

  insert(word: string): void {
    let node = this.root;
    for (const ch of word) {
      let next = node.children.get(ch);
      if (!next) {
        next = new TrieNode();
        node.children.set(ch, next);
      }
      node = next;
    }
    if (node.count === 0) this.words++;
    node.count++;
  }

  private find(prefix: string): TrieNode | undefined {
    let node: TrieNode | undefined = this.root;
    for (const ch of prefix) {
      node = node.children.get(ch);
      if (!node) return undefined;
    }
    return node;
  }

  has(word: string): boolean {
    return (this.find(word)?.count ?? 0) > 0;
  }

  complete(prefix: string, limit = 5): { word: string; count: number }[] {
    const start = this.find(prefix);
    if (!start) return [];
    const found: { word: string; count: number }[] = [];
    const walk = (node: TrieNode, acc: string): void => {
      if (node.count > 0) found.push({ word: acc, count: node.count });
      for (const [ch, child] of [...node.children].sort(([a], [b]) => (a < b ? -1 : 1)))
        walk(child, acc + ch);
    };
    walk(start, prefix);
    return found.sort((a, b) => b.count - a.count || (a.word < b.word ? -1 : 1)).slice(0, limit);
  }

  remove(word: string): boolean {
    const node = this.find(word);
    if (!node || node.count === 0) return false;
    node.count = 0;
    this.words--;
    return true;
  }

  longestCommonPrefix(): string {
    let node = this.root;
    let out = "";
    while (node.children.size === 1 && node.count === 0) {
      const [ch, child] = [...node.children][0]!;
      out += ch;
      node = child;
    }
    return out;
  }

  get size(): number {
    return this.words;
  }
}

const trie = new Trie();
const text = readFileSync("fixtures/words.txt", "utf8").toLowerCase();
for (const w of text.split(/[^a-z]+/)) if (w) trie.insert(w);

console.log(`distinct words: ${trie.size}`);
for (const prefix of ["w", "we", "ep", "de", "x", "the"]) {
  const hits = trie.complete(prefix);
  console.log(
    `${prefix.padEnd(4)} -> ${hits.map((h) => `${h.word}(${h.count})`).join(" ") || "(none)"}`,
  );
}
console.log(
  trie.has("wisdom"),
  trie.has("wis"),
  trie.remove("wisdom"),
  trie.has("wisdom"),
  trie.remove("wisdom"),
);
console.log(`distinct after removal: ${trie.size}`);

const t2 = new Trie();
["interstellar", "internet", "interval", "internal"].forEach((w) => t2.insert(w));
console.log(`lcp: ${t2.longestCommonPrefix()}`);
