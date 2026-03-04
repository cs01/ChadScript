interface Printable {
  toString(): string;
}

class Wrapper<T> {
  items: T[];
  constructor() {
    this.items = [];
  }
  add(x: T): void {
    this.items.push(x);
  }
  count(): number {
    return this.items.length;
  }
  first(): T {
    return this.items[0];
  }
}

const w = new Wrapper<string>();
w.add("alpha");
w.add("beta");
w.add("gamma");
console.log(w.count().toString());
console.log(w.first());
console.log("TEST_PASSED");
