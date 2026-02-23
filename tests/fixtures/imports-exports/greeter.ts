// @test-skip
// Helper module that default-exports a class
class Greeter {
  greeting: string;

  constructor(msg: string) {
    this.greeting = msg;
  }

  greet(): string {
    return this.greeting;
  }
}

export default Greeter;
