// @category: generics
// A lazy, generic sequence library on top of generators: map/filter/take/skip/zip/chunk,
// infinite sources, and terminal reducers. Nothing is computed until a terminal is called.

class Seq<T> implements Iterable<T> {
  private constructor(private readonly source: () => Iterator<T>) {}

  static of<T>(...items: T[]): Seq<T> {
    return new Seq(() => items[Symbol.iterator]());
  }

  static from<T>(iterable: Iterable<T>): Seq<T> {
    return new Seq(() => iterable[Symbol.iterator]());
  }

  static range(start: number, end = Infinity, step = 1): Seq<number> {
    return new Seq(function* () {
      for (let i = start; i < end; i += step) yield i;
    });
  }

  static iterate<T>(seed: T, next: (x: T) => T): Seq<T> {
    return new Seq(function* () {
      let x = seed;
      for (;;) {
        yield x;
        x = next(x);
      }
    });
  }

  [Symbol.iterator](): Iterator<T> {
    return this.source();
  }

  map<U>(f: (x: T, i: number) => U): Seq<U> {
    const self = this;
    return new Seq(function* () {
      let i = 0;
      for (const x of self) yield f(x, i++);
    });
  }

  filter(pred: (x: T) => boolean): Seq<T> {
    const self = this;
    return new Seq(function* () {
      for (const x of self) if (pred(x)) yield x;
    });
  }

  take(n: number): Seq<T> {
    const self = this;
    return new Seq(function* () {
      if (n <= 0) return;
      let i = 0;
      for (const x of self) {
        yield x;
        if (++i >= n) return;
      }
    });
  }

  skip(n: number): Seq<T> {
    const self = this;
    return new Seq(function* () {
      let i = 0;
      for (const x of self) if (i++ >= n) yield x;
    });
  }

  zip<U>(other: Iterable<U>): Seq<[T, U]> {
    const self = this;
    return new Seq(function* () {
      const it = other[Symbol.iterator]();
      for (const x of self) {
        const r = it.next();
        if (r.done) return;
        yield [x, r.value] as [T, U];
      }
    });
  }

  chunk(size: number): Seq<T[]> {
    const self = this;
    return new Seq(function* () {
      let buf: T[] = [];
      for (const x of self) {
        buf.push(x);
        if (buf.length === size) {
          yield buf;
          buf = [];
        }
      }
      if (buf.length > 0) yield buf;
    });
  }

  reduce<A>(f: (acc: A, x: T) => A, init: A): A {
    let acc = init;
    for (const x of this) acc = f(acc, x);
    return acc;
  }

  toArray(): T[] {
    return [...this];
  }

  first(): T | undefined {
    for (const x of this) return x;
    return undefined;
  }
}

let evaluated = 0;
const squares = Seq.range(1)
  .map((n) => {
    evaluated++;
    return n * n;
  })
  .filter((n) => n % 2 === 1);
console.log(squares.take(5).toArray(), `evaluated ${evaluated}`);
console.log(
  Seq.iterate(1, (x) => x * 3)
    .skip(2)
    .take(4)
    .toArray(),
);
const fib = Seq.iterate<[number, number]>([0, 1], ([a, b]) => [b, a + b]).map(([a]) => a);
console.log(fib.take(15).toArray().join(","));
console.log(fib.filter((x) => x > 1000).first());
console.log(Seq.of("a", "b", "c", "d").zip(Seq.range(10)).toArray());
console.log(
  Seq.range(0, 10)
    .chunk(4)
    .map((c) => c.join(""))
    .toArray(),
);
console.log(Seq.from(new Set([3, 1, 3, 2])).reduce((s, x) => s + x, 0));
console.log(
  Seq.from("hello")
    .map((c, i) => c.repeat(i + 1))
    .toArray()
    .join("-"),
);
