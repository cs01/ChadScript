// @test-compile-error: union type alias with mixed representations
// @test-description: type alias unions with mixed representations are a compile error
type StringOrNumber = string | number;

function display(val: StringOrNumber): void {
  console.log("value");
}

display("hello");
