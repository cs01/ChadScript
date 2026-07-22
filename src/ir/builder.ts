// The typed IR builder — the ONLY place LLVM IR text is produced. Guardrails that killed a
// whole bug class in v1:
//   - Values are {name, type} records; you cannot pass an untyped string as a value.
//   - A BasicBlock tracks its own termination; adding an instruction after the terminator,
//     or finishing a function with an unterminated block, is an ICE (loud), not bad IR.
// Raw `.emit(text)` is intentionally absent — every instruction has a typed method. New
// instructions get new methods here; nothing outside this file writes IR.

import { ice } from "../diagnostics.js";
import { type IrType, T, llvmType } from "./types.js";

export interface Value {
  readonly name: string; // "%1", "@g0", "0" (immediate), ...
  readonly type: IrType;
}

export class BasicBlock {
  readonly instructions: string[] = [];
  private terminated = false;

  constructor(readonly label: string) {}

  add(line: string): void {
    if (this.terminated) ice(`instruction added to terminated block ${this.label}: ${line}`);
    this.instructions.push("  " + line);
  }

  terminate(line: string): void {
    if (this.terminated) ice(`block ${this.label} terminated twice`);
    this.instructions.push("  " + line);
    this.terminated = true;
  }

  get isTerminated(): boolean {
    return this.terminated;
  }
}

export class FuncBuilder {
  readonly blocks: BasicBlock[] = [];
  private tempCounter = 0;
  private current: BasicBlock;

  constructor(
    readonly name: string,
    readonly returnType: IrType,
    readonly params: readonly Value[],
  ) {
    this.current = new BasicBlock("entry");
    this.blocks.push(this.current);
  }

  private nextTemp(type: IrType): Value {
    return { name: `%t${this.tempCounter++}`, type };
  }

  // call to a value-returning function; returns the typed result Value.
  call(callee: string, retType: IrType, args: readonly Value[]): Value {
    const result = this.nextTemp(retType);
    this.current.add(`${result.name} = call ${llvmType(retType)} ${callee}(${argList(args)})`);
    return result;
  }

  callVoid(callee: string, args: readonly Value[]): void {
    this.current.add(`call void ${callee}(${argList(args)})`);
  }

  // Binary float op (fadd/fsub/fmul/fdiv/frem). Operands must be double; result is double.
  private fbin(op: string, a: Value, b: Value): Value {
    if (a.type.kind !== "double" || b.type.kind !== "double") {
      ice(`${op} requires double operands, got ${a.type.kind}/${b.type.kind}`);
    }
    const result = this.nextTemp(T.double);
    this.current.add(`${result.name} = ${op} double ${a.name}, ${b.name}`);
    return result;
  }

  fadd(a: Value, b: Value): Value {
    return this.fbin("fadd", a, b);
  }
  fsub(a: Value, b: Value): Value {
    return this.fbin("fsub", a, b);
  }
  fmul(a: Value, b: Value): Value {
    return this.fbin("fmul", a, b);
  }
  fdiv(a: Value, b: Value): Value {
    return this.fbin("fdiv", a, b);
  }
  frem(a: Value, b: Value): Value {
    return this.fbin("frem", a, b);
  }

  fneg(a: Value): Value {
    if (a.type.kind !== "double") ice(`fneg requires a double operand, got ${a.type.kind}`);
    const result = this.nextTemp(T.double);
    this.current.add(`${result.name} = fneg double ${a.name}`);
    return result;
  }

  // double → i32 (truncating toward zero). Used e.g. for process.exit codes.
  fptosi_i32(a: Value): Value {
    if (a.type.kind !== "double") ice(`fptosi requires a double operand, got ${a.type.kind}`);
    const result = this.nextTemp(T.i32);
    this.current.add(`${result.name} = fptosi double ${a.name} to i32`);
    return result;
  }

  ret(value: Value): void {
    if (value.type.kind === "void") ice(`ret with void value in ${this.name}; use retVoid`);
    this.current.terminate(`ret ${llvmType(value.type)} ${value.name}`);
  }

  retVoid(): void {
    this.current.terminate("ret void");
  }

  finish(): string {
    for (const b of this.blocks) {
      if (!b.isTerminated) ice(`function ${this.name} block ${b.label} has no terminator`);
    }
    const sig = this.params.map((p) => `${llvmType(p.type)} ${p.name}`).join(", ");
    const body = this.blocks
      .map((b, i) => (i === 0 ? "" : `${b.label}:\n`) + b.instructions.join("\n"))
      .join("\n");
    return `define ${llvmType(this.returnType)} @${this.name}(${sig}) {\n${body}\n}`;
  }
}

function argList(args: readonly Value[]): string {
  return args.map((a) => `${llvmType(a.type)} ${a.name}`).join(", ");
}

export function imm(type: IrType, literal: string | number): Value {
  return { name: String(literal), type };
}

// A double immediate. LLVM double literals must be exactly representable in the text form, so
// we emit the raw IEEE-754 bits as `0x<16 hex>` — lossless for every f64, unlike decimal.
export function fimm(value: number): Value {
  const buf = Buffer.alloc(8);
  buf.writeDoubleBE(value);
  return { name: "0x" + buf.toString("hex").toUpperCase(), type: T.double };
}

export class ModuleBuilder {
  private readonly globals: string[] = [];
  private readonly externs = new Map<string, string>();
  private readonly funcs: FuncBuilder[] = [];
  private stringCounter = 0;

  // Interns a C string constant (NUL-terminated for the runtime's cstring ABI) and returns a
  // ptr Value to its first byte. Phase 0 only; real JS strings become {ptr,len} later.
  cstring(text: string): Value {
    const bytes = Buffer.from(text, "utf8");
    const name = `@.str${this.stringCounter++}`;
    const encoded = [...bytes].map((b) => `\\${b.toString(16).padStart(2, "0")}`).join("");
    const len = bytes.length + 1;
    this.globals.push(`${name} = private unnamed_addr constant [${len} x i8] c"${encoded}\\00"`);
    return { name, type: T.ptr };
  }

  declareExtern(name: string, retType: IrType, paramTypes: readonly IrType[]): void {
    if (this.externs.has(name)) return;
    const params = paramTypes.map(llvmType).join(", ");
    this.externs.set(name, `declare ${llvmType(retType)} @${name}(${params})`);
  }

  defineFunc(name: string, returnType: IrType, params: readonly Value[]): FuncBuilder {
    const fb = new FuncBuilder(name, returnType, params);
    this.funcs.push(fb);
    return fb;
  }

  render(): string {
    const parts: string[] = [];
    if (this.globals.length) parts.push(this.globals.join("\n"));
    if (this.externs.size) parts.push([...this.externs.values()].join("\n"));
    parts.push(this.funcs.map((f) => f.finish()).join("\n\n"));
    return parts.join("\n\n") + "\n";
  }
}
