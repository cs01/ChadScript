// @expect-reject: CS1238
// %d calls the class's own toString (through valueOf), which the formatter does not model.
class Money {
  cents = 250;
  toString(): string {
    return String(this.cents);
  }
}
console.log("%d", new Money());
