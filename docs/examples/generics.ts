// Generic functions and classes. Type parameters are erased: each declaration compiles once.
function firstOr<T>(xs: T[], fallback: T): T {
  return xs[0] ?? fallback;
}

class Stack<T> {
  items: T[] = [];
  push(x: T): void {
    this.items.push(x);
  }
  pop(): T | undefined {
    return this.items.pop();
  }
  size(): number {
    return this.items.length;
  }
}

interface HasId {
  id: number;
}
function maxId<T extends HasId>(xs: T[]): number {
  let best = -1;
  for (const x of xs) best = Math.max(best, x.id);
  return best;
}

console.log(firstOr([3, 4], 0), firstOr<string>([], "empty"));

const s = new Stack<string>();
s.push("a");
s.push("b");
console.log(s.pop(), s.size());

console.log(
  maxId([
    { id: 4, name: "x" },
    { id: 9, name: "y" },
  ]),
);
