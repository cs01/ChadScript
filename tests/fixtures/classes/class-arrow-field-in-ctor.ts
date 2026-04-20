// @test-description: issue #587 — arrow literal assigned to class field inside ctor body
class Foo {
  cb: (x: number) => number;
  constructor() {
    this.cb = (x) => x * 2;
  }
}

const f = new Foo();
if (f.cb(21) === 42) {
  console.log("TEST_PASSED");
}
