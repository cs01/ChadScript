// @category: data-structures
// A hash map written from scratch: FNV-1a string hashing, separate chaining, automatic resizing
// at a load factor, deletion, and iteration; compared against the built-in Map.

class Entry {
  constructor(
    public key: string,
    public value: number,
    public next: Entry | null,
  ) {}
}

class StringHashMap {
  private buckets: (Entry | null)[];
  private count = 0;
  resizes = 0;

  constructor(initialCapacity = 8) {
    this.buckets = new Array<Entry | null>(initialCapacity).fill(null);
  }

  private hash(key: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h % this.buckets.length;
  }

  set(key: string, value: number): void {
    const i = this.hash(key);
    for (let e = this.buckets[i] ?? null; e !== null; e = e.next) {
      if (e.key === key) {
        e.value = value;
        return;
      }
    }
    this.buckets[i] = new Entry(key, value, this.buckets[i] ?? null);
    this.count++;
    if (this.count > this.buckets.length * 0.75) this.resize();
  }

  get(key: string): number | undefined {
    for (let e = this.buckets[this.hash(key)] ?? null; e !== null; e = e.next) {
      if (e.key === key) return e.value;
    }
    return undefined;
  }

  delete(key: string): boolean {
    const i = this.hash(key);
    let prev: Entry | null = null;
    for (let e = this.buckets[i] ?? null; e !== null; prev = e, e = e.next) {
      if (e.key !== key) continue;
      if (prev) prev.next = e.next;
      else this.buckets[i] = e.next;
      this.count--;
      return true;
    }
    return false;
  }

  private resize(): void {
    const old = this.buckets;
    this.buckets = new Array<Entry | null>(old.length * 2).fill(null);
    this.count = 0;
    this.resizes++;
    for (const head of old) {
      for (let e = head; e !== null; e = e.next) this.set(e.key, e.value);
    }
  }

  get size(): number {
    return this.count;
  }

  longestChain(): number {
    let best = 0;
    for (const head of this.buckets) {
      let n = 0;
      for (let e = head; e !== null; e = e.next) n++;
      best = Math.max(best, n);
    }
    return best;
  }

  entries(): [string, number][] {
    const out: [string, number][] = [];
    for (const head of this.buckets)
      for (let e = head; e !== null; e = e.next) out.push([e.key, e.value]);
    return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }
}

const mine = new StringHashMap();
const reference = new Map<string, number>();
for (let i = 0; i < 500; i++) {
  const key = `key-${(i * 7919) % 1000}`;
  mine.set(key, i);
  reference.set(key, i);
}
for (let i = 0; i < 1000; i += 3) {
  const key = `key-${i}`;
  if (mine.delete(key) !== reference.delete(key)) console.log(`delete mismatch at ${key}`);
}
let mismatches = 0;
for (const [k, v] of reference) if (mine.get(k) !== v) mismatches++;
console.log(
  `size ${mine.size} vs ${reference.size}, mismatches ${mismatches}, resizes ${mine.resizes}, longest chain ${mine.longestChain()}`,
);
console.log(mine.entries().slice(0, 5));
console.log(mine.get("key-1"), mine.get("nope"), mine.delete("nope"));
