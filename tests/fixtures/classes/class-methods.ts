class Counter {
  count: number;
  constructor(initial: number) {
    this.count = initial;
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
  add(n: number): void {
    this.count = this.count + n;
  }
}

let c: Counter = new Counter(10);
console.log(c.getCount());
c.increment();
c.increment();
c.increment();
console.log(c.getCount());
c.decrement();
console.log(c.getCount());
c.add(5);
console.log(c.getCount());

let c2: Counter = new Counter(0);
console.log(c2.getCount());
c2.add(100);
console.log(c2.getCount());
