class Node {
  value: number;
  next: Node | null;
  constructor(value: number) {
    this.value = value;
    this.next = null;
  }
}

function sumList(node: Node | null): number {
  if (node === null) {
    return 0;
  }
  return node.value + sumList(node.next);
}

function main(): void {
  const c = new Node(30);
  const b = new Node(20);
  b.next = c;
  const a = new Node(10);
  a.next = b;

  const result = sumList(a);
  if (result === 60) {
    console.log("TEST_PASSED");
  }
}

main();
