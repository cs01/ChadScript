class TreeNode {
  value: number;
  left: TreeNode | null;
  right: TreeNode | null;
  constructor(value: number) {
    this.value = value;
    this.left = null;
    this.right = null;
  }
}

function insert(root: TreeNode | null, value: number): TreeNode {
  if (root === null) {
    return new TreeNode(value);
  }
  if (value < root.value) {
    root.left = insert(root.left, value);
  } else {
    root.right = insert(root.right, value);
  }
  return root;
}

function sumTree(node: TreeNode | null): number {
  if (node === null) {
    return 0;
  }
  return node.value + sumTree(node.left) + sumTree(node.right);
}

function countNodes(node: TreeNode | null): number {
  if (node === null) {
    return 0;
  }
  return 1 + countNodes(node.left) + countNodes(node.right);
}

function main(): void {
  let root: TreeNode | null = null;
  root = insert(root, 5);
  root = insert(root, 3);
  root = insert(root, 7);
  root = insert(root, 1);
  root = insert(root, 9);

  const sum = sumTree(root);
  const count = countNodes(root);
  if (sum === 25 && count === 5) {
    console.log("TEST_PASSED");
  }
}

main();
