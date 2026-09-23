// @expect-reject: CS1240
// `items` of a Stack<number> holds Value words (the class is compiled once, erased); reading it as
// number[] would decode them as raw doubles.
class Stack<T> {
  items: T[] = [];
  push(x: T): void {
    this.items.push(x);
  }
}
const s = new Stack<number>();
s.push(1);
const raw = s.items;
console.log(raw[0]);
