class Item {
  label: string;
  constructor(label: string) {
    this.label = label;
  }
}

class Inner {
  getItems(): Item[] {
    const items: Item[] = [];
    items.push(new Item("hello"));
    items.push(new Item("world"));
    return items;
  }
}

class Outer {
  inner: Inner;
  constructor() {
    this.inner = new Inner();
  }
  run(): void {
    const first: Item = this.inner.getItems()[0];
    if (first.label === "hello") {
      console.log("TEST_PASSED");
    }
  }
}

const o = new Outer();
o.run();
