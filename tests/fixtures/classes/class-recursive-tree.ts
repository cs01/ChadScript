class TreeNode {
  value: number;
  left: TreeNode | null;
  right: TreeNode | null;
  constructor(value: number) {
    this.value = value;
    this.left = null;
    this.right = null;
  }
  sum(): number {
    let total = this.value;
    if (this.left !== null) {
      const l = this.left;
      total = total + l.sum();
    }
    if (this.right !== null) {
      const r = this.right;
      total = total + r.sum();
    }
    return total;
  }
}

function main(): void {
  const root = new TreeNode(1);
  root.left = new TreeNode(2);
  root.right = new TreeNode(3);
  const leftNode = root.left;
  leftNode.left = new TreeNode(4);
  leftNode.right = new TreeNode(5);

  const total = root.sum();
  console.log(total);
  if (total === 15) {
    console.log("TEST_PASSED");
  }
}

main();
