// @expect-reject: CS1240
// The erased base class stores `items` as Value words; the concrete subclass inherits that record.
class Bag<T> {
  items: T[] = [];
  add(x: T): void {
    this.items.push(x);
  }
}
class NumBag extends Bag<number> {}
const b = new NumBag();
b.add(2);
const xs = b.items;
console.log(xs[0]);
