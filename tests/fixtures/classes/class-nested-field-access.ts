class Inner {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
}

class Outer {
  inner: Inner;
  name: string;
  constructor(name: string, val: number) {
    this.name = name;
    this.inner = new Inner(val);
  }
}

const obj = new Outer("test", 42);
if (obj.inner.value === 42 && obj.name === "test") {
  console.log("TEST_PASSED");
}
