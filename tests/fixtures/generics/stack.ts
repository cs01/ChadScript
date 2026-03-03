class Stack<T> {
  items: T[];
  constructor() {
    this.items = [];
  }
  push(x: T): void {
    this.items.push(x);
  }
  pop(): T {
    return this.items.pop();
  }
  size(): number {
    return this.items.length;
  }
}
const s = new Stack<string>();
s.push("hello");
s.push("world");
console.log(s.pop());
console.log(s.size().toString());
console.log("TEST_PASSED");
