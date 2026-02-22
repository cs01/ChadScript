// @test-exit-code: 10
class Counter {
  constructor(value: number) {
    this.value = value;
  }

  getValue(): number {
    return this.value;
  }
}

process.exit(new Counter(10).getValue());
