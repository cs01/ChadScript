// @test-compile-error: Arrow functions cannot capture 'this'
// @test-compile-error-native: accessed outside of class method or constructor

class Foo {
  value: number;
  constructor(v: number) {
    this.value = v;
  }
  broken(): number {
    const fn = () => this.value;
    return fn();
  }
}

const f = new Foo(42);
console.log(f.broken().toString());
