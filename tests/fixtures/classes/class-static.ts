class Counter {
  count: number;
  constructor() {
    this.count = 0;
  }
  increment(): void {
    this.count = this.count + 1;
  }
  getCount(): number {
    return this.count;
  }
  static create(): Counter {
    return new Counter();
  }
  static add(a: number, b: number): number {
    return a + b;
  }
  static greet(name: string): string {
    return "hello " + name;
  }
}

const c = Counter.create();
c.increment();
c.increment();
c.increment();
console.log(c.getCount());

console.log(Counter.add(10, 20));
console.log(Counter.greet("world"));
