function process(items: number[]): number[] {
  const offset = 10;
  return items.map((x: number): number => x + offset);
}
const result = process([1, 2, 3]);
for (let i = 0; i < result.length; i++) {
  console.log(result[i]);
}
