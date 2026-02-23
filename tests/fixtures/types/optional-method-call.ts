// Optional method call: obj?.method() — returns undefined if obj is null
class Greeter {
  greeting: string;
  constructor(msg: string) {
    this.greeting = msg;
  }
  greet(): string {
    return this.greeting;
  }
}

const g: Greeter = new Greeter("hello");
const result = g?.greet();

if (result === "hello") {
  console.log("TEST_PASSED");
}
