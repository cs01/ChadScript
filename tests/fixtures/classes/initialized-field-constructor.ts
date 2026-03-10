// @test-description: class with field initialized in constructor compiles fine

class Person {
  name: string;
  age: number;

  constructor(n: string, a: number) {
    this.name = n;
    this.age = a;
  }
}

const p = new Person("Alice", 30);
if (p.name === "Alice" && p.age === 30) {
  console.log("TEST_PASSED");
}
