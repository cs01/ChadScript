interface Pair {
  a: number;
  b: number;
}
const p: Pair = { a: 1, b: 2 };
const tmp = p.a;
p.a = p.b;
p.b = tmp;
console.log(p.a, p.b);
