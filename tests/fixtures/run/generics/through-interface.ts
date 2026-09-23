// A generic class used through a generic interface, and a generic function over the interface.
interface Container<T> {
  get(): T;
  set(v: T): void;
}

class Box<T> implements Container<T> {
  value: T;
  constructor(v: T) {
    this.value = v;
  }
  get(): T {
    return this.value;
  }
  set(v: T): void {
    this.value = v;
  }
}

function swapIn<T>(c: Container<T>, v: T): T {
  const old = c.get();
  c.set(v);
  return old;
}

const b = new Box<number>(1);
console.log(swapIn(b, 2), b.get(), b.value + 1);
const c: Container<string> = new Box("x");
c.set("yz");
console.log(c.get().toUpperCase(), swapIn(c, "w"), c.get());
const boxes: Container<boolean>[] = [new Box(true), new Box(false)];
console.log(boxes.map((x) => x.get()));
