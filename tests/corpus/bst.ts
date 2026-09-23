// @category: data-structures
// An unbalanced binary search tree keyed by number: insert, search, delete (all three cases),
// traversals, height, range queries, and validation.

interface TreeNode {
  key: number;
  label: string;
  left: TreeNode | null;
  right: TreeNode | null;
}

class BST {
  root: TreeNode | null = null;
  size = 0;

  insert(key: number, label: string): void {
    const node: TreeNode = { key, label, left: null, right: null };
    if (this.root === null) {
      this.root = node;
      this.size++;
      return;
    }
    let cur = this.root;
    while (true) {
      if (key === cur.key) {
        cur.label = label;
        return;
      }
      if (key < cur.key) {
        if (cur.left === null) {
          cur.left = node;
          break;
        }
        cur = cur.left;
      } else {
        if (cur.right === null) {
          cur.right = node;
          break;
        }
        cur = cur.right;
      }
    }
    this.size++;
  }

  find(key: number): string | undefined {
    let cur = this.root;
    while (cur !== null) {
      if (key === cur.key) return cur.label;
      cur = key < cur.key ? cur.left : cur.right;
    }
    return undefined;
  }

  delete(key: number): boolean {
    const before = this.size;
    this.root = this.deleteFrom(this.root, key);
    return this.size < before;
  }

  private deleteFrom(node: TreeNode | null, key: number): TreeNode | null {
    if (node === null) return null;
    if (key < node.key) {
      node.left = this.deleteFrom(node.left, key);
      return node;
    }
    if (key > node.key) {
      node.right = this.deleteFrom(node.right, key);
      return node;
    }
    if (node.left === null) {
      this.size--;
      return node.right;
    }
    if (node.right === null) {
      this.size--;
      return node.left;
    }
    let succ = node.right;
    while (succ.left !== null) succ = succ.left;
    node.key = succ.key;
    node.label = succ.label;
    node.right = this.deleteFrom(node.right, succ.key);
    return node;
  }

  inOrder(): number[] {
    const out: number[] = [];
    const walk = (n: TreeNode | null): void => {
      if (n === null) return;
      walk(n.left);
      out.push(n.key);
      walk(n.right);
    };
    walk(this.root);
    return out;
  }

  preOrder(): number[] {
    const out: number[] = [];
    const stack: TreeNode[] = this.root ? [this.root] : [];
    while (stack.length > 0) {
      const n = stack.pop() as TreeNode;
      out.push(n.key);
      if (n.right) stack.push(n.right);
      if (n.left) stack.push(n.left);
    }
    return out;
  }

  height(n: TreeNode | null = this.root): number {
    return n === null ? 0 : 1 + Math.max(this.height(n.left), this.height(n.right));
  }

  range(lo: number, hi: number): string[] {
    const out: string[] = [];
    const walk = (n: TreeNode | null): void => {
      if (n === null) return;
      if (n.key > lo) walk(n.left);
      if (n.key >= lo && n.key <= hi) out.push(`${n.key}:${n.label}`);
      if (n.key < hi) walk(n.right);
    };
    walk(this.root);
    return out;
  }

  isValid(): boolean {
    const keys = this.inOrder();
    return keys.every((k, i) => i === 0 || keys[i - 1]! < k);
  }
}

const tree = new BST();
const keys = [50, 30, 70, 20, 40, 60, 80, 35, 45, 65];
for (const k of keys) tree.insert(k, `n${k}`);
tree.insert(40, "forty");
console.log("size", tree.size, "height", tree.height(), "valid", tree.isValid());
console.log("in-order", tree.inOrder().join(","));
console.log("pre-order", tree.preOrder().join(","));
console.log("find", tree.find(40), tree.find(65), tree.find(99));
console.log("range 33..66", tree.range(33, 66).join(" "));
console.log("delete leaf 20", tree.delete(20), tree.inOrder().join(","));
console.log("delete one-child 60", tree.delete(60), tree.inOrder().join(","));
console.log("delete two-children 30", tree.delete(30), tree.inOrder().join(","));
console.log("delete root 50", tree.delete(50), tree.preOrder().join(","));
console.log("delete missing 1", tree.delete(1), "size", tree.size, "valid", tree.isValid());
