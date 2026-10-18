// Defaults and optional parameters on generic functions and generic class methods.
function pick<T>(xs: T[], i = 0): T | undefined {
  return xs[i];
}
console.log(pick([1, 2, 3]), pick(["a", "b"], 1), pick([true], 5));

function orElse<T>(v: T | undefined, fallback?: T): T | string {
  return v ?? fallback ?? "nothing";
}
console.log(orElse(1), orElse(undefined, 2), orElse<string>(undefined));

class Box<T> {
  items: T[] = [];
  add(x: T, times = 1): Box<T> {
    for (let i = 0; i < times; i++) this.items.push(x);
    return this;
  }
  count(of?: T): number {
    return of === undefined ? this.items.length : this.items.filter((x) => x === of).length;
  }
}
const b = new Box<number>().add(1).add(2, 3);
console.log(b.count(), b.count(2), b.count(undefined));

function wrap<T>(x: T, label = "v", tag?: string): string {
  return `${label}=${String(x)}${tag ?? ""}`;
}
console.log(wrap(1), wrap("s", "k"), wrap(true, undefined, "!"));
