// @category: cli
// @args: 3 4 + 2 * 7 / 10 swap - dup * 2 sqrt 1 0 /
// An RPN calculator driven by command-line tokens: arithmetic, stack words (dup, swap, drop),
// and functions. Prints the stack after each token and an error for a stack underflow.

type Op = (stack: number[]) => void;

class StackUnderflow extends Error {
  constructor(word: string, need: number) {
    super(`'${word}' needs ${need} value(s) on the stack`);
  }
}

function pop(stack: number[], word: string, need: number): number[] {
  if (stack.length < need) throw new StackUnderflow(word, need);
  return stack.splice(stack.length - need, need);
}

const binary = (word: string, f: (a: number, b: number) => number): Op => {
  return (stack) => {
    const [a, b] = pop(stack, word, 2);
    stack.push(f(a!, b!));
  };
};

const ops: Record<string, Op> = {
  "+": binary("+", (a, b) => a + b),
  "-": binary("-", (a, b) => a - b),
  "*": binary("*", (a, b) => a * b),
  "/": binary("/", (a, b) => a / b),
  "%": binary("%", (a, b) => a % b),
  pow: binary("pow", (a, b) => a ** b),
  sqrt: (s) => s.push(Math.sqrt(pop(s, "sqrt", 1)[0]!)),
  neg: (s) => s.push(-pop(s, "neg", 1)[0]!),
  dup: (s) => {
    const [a] = pop(s, "dup", 1);
    s.push(a!, a!);
  },
  swap: (s) => {
    const [a, b] = pop(s, "swap", 2);
    s.push(b!, a!);
  },
  drop: (s) => {
    pop(s, "drop", 1);
  },
};

function format(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(4);
}

const stack: number[] = [];
const tokens = process.argv.slice(2);
if (tokens.length === 0) {
  console.log("usage: rpn <tokens...>");
  process.exit(1);
}
for (const tok of tokens) {
  const op = ops[tok];
  try {
    if (op) op(stack);
    else if (!Number.isNaN(Number(tok))) stack.push(Number(tok));
    else throw new Error(`unknown word '${tok}'`);
  } catch (e) {
    console.log(`error: ${(e as Error).message}`);
    continue;
  }
  console.log(`${tok.padStart(5)} | ${stack.map(format).join(" ")}`);
}
console.log(`result: ${stack.length > 0 ? format(stack[stack.length - 1]!) : "(empty)"}`);
