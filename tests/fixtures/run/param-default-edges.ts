// Defaults that throw (sync: the call throws; async: the promise rejects), optional callback
// parameters, defaults on object-literal function fields, and object/array/Map defaults.
function thrower(): number {
  throw new Error("boom");
}
function f(x: number = thrower()): number {
  return x;
}
try {
  console.log(f());
} catch (e) {
  console.log("caught", String(e));
}
console.log(f(2));

async function af(x: number = thrower()): Promise<number> {
  return x;
}
async function runAf(): Promise<void> {
  const p = af();
  console.log("spawned af");
  try {
    console.log("ok", await p);
  } catch (e) {
    console.log("rejected", String(e));
  }
}
runAf();
console.log("after af");

function withCb(n: number, cb?: (m: number) => void): void {
  if (cb) cb(n);
  else console.log("no cb");
}
withCb(1);
withCb(2, (m) => console.log("cb", m));

const o = { f: (x = 1): number => x * 2 };
console.log(o.f(), o.f(4));

interface Opts {
  depth?: number;
}
function deep(o: Opts = {}, extra?: Opts): number {
  return (o.depth ?? 0) + (extra?.depth ?? 0);
}
console.log(deep(), deep({ depth: 2 }), deep({}, { depth: 3 }));

function arr(xs: string[] = ["a"]): string {
  return xs.join("-");
}
console.log(arr(), arr(["x", "y"]));

const m = new Map<string, number>();
function mp(map: Map<string, number> = m, k = "z"): number {
  map.set(k, (map.get(k) ?? 0) + 1);
  return map.get(k) ?? -1;
}
console.log(mp(), mp(), mp(new Map<string, number>()), mp(undefined, "q"));

// Order in `new`: a base class runs its field initializers before its parameter defaults; a
// derived class evaluates its defaults, then super(), then its own fields.
const order: string[] = [];
function note(s: string): number {
  order.push(s);
  return order.length;
}
class Rec {
  f = note("base field");
  p: number;
  constructor(p: number = note("base param")) {
    this.p = p;
  }
}
class SubRec extends Rec {
  g = note("sub field");
  constructor(q: number = note("sub param")) {
    super();
    note(`sub body ${q}`);
  }
}
const sr = new SubRec();
console.log(order.join(" | "), sr.f, sr.p, sr.g);
