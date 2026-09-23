// Generic functions that take and return closures: callbacks are adapted on the way in, closures
// the generic code creates are adapted on the way out.
function constant<T>(x: T): () => T {
  return () => x;
}

function compose<A, B, C>(f: (a: A) => B, g: (b: B) => C): (a: A) => C {
  return (a: A): C => g(f(a));
}

function memo<T>(make: () => T): () => T {
  let made = 0;
  let cache: T[] = [];
  return () => {
    if (cache.length === 0) {
      made++;
      cache = [make()];
    }
    const first = cache[0];
    return first === undefined ? make() : first;
  };
}

const k = constant(5);
console.log(k() + 1, constant("s")().toUpperCase());
const lenPlusOne = compose(
  (s: string) => s.length,
  (n: number) => n + 1,
);
console.log(
  lenPlusOne("abcd"),
  compose(
    (n: number) => n * 2,
    (n: number) => `<${n}>`,
  )(21),
);
let calls = 0;
const once = memo(() => {
  calls++;
  return { id: calls };
});
console.log(once().id, once().id, calls);
