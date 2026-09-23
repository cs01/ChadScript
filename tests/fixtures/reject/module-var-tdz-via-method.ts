// @expect-reject: CS1228
// Constructing the class runs its field initializer, which reads `base` before it is initialized.
class Box {
  v = base + 1;
  get(): number {
    return this.v;
  }
}
const b = new Box();
const base = 10;
console.log(b.get());
