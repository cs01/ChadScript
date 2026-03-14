class ListNode {
  value: number;
  next: ListNode | null;
  constructor(value: number) {
    this.value = value;
    this.next = null;
  }
}

function main(): void {
  const a = new ListNode(1);
  const b = new ListNode(2);
  const c = new ListNode(3);
  a.next = b;
  a.next.next = c;

  let sum = a.value;
  let cur = a.next;
  while (cur !== null) {
    sum = sum + cur.value;
    cur = cur.next;
  }
  if (sum === 6) {
    console.log("TEST_PASSED");
  }
}

main();
