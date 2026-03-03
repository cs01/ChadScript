class Box<T> {
  value: T;
  constructor(v: T) {
    this.value = v;
  }
  get(): T {
    return this.value;
  }
  set(v: T): void {
    this.value = v;
  }
}
const b = new Box<string>("hello");
console.log(b.get());
b.set("world");
console.log(b.get());
console.log("TEST_PASSED");
