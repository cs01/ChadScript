// One generic class used at number, string and object types.
class Stack<T> {
  items: T[] = [];

  push(x: T): void {
    this.items.push(x);
  }

  pop(): T | undefined {
    return this.items.pop();
  }

  peek(): T | undefined {
    return this.items[this.items.length - 1];
  }

  size(): number {
    return this.items.length;
  }

  toArray(): T[] {
    return [...this.items];
  }
}

const ns = new Stack<number>();
ns.push(1);
ns.push(2);
ns.push(3);
console.log(ns.pop(), ns.size(), ns.peek());
console.log((ns.peek() ?? 0) + 10);
console.log(ns);

const ss = new Stack<string>();
ss.push("a");
ss.push("b");
console.log(ss.toArray().join("-"), ss.size());
const top = ss.pop();
if (top !== undefined) console.log(top.toUpperCase());

interface Pt {
  x: number;
  y: number;
}
const ps = new Stack<Pt>();
ps.push({ x: 1, y: 2 });
ps.push({ x: 10, y: 20 });
const pt = ps.pop();
if (pt !== undefined) console.log(pt.x + pt.y, pt);
console.log(ps.toArray().map((q) => q.y));

// A stack of stacks: the type argument is itself a generic class instance.
const nested = new Stack<Stack<number>>();
nested.push(ns);
const inner = nested.peek();
if (inner !== undefined) console.log(inner.size());
