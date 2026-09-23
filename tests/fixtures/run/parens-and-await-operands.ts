// Parentheses are transparent everywhere lowering reads syntax, an awaited value can be any
// operand, and a Promise static can be a statement.
class Pt {
  x: number;
  constructor(x: number) {
    this.x = x;
  }
}
let n = 1;
n = 2;
n = 3;
n++;
++n;
const p = new Pt(1);
p.x = 5;
p.x += 1;
const xs = [1, 2, 3];
xs[0] = 9;
console.log(n, p.x, xs);
const ys: number[] = [];
ys.push(4);
console.log(ys, p instanceof Pt, JSON.stringify({ a: [1] }, null, 2));
const u: number | undefined = undefined;
const v: Pt | null = null;
console.log(u, v);

async function twice(k: number): Promise<number> {
  return k * 2;
}
async function getMap(m: Map<string, number>): Promise<Map<string, number>> {
  return m;
}
async function main(): Promise<void> {
  Promise.all([twice(1), twice(2)]);
  console.log((await Promise.all([twice(3), twice(4)])).length);
  console.log((await getMap(new Map<string, number>())).size, (await twice(5)) + 1);
}
main();
