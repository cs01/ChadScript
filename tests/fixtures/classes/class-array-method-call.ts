class Counter {
  count: number;
  name: string;
  constructor(name: string) {
    this.name = name;
    this.count = 0;
  }
  increment(): void {
    this.count = this.count + 1;
  }
  getCount(): number {
    return this.count;
  }
}

function testCounters(): void {
  const counters: Counter[] = [];
  counters.push(new Counter("a"));
  counters.push(new Counter("b"));

  const first = counters[0];
  first.increment();
  first.increment();

  const second = counters[1];
  second.increment();

  console.log(first.name);
  console.log(first.getCount());
  console.log(second.name);
  console.log(second.getCount());

  if (first.getCount() === 2 && second.getCount() === 1) {
    console.log("TEST_PASSED");
  }
}

testCounters();
