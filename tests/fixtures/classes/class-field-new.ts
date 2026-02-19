class Inner {
  value: number;

  constructor() {
    this.value = 99;
  }

  getValue(): number {
    return this.value;
  }
}

class Outer {
  count: number;

  constructor() {
    this.count = 0;
  }

  getCount(): number {
    return this.count;
  }
}

const outer = new Outer();
if (outer.getCount() !== 0) {
  process.exit(1);
}

const inner = new Inner();
if (inner.getValue() !== 99) {
  process.exit(2);
}

console.log("TEST_PASSED");
