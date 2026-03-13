
interface Item {
  name: string;
  score: number;
}

const items: Item[] = [
  { name: "a", score: 10 },
  { name: "b", score: 20 },
  { name: "c", score: 30 },
];

const high = items.filter((item: Item) => item.score > 15);
console.log(high.length);
if (high.length !== 2) {
  process.exit(1);
}

const scores: number[] = [];
items.forEach((item: Item) => {
  scores.push(item.score);
});
console.log(scores.length);
if (scores.length !== 3) {
  process.exit(1);
}

const names = items.map((item: Item) => item.name);
console.log(names.length);
if (names.length !== 3) {
  process.exit(1);
}

const hasHigh = items.some((item: Item) => item.score > 25);
console.log(hasHigh);
if (!hasHigh) {
  process.exit(1);
}

const allPositive = items.every((item: Item) => item.score > 0);
console.log(allPositive);
if (!allPositive) {
  process.exit(1);
}

console.log("TEST_PASSED");
