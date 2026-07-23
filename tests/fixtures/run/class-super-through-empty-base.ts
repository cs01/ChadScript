// `super(...)` / `super.m()` must target the class that actually DECLARES the constructor or
// method, not the immediate base. A base that declares neither (an "empty" pass-through class)
// emits no HFunc under that name, so naming it produced a call to a function never emitted.

class A {
  x: number;
  constructor(x: number) {
    this.x = x;
  }
  describe(): string {
    return `A(${this.x})`;
  }
}

// Declares nothing: no constructor, no fields, no methods.
class B extends A {}

class C extends B {
  tag: string;
  constructor(x: number, tag: string) {
    super(x); // resolves past B to A.constructor
    this.tag = tag;
  }
  override describe(): string {
    return `C[${super.describe()}:${this.tag}]`; // resolves past B to A.describe
  }
}

const c = new C(5, "t");
console.log(c.x, c.tag);
console.log(c.describe());

// A base with no constructor work at all: `super()` has nothing to call.
class Empty {}
class UsesEmpty extends Empty {
  n: number;
  constructor(n: number) {
    super();
    this.n = n;
  }
}
console.log(new UsesEmpty(3).n);
