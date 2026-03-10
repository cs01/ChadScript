// @test-compile-error: uninitialized field 'name'
// @test-description: compile error for uninitialized class field

class Broken {
  name: string;
}

const b = new Broken();
console.log(b.name);
