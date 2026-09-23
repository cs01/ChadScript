// @category: interpreters
// A Brainfuck interpreter with precomputed bracket jumps, run-length optimization of + - < >,
// input support, and a step counter. Runs a few classic programs.

interface Compiled {
  ops: string[];
  counts: number[];
  jumps: number[];
}

function compile(src: string): Compiled {
  const ops: string[] = [];
  const counts: number[] = [];
  for (const ch of src) {
    if (!"+-<>[].,".includes(ch)) continue;
    const last = ops.length - 1;
    if ("+-<>".includes(ch) && ops[last] === ch) {
      counts[last] = (counts[last] ?? 0) + 1;
    } else {
      ops.push(ch);
      counts.push(1);
    }
  }
  const jumps = new Array<number>(ops.length).fill(-1);
  const stack: number[] = [];
  ops.forEach((op, i) => {
    if (op === "[") stack.push(i);
    if (op === "]") {
      const open = stack.pop();
      if (open === undefined) throw new SyntaxError(`unmatched ] at op ${i}`);
      jumps[open] = i;
      jumps[i] = open;
    }
  });
  if (stack.length > 0) throw new SyntaxError(`unmatched [ at op ${stack[0]}`);
  return { ops, counts, jumps };
}

function execute(prog: Compiled, input = ""): { out: string; steps: number } {
  const tape = new Uint8Array(30000);
  let ptr = 0;
  let inPos = 0;
  let out = "";
  let steps = 0;
  for (let pc = 0; pc < prog.ops.length; pc++) {
    steps++;
    const n = prog.counts[pc]!;
    switch (prog.ops[pc]) {
      case "+":
        tape[ptr] = (tape[ptr]! + n) & 255;
        break;
      case "-":
        tape[ptr] = (tape[ptr]! - n) & 255;
        break;
      case ">":
        ptr += n;
        break;
      case "<":
        ptr -= n;
        break;
      case ".":
        out += String.fromCharCode(tape[ptr]!);
        break;
      case ",":
        tape[ptr] = inPos < input.length ? input.charCodeAt(inPos++) : 0;
        break;
      case "[":
        if (tape[ptr] === 0) pc = prog.jumps[pc]!;
        break;
      case "]":
        if (tape[ptr] !== 0) pc = prog.jumps[pc]!;
        break;
    }
  }
  return { out, steps };
}

const hello =
  "++++++++[>++++[>++>+++>+++>+<<<<-]>+>+>->>+[<]<-]>>.>---.+++++++..+++.>>.<-.<.+++.------.--------.>>+.";
const reverse = ">,[>,]<[.<]";
const add = ",>,[<+>-]<------------------------------------------------.";
const squares =
  "++++[>+++++<-]>[<+++++>-]+<+[>[>+>+<<-]++>>[<<+>>-]>>>[-]++>[-]+>>>+[[-]++++++>>>]<<<[[<++++++++<++>>-]+<.<[>----<-]<]<<[>>>>>[>>>[-]+++++++++<[>-<-]+++++++++>[-[<->-]+[<<<]]<[>+<-]>]<<-]<<-]";

for (const [name, src, input] of [
  ["hello", hello, ""],
  ["reverse", reverse, "stressed"],
  ["add", add, "34"],
  ["squares", squares, ""],
] as const) {
  const { out, steps } = execute(compile(src), input);
  const lines = out.split("\n");
  console.log(
    `${name} (${steps} steps): ${lines.slice(0, 6).join(" | ").trim()}${lines.length > 6 ? " ..." : ""}`,
  );
}
for (const bad of ["[[]", "]"]) {
  try {
    compile(bad);
  } catch (e) {
    console.log(`${(e as Error).name}: ${(e as Error).message}`);
  }
}
