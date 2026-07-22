interface Point {
  x: number;
  y: number;
  z: number;
}
const p: Point = { x: 1, y: 2, z: 3 };
console.log(Object.keys(p).join(","));
console.log(Object.values(p).join(","));
console.log(Object.keys(p).length);
const scores = { alice: 90, bob: 85, carol: 95 };
console.log(Object.keys(scores).join(" "));
console.log(Object.values(scores).reduce((a: number, b: number): number => a + b, 0));
for (const k of Object.keys(scores)) {
  console.log(k);
}
console.log(Object.values(scores).filter((s: number): boolean => s > 88).length);
