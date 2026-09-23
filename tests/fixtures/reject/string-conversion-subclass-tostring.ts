// @expect-reject: CS1238
// The base class declares no toString, so which conversion runs depends on the runtime class.
class Base {
  n: number = 1;
}
class Loud extends Base {
  override toString(): string {
    return "loud";
  }
}
const b: Base = new Loud();
console.log(String(b));
