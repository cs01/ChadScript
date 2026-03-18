// @test-compile-error: union type alias with mixed representations
type Mixed = string | number;

interface Config {
  value: Mixed;
}

const c: Config = { value: "hello" };
console.log(c.value);
