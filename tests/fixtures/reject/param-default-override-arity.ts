// @expect-reject: CS1237
class Base {
  speak(times = 1): string {
    return "x".repeat(times);
  }
}
class Quiet extends Base {
  override speak(): string {
    return "";
  }
}
const b: Base = new Quiet();
console.log(b.speak(2));
