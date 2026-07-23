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

// Built bottom-up: each level is a complete value before it becomes a child.
const leftLeaf: TreeNode = { value: 1, left: null, right: null };
const rightLeaf: TreeNode = { value: 4, left: null, right: null };
const left: TreeNode = { value: 3, left: leftLeaf, right: null };
const root: TreeNode = { value: 5, left, right: rightLeaf };
console.log(sum(root), depth(root));

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
