// @test-skip
interface Item {
  name: string;
  score: number;
}
const items: Item[] = [
  { name: "a", score: 10 },
  { name: "b", score: 20 },
  { name: "c", score: 30 },
];
const total = items.reduce((sum: number, item: Item) => sum + item.score, 0);
if (total === 60) {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL: expected 60, got " + total);
}
