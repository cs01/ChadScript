class Animal {
  name: string;
  constructor(n: string) {
    this.name = n;
  }
  speak(): string {
    return this.name + " speaks";
  }
}
class Container<T> {
  items: T[];
  constructor() {
    this.items = [];
  }
  add(x: T): void {
    this.items.push(x);
  }
  get(i: number): T {
    return this.items[i];
  }
  size(): number {
    return this.items.length;
  }
}
const c = new Container<Animal>();
c.add(new Animal("cat"));
c.add(new Animal("dog"));
const a: Animal = c.get(0);
console.log(a.speak());
console.log(c.size().toString());
console.log("TEST_PASSED");
