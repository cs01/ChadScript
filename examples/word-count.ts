// Word frequency counter — Map for counts, string methods, array iteration, sorting by a
// comparator, and util.inspect-style logging of a tuple-ish result.
const text = "the quick brown fox the lazy dog the fox";

const counts = new Map<string, number>();
for (const word of text.split(" ")) {
  counts.set(word, (counts.get(word) ?? 0) + 1);
}

// Build [word, count] rows as small objects (no tuples in the subset) and sort by count desc.
const rows = [...counts.keys()].map((word: string): { word: string; count: number } => ({
  word,
  count: counts.get(word) ?? 0,
}));
rows.sort((a: { word: string; count: number }, b: { word: string; count: number }): number =>
  b.count - a.count,
);

for (const row of rows) {
  console.log(row.word + ": " + row.count);
}
console.log("distinct words:", counts.size);
