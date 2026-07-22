class Counter {
  count: number;
  constructor(start: number) {
    this.count = start;
  }
  inc(): void {
    this.count += 1;
  }
  value(): number {
    return this.count;
  }
}
const c = new Counter(5);
c.inc();
c.inc();
c.inc();
console.log(c.value());
