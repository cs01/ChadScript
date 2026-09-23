// `===` / `!==` on objects, arrays, Maps and Sets compare identity; through optionals too.
interface P {
  x: number;
}
class Box {
  v: number;
  constructor(v: number) {
    this.v = v;
  }
}
const a: P = { x: 1 };
const b: P = { x: 1 };
const c = a;
console.log(a === b, a === c, a !== b, a !== c);
const xs = [1, 2];
const ys = xs;
const zs = [1, 2];
console.log(xs === ys, xs === zs, xs !== zs);
const m1 = new Map<string, number>();
const m2 = m1;
console.log(m1 === m2, m1 === new Map<string, number>());
const s1 = new Set<number>();
console.log(s1 === s1, s1 !== new Set<number>());
const k1 = new Box(1);
const k2 = new Box(1);
console.log(k1 === k2, k1 === k1);

function find(items: Box[], v: number): Box | undefined {
  for (const it of items) if (it.v === v) return it;
  return undefined;
}
const items = [k1, k2, new Box(3)];
const f1 = find(items, 3);
const f2 = find(items, 3);
const f3 = find(items, 9);
const f4 = find(items, 8);
console.log(f1 === f2, f1 === f3, f3 === f4, f1 === k1, k1 === f1, f1 !== f3);
const n1: P | null = null;
const n2: P | undefined = undefined;
console.log(n1 === null, n2 === undefined);
const o1: number | undefined = xs.at(0);
const o2: number | undefined = zs.at(0);
const o3: number | undefined = xs.at(5);
console.log(o1 === o2, o1 === o3, o3 === xs.at(7), o1 !== o3);
