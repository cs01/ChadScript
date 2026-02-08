class Foo {
  private bar: string;

  constructor() {
    this.bar = "hello";
  }

  getBar(): string {
    return this.bar;
  }
}

const f = new Foo();
console.log(f.getBar());
