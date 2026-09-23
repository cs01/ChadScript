// @category: generics
// Generic Stack<T> and Queue<T> classes used for bracket matching, infix-to-postfix conversion
// (shunting-yard), postfix evaluation, and a BFS over a small tree.

class Stack<T> {
  private items: T[] = [];
  push(x: T): void {
    this.items.push(x);
  }
  pop(): T | undefined {
    return this.items.pop();
  }
  peek(): T | undefined {
    return this.items[this.items.length - 1];
  }
  isEmpty(): boolean {
    return this.items.length === 0;
  }
  get size(): number {
    return this.items.length;
  }
}

class Queue<T> {
  private items: T[] = [];
  private head = 0;
  enqueue(x: T): void {
    this.items.push(x);
  }
  dequeue(): T | undefined {
    if (this.head >= this.items.length) return undefined;
    const x = this.items[this.head];
    this.head++;
    return x;
  }
  get size(): number {
    return this.items.length - this.head;
  }
}

function balanced(s: string): boolean {
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const stack = new Stack<string>();
  for (const ch of s) {
    if (ch === "(" || ch === "[" || ch === "{") stack.push(ch);
    else if (ch in pairs) {
      if (stack.pop() !== pairs[ch]) return false;
    }
  }
  return stack.isEmpty();
}

const PREC: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };

function toPostfix(expr: string): string[] {
  const out: string[] = [];
  const ops = new Stack<string>();
  for (const tok of expr.match(/\d+|[-+*/()]/g) ?? []) {
    if (/\d/.test(tok)) out.push(tok);
    else if (tok === "(") ops.push(tok);
    else if (tok === ")") {
      while (ops.peek() !== "(") out.push(ops.pop()!);
      ops.pop();
    } else {
      while (
        ops.peek() !== undefined &&
        ops.peek() !== "(" &&
        (PREC[ops.peek()!] ?? 0) >= (PREC[tok] ?? 0)
      )
        out.push(ops.pop()!);
      ops.push(tok);
    }
  }
  while (!ops.isEmpty()) out.push(ops.pop()!);
  return out;
}

function evalPostfix(tokens: string[]): number {
  const st = new Stack<number>();
  for (const t of tokens) {
    if (/\d/.test(t)) {
      st.push(Number(t));
      continue;
    }
    const b = st.pop()!;
    const a = st.pop()!;
    st.push(t === "+" ? a + b : t === "-" ? a - b : t === "*" ? a * b : a / b);
  }
  return st.pop()!;
}

interface TreeNode<T> {
  value: T;
  children: TreeNode<T>[];
}

function levels<T>(root: TreeNode<T>): T[][] {
  const out: T[][] = [];
  const q = new Queue<{ node: TreeNode<T>; depth: number }>();
  q.enqueue({ node: root, depth: 0 });
  while (q.size > 0) {
    const { node, depth } = q.dequeue()!;
    (out[depth] ??= []).push(node.value);
    for (const c of node.children) q.enqueue({ node: c, depth: depth + 1 });
  }
  return out;
}

for (const s of ["([]{()})", "([)]", "((", "", "{[()()]}"])
  console.log(JSON.stringify(s), balanced(s));
for (const e of ["3 + 4 * 2", "(1 + 2) * (3 + 4)", "100 / (4 - 2) / 5", "2 * (3 + 4) - 5 * 6"]) {
  const pf = toPostfix(e);
  console.log(`${e} => ${pf.join(" ")} => ${evalPostfix(pf)}`);
}
const tree: TreeNode<string> = {
  value: "root",
  children: [
    {
      value: "a",
      children: [
        { value: "a1", children: [] },
        { value: "a2", children: [] },
      ],
    },
    { value: "b", children: [{ value: "b1", children: [{ value: "b1x", children: [] }] }] },
  ],
};
console.log(
  levels(tree)
    .map((l) => l.join(","))
    .join(" | "),
);
