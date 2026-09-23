// @category: interpreters
// A bytecode virtual machine: an assembler with labels, a stack machine with arithmetic,
// comparisons, jumps, locals and calls, and a disassembler. Runs a few assembled programs.

enum Op {
  Push,
  Pop,
  Add,
  Sub,
  Mul,
  Div,
  Mod,
  Lt,
  Eq,
  Jmp,
  Jz,
  Load,
  Store,
  Print,
  Call,
  Ret,
  Dup,
  Halt,
}

interface Instr {
  op: Op;
  arg: number;
}

function assemble(src: string): Instr[] {
  const lines = src
    .split("\n")
    .map((l) => l.split(";")[0]!.trim())
    .filter((l) => l !== "");
  const labels = new Map<string, number>();
  const body: string[] = [];
  for (const line of lines) {
    if (line.endsWith(":")) labels.set(line.slice(0, -1), body.length);
    else body.push(line);
  }
  return body.map((line, i) => {
    const [name, arg] = line.split(/\s+/);
    const op =
      Op[
        ((name ?? "").charAt(0).toUpperCase() +
          (name ?? "").slice(1).toLowerCase()) as keyof typeof Op
      ];
    if (op === undefined) throw new Error(`line ${i}: unknown instruction ${name}`);
    let value = 0;
    if (arg !== undefined) {
      const target = labels.get(arg);
      value = target !== undefined ? target : Number(arg);
      if (Number.isNaN(value)) throw new Error(`line ${i}: bad operand ${arg}`);
    }
    return { op, arg: value };
  });
}

function run(code: Instr[], maxSteps = 100000): { output: number[]; steps: number } {
  const stack: number[] = [];
  const frames: { ret: number; locals: number[] }[] = [{ ret: -1, locals: new Array(8).fill(0) }];
  const output: number[] = [];
  const pop = (): number => {
    const v = stack.pop();
    if (v === undefined) throw new Error("stack underflow");
    return v;
  };
  let pc = 0;
  let steps = 0;
  while (pc < code.length) {
    if (++steps > maxSteps) throw new Error("step limit exceeded");
    const { op, arg } = code[pc++]!;
    const frame = frames[frames.length - 1]!;
    switch (op) {
      case Op.Push:
        stack.push(arg);
        break;
      case Op.Pop:
        pop();
        break;
      case Op.Dup: {
        const v = pop();
        stack.push(v, v);
        break;
      }
      case Op.Add:
      case Op.Sub:
      case Op.Mul:
      case Op.Div:
      case Op.Mod:
      case Op.Lt:
      case Op.Eq: {
        const b = pop();
        const a = pop();
        const r =
          op === Op.Add
            ? a + b
            : op === Op.Sub
              ? a - b
              : op === Op.Mul
                ? a * b
                : op === Op.Div
                  ? Math.trunc(a / b)
                  : op === Op.Mod
                    ? a % b
                    : op === Op.Lt
                      ? Number(a < b)
                      : Number(a === b);
        stack.push(r);
        break;
      }
      case Op.Jmp:
        pc = arg;
        break;
      case Op.Jz:
        if (pop() === 0) pc = arg;
        break;
      case Op.Load:
        stack.push(frame.locals[arg] ?? 0);
        break;
      case Op.Store:
        frame.locals[arg] = pop();
        break;
      case Op.Print:
        output.push(pop());
        break;
      case Op.Call: {
        const locals = new Array<number>(8).fill(0);
        locals[0] = pop();
        frames.push({ ret: pc, locals });
        pc = arg;
        break;
      }
      case Op.Ret: {
        const f = frames.pop()!;
        pc = f.ret;
        break;
      }
      case Op.Halt:
        return { output, steps };
    }
  }
  return { output, steps };
}

const countdown = `
  push 5
  store 0
loop:
  load 0
  jz end
  load 0
  print
  load 0
  push 1
  sub
  store 0
  jmp loop
end:
  halt`;

const factorial = `
  push 10
  call fact
  print
  halt
fact:            ; n in local 0, result left on the stack
  load 0
  push 2
  lt
  jz recurse
  push 1
  ret
recurse:
  load 0
  load 0
  push 1
  sub
  call fact
  mul
  ret`;

const collatz = `
  push 27
  store 0
  push 0
  store 1
top:
  load 0
  push 1
  eq
  jz step
  load 1
  print
  halt
step:
  load 1
  push 1
  add
  store 1
  load 0
  push 2
  mod
  jz even
  load 0
  push 3
  mul
  push 1
  add
  store 0
  jmp top
even:
  load 0
  push 2
  div
  store 0
  jmp top`;

for (const [name, src] of [
  ["countdown", countdown],
  ["factorial", factorial],
  ["collatz", collatz],
  ["broken", "push 1\nadd"],
  ["typo", "psh 1"],
] as const) {
  try {
    const code = assemble(src);
    const { output, steps } = run(code);
    console.log(`${name}: [${output.join(", ")}] in ${steps} steps (${code.length} instrs)`);
  } catch (e) {
    console.log(`${name}: error: ${(e as Error).message}`);
  }
}
console.log(
  assemble(countdown)
    .slice(0, 4)
    .map((i) => `${Op[i.op]} ${i.arg}`)
    .join(" | "),
);
