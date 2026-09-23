// Counter factories: each call makes a fresh `let` cell shared by the closures it returns, and
// separate factory calls never share state.
interface Counter {
  inc: () => number;
  add: (n: number) => void;
  get: () => number;
}

function makeCounter(start: number): Counter {
  let n = start;
  return {
    inc: () => {
      n++;
      return n;
    },
    add: (k: number): void => {
      n += k;
    },
    get: () => n,
  };
}

const a = makeCounter(0);
const b = makeCounter(100);
console.log(a.inc(), a.inc(), b.inc());
a.add(10);
console.log(a.get(), b.get());

function makeIdGen(prefix: string): () => string {
  let next = 1;
  return () => {
    const id = `${prefix}-${next}`;
    next = next * 2;
    return id;
  };
}
const g = makeIdGen("x");
console.log(g(), g(), g());

// A parameter reassigned inside the closure is a cell too.
function accumulator(total: number): (n: number) => number {
  return (n: number): number => {
    total += n;
    return total;
  };
}
const acc = accumulator(5);
acc(1);
acc(2);
console.log(acc(3));

// Module-level `let` mutated by closures.
let hits = 0;
const bump = (): void => {
  hits++;
};
bump();
bump();
bump();
console.log(hits);
