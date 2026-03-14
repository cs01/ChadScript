class Counter {
  count: number;
  constructor() {
    this.count = 0;
  }

  increment(): void {
    this.count = this.count + 1;
  }
}

function main(): void {
  const items: Counter[] = [];
  items.push(new Counter());
  items.push(new Counter());
  items[0].increment();
  items[0].increment();
  items[1].increment();
  if (items[0].count === 2 && items[1].count === 1) {
    console.log("TEST_PASSED");
  }
}

main();
