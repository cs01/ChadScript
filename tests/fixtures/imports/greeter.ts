export class Greeter {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  greet(): string {
    return "hello " + this.name;
  }
}

export function makeGreeter(name: string): Greeter {
  return new Greeter(name);
}
