// Collector: many short-lived trees (a few collections' worth of garbage even without
// CHAD_GC_STRESS) while a long-lived tree built first stays reachable only from a module variable.
// A collector that drops a live node or reuses its memory changes the checksums.
class TreeNode {
  left: TreeNode | null;
  right: TreeNode | null;
  label: string;
  weight: number;
  constructor(left: TreeNode | null, right: TreeNode | null, label: string, weight: number) {
    this.left = left;
    this.right = right;
    this.label = label;
    this.weight = weight;
  }
}

function build(depth: number, tag: string): TreeNode {
  if (depth === 0) return new TreeNode(null, null, tag, 0.5);
  return new TreeNode(build(depth - 1, tag + "l"), build(depth - 1, tag + "r"), tag, depth * 1.5);
}

function check(n: TreeNode): number {
  if (n.left === null || n.right === null) return n.weight + n.label.length;
  return n.weight + check(n.left) + check(n.right);
}

const longLived = build(6, "L");
let total = 0;
for (let round = 0; round < 40; round++) {
  const t = build(8, "t" + round);
  total += check(t);
}
console.log("churn", total);
const leftChild = longLived.left;
console.log("long lived", check(longLived), leftChild === null ? "none" : leftChild.label);
