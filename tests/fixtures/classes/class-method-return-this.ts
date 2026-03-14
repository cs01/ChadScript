class Builder {
  name: string;
  value: number;
  constructor() {
    this.name = "";
    this.value = 0;
  }
  setName(n: string): Builder {
    this.name = n;
    return this;
  }
  setValue(v: number): Builder {
    this.value = v;
    return this;
  }
}

const b = new Builder().setName("test");
const c = b.setValue(42);

if (b.name === "test" && c.value === 42) {
  console.log("TEST_PASSED");
}
