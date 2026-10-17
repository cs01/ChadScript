// A generic class whose method returns the class at another type argument (Box<T> -> Box<U>).
class Box<T> {
  v: T;
  constructor(v: T) {
    this.v = v;
  }
  map<U>(f: (x: T) => U): Box<U> {
    return new Box(f(this.v));
  }
}
const b = new Box(2).map((x) => x + 1).map((x) => `n=${x}`);
console.log(b.v);
