class ListNode {
  value: number;
  next: ListNode | null;
  constructor(value: number) {
    this.value = value;
    this.next = null;
  }
}

function reverseList(head: ListNode | null): ListNode | null {
  let prev: ListNode | null = null;
  let current = head;
  while (current !== null) {
    const next = current.next;
    current.next = prev;
    prev = current;
    current = next;
  }
  return prev;
}

function listToString(head: ListNode | null): string {
  let result = "";
  let cur = head;
  while (cur !== null) {
    if (result !== "") result = result + "->";
    result = result + cur.value.toString();
    cur = cur.next;
  }
  return result;
}

function main(): void {
  const a = new ListNode(1);
  const b = new ListNode(2);
  const c = new ListNode(3);
  a.next = b;
  b.next = c;

  const before = listToString(a);
  const reversed = reverseList(a);
  const after = listToString(reversed);

  if (before === "1->2->3" && after === "3->2->1") {
    console.log("TEST_PASSED");
  }
}

main();
