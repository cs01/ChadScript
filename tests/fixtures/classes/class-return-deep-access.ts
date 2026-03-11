// @test-description: class with self-referential fields returned from function

class TreeNode {
  value: string;
  left: TreeNode;
  right: TreeNode;
  constructor(v: string) {
    this.value = v;
  }
  setLeft(n: TreeNode): void {
    this.left = n;
  }
  setRight(n: TreeNode): void {
    this.right = n;
  }
}

function buildTree(): TreeNode {
  const root = new TreeNode("root");
  const l = new TreeNode("left");
  const r = new TreeNode("right");
  const ll = new TreeNode("left-left");
  const lr = new TreeNode("left-right");
  root.setLeft(l);
  root.setRight(r);
  l.setLeft(ll);
  l.setRight(lr);
  return root;
}

const tree = buildTree();
if (tree.value !== "root") {
  console.log("FAIL: root");
  process.exit(1);
}
if (tree.left.value !== "left") {
  console.log("FAIL: left");
  process.exit(1);
}
if (tree.right.value !== "right") {
  console.log("FAIL: right");
  process.exit(1);
}
if (tree.left.left.value !== "left-left") {
  console.log("FAIL: left-left");
  process.exit(1);
}
if (tree.left.right.value !== "left-right") {
  console.log("FAIL: left-right");
  process.exit(1);
}
console.log("TEST_PASSED");
