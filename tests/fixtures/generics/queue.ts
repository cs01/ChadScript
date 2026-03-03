class Queue<T> {
  items: T[];
  constructor() {
    this.items = [];
  }
  enqueue(x: T): void {
    this.items.push(x);
  }
  dequeue(): T {
    return this.items.shift();
  }
  isEmpty(): boolean {
    return this.items.length === 0;
  }
  size(): number {
    return this.items.length;
  }
}
const q = new Queue<string>();
q.enqueue("a");
q.enqueue("b");
q.enqueue("c");
console.log(q.dequeue());
console.log(q.size().toString());
console.log("TEST_PASSED");
