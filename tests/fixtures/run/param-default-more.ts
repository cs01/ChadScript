// More defaults: object-valued defaults built per call, optional params held in heap cells,
// inherited constructors with defaults, `T | undefined` defaults later assigned undefined, union
// slots, defaults reading earlier defaults, generic and function-field calls with fewer args.
class Wrap {
  v: number;
  constructor(v = 0) {
    this.v = v;
  }
  plus(o: Wrap = new Wrap(100)): number {
    return this.v + o.v;
  }
}
console.log(new Wrap().plus(), new Wrap(1).plus(new Wrap(2)));

function cellOpt(x?: number): number {
  const g = (): number => x ?? -1;
  x = (x ?? 0) + 5;
  return g();
}
console.log(cellOpt(), cellOpt(1));

class Animal {
  name: string;
  legs: number;
  constructor(name: string, legs = 4) {
    this.name = name;
    this.legs = legs;
  }
}
class Plain extends Animal {}
console.log(new Plain("p").legs, new Plain("q", 1).legs);

function undefOk(w: number | undefined = 3): string {
  const before = `${w}`;
  w = undefined;
  return before + " " + `${w}`;
}
console.log(undefOk(), undefOk(9), undefOk(undefined));

interface Handler {
  run(x?: number): string;
}
const h: Handler = {
  run: (x?: number): string => `run ${x ?? "none"}`,
};
console.log(h.run(), h.run(2));

const arrowCell = (n = 1): (() => number) => {
  const inc = (): number => ++n;
  inc();
  return inc;
};
const ac = arrowCell();
console.log(ac(), ac(), arrowCell(10)());

function id<T>(x: T, times = 1): T[] {
  const out: T[] = [];
  for (let i = 0; i < times; i++) out.push(x);
  return out;
}
console.log(id(4), id("s", 2));

function strOrNum(v: string | number = 5, w?: string | boolean): string {
  return `${v}/${w}`;
}
console.log(strOrNum(), strOrNum("a"), strOrNum(undefined, true), strOrNum(1, "w"));

function nested(a = 1, b = { k: a + 1 }, c = [a, b.k]): string {
  return JSON.stringify({ a, b, c });
}
console.log(nested(), nested(5), nested(5, { k: 0 }));

function optArr(xs?: number[]): number {
  return xs === undefined ? -1 : xs.length;
}
console.log(optArr(), optArr([1, 2]));
