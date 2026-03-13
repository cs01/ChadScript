const words = ["apple", "banana", "apple", "cherry", "banana", "apple"];
const counts = new Map<string, number>();

for (let i = 0; i < words.length; i++) {
  const word = words[i];
  if (counts.has(word)) {
    const prev = counts.get(word);
    counts.set(word, prev + 1);
  } else {
    counts.set(word, 1);
  }
}

if (counts.get("apple") !== 3) process.exit(1);
if (counts.get("banana") !== 2) process.exit(1);
if (counts.get("cherry") !== 1) process.exit(1);
if (counts.size !== 3) process.exit(1);

counts.delete("cherry");
if (counts.size !== 2) process.exit(1);
if (counts.has("cherry")) process.exit(1);

console.log("TEST_PASSED");
