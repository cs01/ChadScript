class Greeter {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  greet(): string {
    return "Hello, " + this.name + "!";
  }
}
const g = new Greeter("world");
console.log(g.greet());
