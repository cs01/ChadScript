// Defaults on class methods, constructors (with super calls passing fewer args),
// overrides with different defaults dispatched virtually (the override's default wins), interface
// dispatch, and defaults that read `this`.
class Animal {
  name: string;
  legs: number;
  constructor(name: string, legs = 4) {
    this.name = name;
    this.legs = legs;
  }
  speak(times = 1): string {
    return `${this.name}:${"...".repeat(times)}`;
  }
  describe(prefix?: string): string {
    return `${prefix ?? "a"} ${this.name} with ${this.legs} legs`;
  }
}

class Bird extends Animal {
  constructor(name: string) {
    super(name, 2);
  }
  override speak(times = 2): string {
    return `${this.name}:${"tweet".repeat(times)}`;
  }
}

class Snake extends Animal {
  constructor(name = "snek") {
    super(name, 0);
  }
}

class Cat extends Animal {
  constructor(name: string) {
    super(name);
  }
}

class Puppy extends Animal {
  tag = "pup";
}

const zoo: Animal[] = [
  new Animal("dog"),
  new Bird("tweety"),
  new Snake(),
  new Snake("sid"),
  new Cat("tom"),
  new Puppy("rex"),
  new Puppy("fido", 3),
];
for (const a of zoo) console.log(a.speak(), a.speak(3), a.describe(), a.describe("the"));

class Counter {
  step: number;
  total = 0;
  constructor(step = 1) {
    this.step = step;
  }
  add(by: number = this.step): Counter {
    this.total += by;
    return this;
  }
}
function make(step = 5): Counter {
  return new Counter(step);
}
const k = new Counter();
k.add().add(10).add();
console.log(k.total, make().add().total, make(2).add().add(undefined).total);

interface Shape {
  area(scale?: number): number;
}
class Sq implements Shape {
  side: number;
  constructor(side: number) {
    this.side = side;
  }
  area(scale = 1): number {
    return this.side * this.side * scale;
  }
}
class Circ implements Shape {
  r: number;
  constructor(r: number) {
    this.r = r;
  }
  area(scale?: number): number {
    return Math.round(3 * this.r * this.r * (scale ?? 2));
  }
}
const shapes: Shape[] = [new Sq(2), new Circ(1)];
for (const s of shapes) console.log(s.area(), s.area(10));

class Base {
  hello(who = "base"): string {
    return "hello " + who;
  }
}
class Derived extends Base {
  override hello(who = "derived"): string {
    return super.hello() + " / " + super.hello(who);
  }
}
const d: Base = new Derived();
console.log(d.hello(), d.hello("x"), new Base().hello());

class Tree {
  root: number | null = 5;
  height(n: number | null = this.root): number {
    return n === null ? -1 : n;
  }
}
const t = new Tree();
console.log(t.height(), t.height(null), t.height(9));
t.root = null;
console.log(t.height());
