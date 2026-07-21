// @test-compile-error: (getter/setter) is not supported
// @test-compile-error-native: 'get value()' is not supported
// @test-description: getters and setters are a compile error
class Counter {
  private _value: number = 0;

  get value(): number {
    return this._value;
  }
}

const c = new Counter();
