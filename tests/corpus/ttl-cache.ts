// @category: generics
// A generic cache with time-to-live entries and an injectable clock (so tests control time),
// get-or-compute, stale-while-revalidate stats, and pruning.

interface Clock {
  now(): number;
}

class FakeClock implements Clock {
  private t = 1_000;
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

interface CacheEntry<V> {
  value: V;
  expires: number;
}

class TtlCache<K, V> {
  private entries = new Map<K, CacheEntry<V>>();
  stats = { hits: 0, misses: 0, expired: 0 };

  constructor(
    private readonly ttl: number,
    private readonly clock: Clock,
  ) {}

  set(key: K, value: V, ttl: number = this.ttl): void {
    this.entries.set(key, { value, expires: this.clock.now() + ttl });
  }

  get(key: K): V | undefined {
    const e = this.entries.get(key);
    if (!e) {
      this.stats.misses++;
      return undefined;
    }
    if (e.expires <= this.clock.now()) {
      this.entries.delete(key);
      this.stats.expired++;
      this.stats.misses++;
      return undefined;
    }
    this.stats.hits++;
    return e.value;
  }

  getOrCompute(key: K, compute: (key: K) => V): V {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const v = compute(key);
    this.set(key, v);
    return v;
  }

  prune(): number {
    const now = this.clock.now();
    let removed = 0;
    for (const [k, e] of this.entries) {
      if (e.expires <= now) {
        this.entries.delete(k);
        removed++;
      }
    }
    return removed;
  }

  get size(): number {
    return this.entries.size;
  }
}

const clock = new FakeClock();
const cache = new TtlCache<string, number>(100, clock);
let computations = 0;
const lengthOf = (s: string): number => {
  computations++;
  return s.length;
};

console.log(
  cache.getOrCompute("hello", lengthOf),
  cache.getOrCompute("hello", lengthOf),
  computations,
);
clock.advance(50);
cache.set("short", 1, 10);
console.log(cache.get("hello"), cache.get("short"));
clock.advance(60);
console.log(
  cache.get("hello"),
  cache.get("short"),
  cache.getOrCompute("hello", lengthOf),
  computations,
);
for (const w of ["a", "bb", "ccc", "dddd"]) cache.set(w, w.length, w.length * 30);
clock.advance(70);
console.log(`size before prune ${cache.size}, pruned ${cache.prune()}, after ${cache.size}`);
console.log(cache.stats);

const objCache = new TtlCache<number, { id: number; tags: string[] }>(5, clock);
objCache.set(1, { id: 1, tags: ["x"] });
const got = objCache.get(1);
if (got) got.tags.push("mutated");
console.log(objCache.get(1));
