// A derived class with field initializers but NO explicit constructor gets a synthesized one.
// JS's default derived constructor is `constructor(...args) { super(...args); }`, so the `new`
// arguments must reach the base constructor — a synthesized arg-less `super()` silently zeroed
// every inherited field.

class Base {
  x: number;
  label: string;
  constructor(x: number, label: string) {
    this.x = x;
    this.label = label;
  }
}

// Field initializer + no ctor: the synthesized ctor must forward (x, label) to Base.
class Derived extends Base {
  y: number = 7;
}

// Two synthesized ctors in a row: Deeper forwards through Derived's synthesized ctor to Base.
class Deeper extends Derived {
  z: number = 9;
}

// Field initializers run AFTER super() returns, so they win over an inherited assignment.
class Overwriter extends Base {
  override x: number = 100;
}

const d = new Derived(42, "hi");
console.log(d.x, d.label, d.y);

const deep = new Deeper(1, "deep");
console.log(deep.x, deep.label, deep.y, deep.z);

const o = new Overwriter(5, "over");
console.log(o.x, o.label);

// Inherited methods still see the forwarded state.
class Greeter extends Base {
  greeting: string = "hello";
  greet(): string {
    return `${this.greeting} ${this.label}:${this.x}`;
  }
}
console.log(new Greeter(3, "g").greet());
