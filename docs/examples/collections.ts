// Map and Set with insertion-ordered iteration, plus the array methods that pair with them.
const text = "the quick brown fox jumps over the lazy dog the end";

const counts = new Map<string, number>();
for (const word of text.split(" ")) {
  counts.set(word, (counts.get(word) ?? 0) + 1);
}
console.log(counts.get("the"), counts.has("cat"), counts.size);

const byCount = [...counts.keys()].sort(
  (a: string, b: string): number => (counts.get(b) ?? 0) - (counts.get(a) ?? 0),
);
console.log(byCount.slice(0, 3));

const lengths = new Set<number>();
for (const word of counts.keys()) lengths.add(word.length);
console.log(lengths, lengths.has(5));
lengths.delete(3);
console.log([...lengths].join(","));
console.log(counts);
