class Inner {
  count: number;
  label: string;
  constructor(count: number, label: string) {
    this.count = count;
    this.label = label;
  }
}

class Outer {
  inner: Inner;
  constructor(inner: Inner) {
    this.inner = inner;
  }

  updateCount(n: number): void {
    this.inner.count = n;
  }

  updateLabel(s: string): void {
    this.inner.label = s;
  }
}

function main(): void {
  const inner = new Inner(0, "start");
  const outer = new Outer(inner);
  outer.updateCount(42);
  outer.updateLabel("done");
  if (outer.inner.count === 42 && outer.inner.label === "done") {
    console.log("TEST_PASSED");
  }
}

main();
