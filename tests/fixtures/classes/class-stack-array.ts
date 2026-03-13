class Stack {
  items: number[];
  constructor() {
    this.items = [];
  }
  push(item: number): void {
    this.items.push(item);
  }
  pop(): number {
    return this.items.pop();
  }
  peek(): number {
    return this.items[this.items.length - 1];
  }
  isEmpty(): boolean {
    return this.items.length === 0;
  }
  size(): number {
    return this.items.length;
  }
}

const s = new Stack();
if (!s.isEmpty()) process.exit(1);
s.push(10);
s.push(20);
s.push(30);
if (s.size() !== 3) process.exit(1);
if (s.peek() !== 30) process.exit(1);
const v = s.pop();
if (v !== 30) process.exit(1);
if (s.size() !== 2) process.exit(1);

console.log("TEST_PASSED");
