// JSON.stringify of array elements Node writes as `null` (null, undefined, a function) and of Maps
// and Sets, which have no enumerable own properties and so are `{}` wherever they sit.
const opt: (number | null)[] = [1, null, 3];
const undef: (string | undefined)[] = ["a", undefined];
const mixed: (number | string | undefined)[] = [1, "x", undefined];
function f(): number {
  return 1;
}
const fns: (() => number)[] = [f];
const m = new Map<string, number>();
m.set("a", 1);
const s = new Set<number>([1]);
interface Box {
  tags: Set<string>;
  byName: Map<string, number>;
  list: (number | null)[];
}
const box: Box = { tags: new Set(["t"]), byName: m, list: [null, 2] };
console.log(JSON.stringify(opt), JSON.stringify(undef), JSON.stringify(mixed));
console.log(JSON.stringify(fns), JSON.stringify(m), JSON.stringify(s), JSON.stringify([m, s]));
console.log(JSON.stringify(box), JSON.stringify(box, null, 2));
console.log("%j|%j|%j", opt, box, [undef]);
