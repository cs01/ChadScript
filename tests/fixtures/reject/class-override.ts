// @expect-reject: CS1000
class Base {
  greet(): string {
    return "base";
  }
}
class Sub extends Base {
  override greet(): string {
    return "sub";
  }
}
console.log(new Sub().greet());
