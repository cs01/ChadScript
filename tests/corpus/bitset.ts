// @category: data-structures
// A bitset over a Uint32Array: set/clear/test, popcount, union/intersection/difference, iteration
// of set bits, and a prime sieve stored in bits.

class BitSet {
  private words: Uint32Array;

  constructor(readonly size: number) {
    this.words = new Uint32Array(Math.ceil(size / 32));
  }

  set(i: number): this {
    this.words[i >>> 5]! |= 1 << (i & 31);
    return this;
  }

  clear(i: number): this {
    this.words[i >>> 5]! &= ~(1 << (i & 31));
    return this;
  }

  has(i: number): boolean {
    return (this.words[i >>> 5]! & (1 << (i & 31))) !== 0;
  }

  count(): number {
    let n = 0;
    for (let w of this.words) {
      while (w !== 0) {
        w &= w - 1;
        n++;
      }
    }
    return n;
  }

  private combine(other: BitSet, op: (a: number, b: number) => number): BitSet {
    const out = new BitSet(Math.max(this.size, other.size));
    for (let i = 0; i < out.words.length; i++)
      out.words[i] = op(this.words[i] ?? 0, other.words[i] ?? 0) >>> 0;
    return out;
  }

  union(o: BitSet): BitSet {
    return this.combine(o, (a, b) => a | b);
  }
  intersect(o: BitSet): BitSet {
    return this.combine(o, (a, b) => a & b);
  }
  difference(o: BitSet): BitSet {
    return this.combine(o, (a, b) => a & ~b);
  }

  *[Symbol.iterator](): Generator<number> {
    for (let i = 0; i < this.size; i++) if (this.has(i)) yield i;
  }

  toString(): string {
    return `{${[...this].join(",")}}`;
  }
}

const evens = new BitSet(40);
const threes = new BitSet(40);
for (let i = 0; i < 40; i += 2) evens.set(i);
for (let i = 0; i < 40; i += 3) threes.set(i);
console.log("evens & threes =", evens.intersect(threes).toString());
console.log("threes - evens =", threes.difference(evens).toString());
console.log("|evens | threes| =", evens.union(threes).count());
evens.clear(0).clear(2);
console.log(evens.has(0), evens.has(4), evens.count());

const N = 10000;
const composite = new BitSet(N + 1).set(0).set(1);
for (let i = 2; i * i <= N; i++) {
  if (composite.has(i)) continue;
  for (let j = i * i; j <= N; j += i) composite.set(j);
}
const primeCount = N + 1 - composite.count();
console.log(`primes below ${N}: ${primeCount}`);
const lastPrimes: number[] = [];
for (let i = N; lastPrimes.length < 5; i--) if (!composite.has(i)) lastPrimes.push(i);
console.log(`largest: ${lastPrimes.join(", ")}`);
