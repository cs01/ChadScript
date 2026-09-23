// @category: data-structures
// A generic LRU cache built on Map insertion order, with hit/miss statistics, used to memoize an
// expensive function.

class LRUCache<K, V> {
  private readonly map = new Map<K, V>();
  hits = 0;
  misses = 0;
  evictions = 0;

  constructor(private readonly capacity: number) {
    if (capacity <= 0) throw new RangeError("capacity must be positive");
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) {
      this.misses++;
      return undefined;
    }
    const value = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, value);
    this.hits++;
    return value;
  }

  set(key: K, value: V): this {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.capacity) {
      const oldest = this.map.keys().next().value as K;
      this.map.delete(oldest);
      this.evictions++;
    }
    this.map.set(key, value);
    return this;
  }

  keys(): K[] {
    return [...this.map.keys()];
  }

  get size(): number {
    return this.map.size;
  }
}

const cache = new LRUCache<string, number>(3);
cache.set("a", 1).set("b", 2).set("c", 3);
console.log(cache.keys());
cache.get("a");
cache.set("d", 4);
console.log(cache.keys(), cache.get("b"));
cache.set("c", 30);
console.log(cache.keys(), cache.get("c"), cache.size);

let calls = 0;
function slowFib(n: number): number {
  calls++;
  return n < 2 ? n : slowFib(n - 1) + slowFib(n - 2);
}

const memo = new LRUCache<number, number>(50);
function fib(n: number): number {
  const hit = memo.get(n);
  if (hit !== undefined) return hit;
  const v = n < 2 ? n : fib(n - 1) + fib(n - 2);
  memo.set(n, v);
  return v;
}

console.log(`fib(40) = ${fib(40)}, hits=${memo.hits}, misses=${memo.misses}`);
console.log(`slowFib(20) = ${slowFib(20)} in ${calls} calls`);
console.log(`evictions: ${cache.evictions}, ${memo.evictions}`);

try {
  new LRUCache<string, string>(0);
} catch (e) {
  console.log(e instanceof RangeError, (e as Error).message);
}
