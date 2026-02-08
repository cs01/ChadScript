class Foo {
  counter: number;

  constructor() {
    this.counter = 0;
  }

  nextVal(): string {
    return `%${this.counter++}`;
  }
}

const foo = new Foo();
console.log(foo.nextVal());
console.log(foo.nextVal());
console.log(foo.nextVal());
