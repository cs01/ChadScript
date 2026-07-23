// JSON.stringify over the supported value subset: scalars, strings (JSON-escaped), arrays, nested
// objects/arrays, class instances (fields only), and non-finite numbers (→ null).
interface Nested {
  id: number;
  name: string;
  tags: string[];
  meta: { active: boolean; score: number };
}
const n: Nested = {
  id: 7,
  name: 'a"quoted"\ttabbed',
  tags: ["x", "y"],
  meta: { active: true, score: 3.5 },
};
console.log(JSON.stringify(n));
console.log(JSON.stringify(42), JSON.stringify("hi"), JSON.stringify(false), JSON.stringify(-0));
console.log(JSON.stringify([1, 2, 3]));
console.log(JSON.stringify(NaN), JSON.stringify(1 / 0), JSON.stringify([NaN, 5]));
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
console.log(JSON.stringify(new Point(3, 4)));
const empty: number[] = [];
console.log(JSON.stringify(empty));
