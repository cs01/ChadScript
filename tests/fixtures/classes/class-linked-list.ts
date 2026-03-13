class ListNode {
  value: number;
  next: ListNode | null;
  constructor(value: number) {
    this.value = value;
    this.next = null;
  }
}

const a = new ListNode(1);
const b = new ListNode(2);
const c = new ListNode(3);
a.next = b;
b.next = c;

let current: ListNode | null = a;
let sum = 0;
while (current !== null) {
  sum = sum + current.value;
  current = current.next;
}

if (sum !== 6) {
  process.exit(1);
}
console.log("TEST_PASSED");
