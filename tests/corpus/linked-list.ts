// @category: data-structures
// @known-bug: compiler stack overflow in involvesAny (src/validate/type-rules.ts) on a generic class whose method returns the class at another type argument (`map<U>(): LinkedList<U>`)
// A generic doubly linked list with an iterator, index access, insertion and removal, reversal,
// and a few higher-order helpers.

class ListNode<T> {
  prev: ListNode<T> | null = null;
  next: ListNode<T> | null = null;
  constructor(public value: T) {}
}

class LinkedList<T> implements Iterable<T> {
  private head: ListNode<T> | null = null;
  private tail: ListNode<T> | null = null;
  private count = 0;

  static from<U>(items: Iterable<U>): LinkedList<U> {
    const list = new LinkedList<U>();
    for (const item of items) list.push(item);
    return list;
  }

  get length(): number {
    return this.count;
  }

  push(value: T): void {
    const node = new ListNode(value);
    if (this.tail) {
      this.tail.next = node;
      node.prev = this.tail;
      this.tail = node;
    } else {
      this.head = this.tail = node;
    }
    this.count++;
  }

  unshift(value: T): void {
    const node = new ListNode(value);
    node.next = this.head;
    if (this.head) this.head.prev = node;
    else this.tail = node;
    this.head = node;
    this.count++;
  }

  private nodeAt(index: number): ListNode<T> {
    if (index < 0 || index >= this.count) throw new RangeError(`index ${index} out of bounds`);
    let node = this.head!;
    for (let i = 0; i < index; i++) node = node.next!;
    return node;
  }

  at(index: number): T {
    return this.nodeAt(index).value;
  }

  removeAt(index: number): T {
    const node = this.nodeAt(index);
    if (node.prev) node.prev.next = node.next;
    else this.head = node.next;
    if (node.next) node.next.prev = node.prev;
    else this.tail = node.prev;
    this.count--;
    return node.value;
  }

  reverse(): this {
    let node = this.head;
    this.tail = node;
    let prev: ListNode<T> | null = null;
    while (node) {
      const next = node.next;
      node.next = prev;
      node.prev = next;
      prev = node;
      node = next;
    }
    this.head = prev;
    return this;
  }

  map<U>(f: (x: T) => U): LinkedList<U> {
    const out = new LinkedList<U>();
    for (const x of this) out.push(f(x));
    return out;
  }

  *[Symbol.iterator](): Iterator<T> {
    for (let n = this.head; n; n = n.next) yield n.value;
  }

  toString(): string {
    return `(${[...this].join(" <-> ")})`;
  }
}

const list = LinkedList.from([3, 1, 4, 1, 5, 9, 2, 6]);
console.log(String(list), list.length);
list.unshift(0);
list.push(7);
console.log(`${list}`);
console.log(
  list.at(0),
  list.at(4),
  list.removeAt(0),
  list.removeAt(list.length - 1),
  list.removeAt(3),
);
console.log(list.toString());
console.log(list.reverse().toString());
console.log(list.map((x) => x * x).toString());
let sum = 0;
for (const x of list) sum += x;
console.log("sum", sum);
try {
  list.at(100);
} catch (e) {
  console.log(`${(e as Error).name}: ${(e as Error).message}`);
}
const words = LinkedList.from("the rain in spain".split(" "));
console.log(words.map((w) => w.toUpperCase()).toString(), [...words].length);
