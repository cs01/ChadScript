class Counter {
  count: number;

  constructor() {
    this.count = 0;
  }

  increment(): void {
    this.count = this.count + 1;
  }

  decrement(): void {
    this.count = this.count - 1;
  }

  getCount(): number {
    return this.count;
  }

  reset(): void {
    this.count = 0;
  }
}

function testClassMethods(): void {
  const c = new Counter();

  c.increment();
  c.increment();
  c.increment();

  if (c.getCount() !== 3) {
    console.log("FAIL: count should be 3, got " + c.getCount());
    process.exit(1);
  }

  c.decrement();
  if (c.getCount() !== 2) {
    console.log("FAIL: count should be 2, got " + c.getCount());
    process.exit(1);
  }

  c.reset();
  if (c.getCount() !== 0) {
    console.log("FAIL: count should be 0, got " + c.getCount());
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testClassMethods();
