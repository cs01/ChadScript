const MIN_DEPTH = 4;
const MAX_DEPTH = 18;

interface TreeNode {
  left: TreeNode;
  right: TreeNode;
}

function makeTree(depth: number): TreeNode {
  if (depth === 0) {
    return { left: null, right: null };
  }
  return { left: makeTree(depth - 1), right: makeTree(depth - 1) };
}

function checkTree(node: TreeNode): number {
  if (node.left == null) {
    return 1;
  }
  return 1 + checkTree(node.left) + checkTree(node.right);
}

function run(): void {
  const start = Date.now();

  const stretchDepth = MAX_DEPTH + 1;
  const stretchTree = makeTree(stretchDepth);
  console.log("stretch: " + checkTree(stretchTree));

  const longLived = makeTree(MAX_DEPTH);

  let depth = MIN_DEPTH;
  while (depth <= MAX_DEPTH) {
    const iterations = 1 << (MAX_DEPTH - depth + MIN_DEPTH);
    let check = 0;
    let i = 0;
    while (i < iterations) {
      check = check + checkTree(makeTree(depth));
      i = i + 1;
    }
    console.log("depth " + depth + " check: " + check);
    depth = depth + 2;
  }

  console.log("long lived: " + checkTree(longLived));

  const elapsed = (Date.now() - start) / 1000;
  console.log("Time:     " + elapsed + "s");
}

run();
