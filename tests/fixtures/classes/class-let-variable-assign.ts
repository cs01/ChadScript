class Node {
  value: number;
  next: Node | null;
  constructor(value: number) {
    this.value = value;
    this.next = null;
  }
}

function main(): void {
  const a = new Node(1);
  a.next = new Node(2);
  let current = a;
  const n = current.next;
  if (n === null) {
    console.log("FAIL: n should not be null");
    return;
  }
  console.log(n.value);
  if (n.value === 2) {
    console.log("TEST_PASSED");
  }
}

main();
