// @test-description: subscript on this.field.method() result resolves to ObjectArray
interface Box {
  tag: string;
  n: number;
}

class Inner {
  items: Box[] = [];
  getAll(): Box[] {
    const r: Box[] = [];
    for (let i = 0; i < this.items.length; i++) {
      r.push(this.items[i]);
    }
    return r;
  }
}

class Outer {
  inner: Inner;
  constructor() {
    this.inner = new Inner();
  }
  emit(): void {
    this.inner.items.push({ tag: "a", n: 1 });
    this.inner.items.push({ tag: "b", n: 2 });
    const all = this.inner.getAll();
    const last = all[all.length - 1];
    if (last.tag === "b" && last.n === 2) {
      console.log("TEST_PASSED");
    }
  }
}

function main(): void {
  const o = new Outer();
  o.emit();
}
main();
