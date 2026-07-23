// Self-referential shapes: trees, linked lists, and mutual recursion. The resolved type is a
// CYCLIC graph (see type-translation's objectShapeCache) rather than an infinite one — which
// matches the runtime, where a field holding an object is just a pointer slot.

interface TreeNode {
  value: number;
  left: TreeNode | null;
  right: TreeNode | null;
}

function sum(node: TreeNode | null): number {
  if (node === null) return 0;
  return node.value + sum(node.left) + sum(node.right);
}

function depth(node: TreeNode | null): number {
  if (node === null) return 0;
  return 1 + Math.max(depth(node.left), depth(node.right));
}

// The canonical BST insert: mutates optional fields at varying depth, which is exactly the shape
// that used to segfault (a present value stored into a `T | null` slot without being boxed) and
// then read back garbage (the box read as the record).
function insert(node: TreeNode | null, value: number): TreeNode {
  if (node === null) return { value, left: null, right: null };
  if (value < node.value) {
    node.left = insert(node.left, value);
  } else {
    node.right = insert(node.right, value);
  }
  return node;
}

let root: TreeNode | null = null;
for (const v of [5, 3, 8, 1, 4, 7, 9, 2, 6]) {
  root = insert(root, v);
}
console.log(sum(root), depth(root));

// In-order traversal reads every optional field back at depth.
function inorder(node: TreeNode | null, acc: number[]): void {
  if (node === null) return;
  inorder(node.left, acc);
  acc.push(node.value);
  inorder(node.right, acc);
}
const sorted: number[] = [];
inorder(root, sorted);
console.log(sorted.join(","));

// A linked list: the classic single self-reference, built by prepending.
interface ListNode {
  head: number;
  tail: ListNode | null;
}

let list: ListNode | null = null;
for (let i = 5; i > 0; i--) {
  list = { head: i, tail: list };
}
let total = 0;
let cursor: ListNode | null = list;
while (cursor !== null) {
  total = total + cursor.head;
  cursor = cursor.tail;
}
console.log(total);

// Mutual recursion between two declarations.
interface Branch {
  label: string;
  leaf: Leaf | null;
}
interface Leaf {
  weight: number;
  parent: Branch | null;
}

const branch: Branch = { label: "b", leaf: null };
const leaf: Leaf = { weight: 3, parent: branch };
console.log(branch.label, leaf.weight, leaf.parent === null ? "none" : "linked");

// console.log of a recursive structure: Node stops descending at depth 2 and prints a
// placeholder, which is also what makes this emittable at all (the shape is cyclic).
const small: ListNode = { head: 1, tail: { head: 2, tail: { head: 3, tail: null } } };
console.log(small);
