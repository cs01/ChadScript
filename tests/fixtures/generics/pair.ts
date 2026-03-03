class Pair<A, B> {
  first: A;
  second: B;
  constructor(a: A, b: B) {
    this.first = a;
    this.second = b;
  }
  getFirst(): A {
    return this.first;
  }
  getSecond(): B {
    return this.second;
  }
}
const p = new Pair<string, string>("foo", "bar");
console.log(p.getFirst());
console.log(p.getSecond());
const p2 = new Pair<string, string>("x", "y");
console.log(p2.getFirst());
console.log("TEST_PASSED");
