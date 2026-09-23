// Binary trees (the Benchmarks Game program): allocation throughput and collector cost. Builds
// millions of short-lived trees while one long-lived tree stays reachable across every collection.
class TreeNode {
  left: TreeNode | null;
  right: TreeNode | null;
  constructor(left: TreeNode | null, right: TreeNode | null) {
    this.left = left;
    this.right = right;
  }
}

function bottomUp(depth: number): TreeNode {
  if (depth === 0) return new TreeNode(null, null);
  return new TreeNode(bottomUp(depth - 1), bottomUp(depth - 1));
}

function itemCheck(node: TreeNode): number {
  if (node.left === null || node.right === null) return 1;
  return 1 + itemCheck(node.left) + itemCheck(node.right);
}

const minDepth = 4;
const maxDepth = 16;

const stretch = maxDepth + 1;
console.log(`stretch tree of depth ${stretch}\t check: ${itemCheck(bottomUp(stretch))}`);

const longLived = bottomUp(maxDepth);
for (let depth = minDepth; depth <= maxDepth; depth += 2) {
  let iterations = 1;
  for (let k = 0; k < maxDepth - depth + minDepth; k++) iterations *= 2;
  let check = 0;
  for (let i = 0; i < iterations; i++) check += itemCheck(bottomUp(depth));
  console.log(`${iterations}\t trees of depth ${depth}\t check: ${check}`);
}
console.log(`long lived tree of depth ${maxDepth}\t check: ${itemCheck(longLived)}`);
