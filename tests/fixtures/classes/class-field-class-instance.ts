// @test-skip
class Node {
  value: number;
  next: Node | null;
  constructor(value: number) {
    this.value = value;
    this.next = null;
  }
}

function main(): void {
  const head = new Node(1);
  head.next = new Node(2);
  const second = head.next;
  second.next = new Node(3);

  console.log(head.value);
  const n2 = head.next;
  console.log(n2.value);
  const n3 = n2.next;
  console.log(n3.value);

  if (head.value === 1 && n2.value === 2 && n3.value === 3) {
    console.log("TEST_PASSED");
  }
}

main();
