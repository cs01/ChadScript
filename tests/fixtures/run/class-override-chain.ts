class A {
  value: number;
  constructor(v: number) {
    this.value = v;
  }
  describe(): string {
    return "A(" + this.value + ")";
  }
  double(): number {
    return this.value * 2;
  }
}
class B extends A {
  override describe(): string {
    return "B(" + this.value + "), double=" + this.double();
  }
}
class C extends B {
  override double(): number {
    return this.value * 3;
  }
}
const items: A[] = [new A(1), new B(2), new C(3)];
for (const it of items) {
  console.log(it.describe());
  console.log(it.double());
}
