// @test-skip
class Counter {
  static count: number;

  static increment(): void {
    Counter.count = Counter.count + 1;
  }

  static getCount(): number {
    return Counter.count;
  }
}

Counter.count = 0;
Counter.increment();
Counter.increment();
Counter.increment();
const result = Counter.getCount();

if (result === 3) {
  console.log("TEST_PASSED");
}
