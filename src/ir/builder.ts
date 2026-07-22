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
  // Allocas are rendered at the top of the entry block regardless of where alloca() is called.
  // LLVM requires stack slots in the entry block for mem2reg to promote them; emitting them
  // inside a conditional block would defeat that (and re-run the alloca on every iteration).
  private readonly allocas: string[] = [];

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

  // --- Basic-block / control-flow management ---
  private labelCounter = 0;

  // Create a new (empty, un-terminated) block and append it after the existing ones. Does NOT
  // switch to it — call switchTo when ready to emit into it.
  newBlock(hint: string): BasicBlock {
    const b = new BasicBlock(`${hint}.${this.labelCounter++}`);
    this.blocks.push(b);
    return b;
  }

  switchTo(b: BasicBlock): void {
    this.current = b;
  }

  get currentBlock(): BasicBlock {
    return this.current;
  }

  // Unconditional branch, terminating the current block.
  br(target: BasicBlock): void {
    this.current.terminate(`br label %${target.label}`);
  }

  // Conditional branch on an i1, terminating the current block.
  brCond(cond: Value, ifTrue: BasicBlock, ifFalse: BasicBlock): void {
    if (cond.type.kind !== "i1") ice(`brCond requires an i1 condition, got ${cond.type.kind}`);
    this.current.terminate(`br i1 ${cond.name}, label %${ifTrue.label}, label %${ifFalse.label}`);
  }

  // Stack slot for a local. Returns a ptr Value; use store/load to access it. Always hoisted
  // to the entry block (see `allocas`).
  alloca(type: IrType): Value {
    const result = this.nextTemp(T.ptr);
    this.allocas.push(`  ${result.name} = alloca ${llvmType(type)}`);
    return result;
  }

  store(value: Value, ptr: Value): void {
    if (ptr.type.kind !== "ptr") ice(`store target must be ptr, got ${ptr.type.kind}`);
    this.current.add(`store ${llvmType(value.type)} ${value.name}, ptr ${ptr.name}`);
  }

  // Pointer to slot `index` of an i64 array/record: getelementptr i64, ptr base, i32 index.
  // Object records and arrays both store one i64 slot per field/element.
  gepSlot(base: Value, index: number): Value {
    if (base.type.kind !== "ptr") ice(`gepSlot base must be ptr, got ${base.type.kind}`);
    const result = this.nextTemp(T.ptr);
    this.current.add(`${result.name} = getelementptr i64, ptr ${base.name}, i32 ${index}`);
    return result;
  }

  load(type: IrType, ptr: Value): Value {
    if (ptr.type.kind !== "ptr") ice(`load source must be ptr, got ${ptr.type.kind}`);
    const result = this.nextTemp(type);
    this.current.add(`${result.name} = load ${llvmType(type)}, ptr ${ptr.name}`);
    return result;
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

  // Indirect call through a function-pointer Value (a closure's fnptr). Same as `call` but the
  // callee is a register holding a ptr rather than a global name.
  callIndirect(fnptr: Value, retType: IrType, args: readonly Value[]): Value {
    if (fnptr.type.kind !== "ptr") ice(`callIndirect needs a ptr callee, got ${fnptr.type.kind}`);
    const result = this.nextTemp(retType);
    this.current.add(`${result.name} = call ${llvmType(retType)} ${fnptr.name}(${argList(args)})`);
    return result;
  }

  callIndirectVoid(fnptr: Value, args: readonly Value[]): void {
    if (fnptr.type.kind !== "ptr") ice(`callIndirect needs a ptr callee, got ${fnptr.type.kind}`);
    this.current.add(`call void ${fnptr.name}(${argList(args)})`);
  }

  // A reference to a defined function as a ptr Value (for a closure's fnptr).
  funcRef(name: string): Value {
    return { name: `@${name}`, type: T.ptr };
  }

  nullPtr(): Value {
    return { name: "null", type: T.ptr };
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

  // Ordered float comparison → i1. Predicate is an LLVM fcmp code (oeq/one/olt/ogt/ole/oge).
  // Ordered predicates yield false when either operand is NaN, which matches JS number
  // comparison exactly (NaN===NaN is false; any relational with NaN is false).
  fcmp(pred: string, a: Value, b: Value): Value {
    if (a.type.kind !== "double" || b.type.kind !== "double") {
      ice(`fcmp requires double operands, got ${a.type.kind}/${b.type.kind}`);
    }
    const result = this.nextTemp(T.i1);
    this.current.add(`${result.name} = fcmp ${pred} double ${a.name}, ${b.name}`);
    return result;
  }

  // Integer comparison → i1 (pred = eq/ne/slt/…). Operand types must match.
  icmp(pred: string, a: Value, b: Value): Value {
    if (a.type.kind !== b.type.kind) {
      ice(`icmp requires matching operand types, got ${a.type.kind}/${b.type.kind}`);
    }
    const result = this.nextTemp(T.i1);
    this.current.add(`${result.name} = icmp ${pred} ${llvmType(a.type)} ${a.name}, ${b.name}`);
    return result;
  }

  // i32 bitwise/shift op (and/or/xor/shl/ashr/lshr). Operands must be i32; result is i32.
  private ibin(op: string, a: Value, b: Value): Value {
    if (a.type.kind !== "i32" || b.type.kind !== "i32") {
      ice(`${op} requires i32 operands, got ${a.type.kind}/${b.type.kind}`);
    }
    const result = this.nextTemp(T.i32);
    this.current.add(`${result.name} = ${op} i32 ${a.name}, ${b.name}`);
    return result;
  }

  iadd(a: Value, b: Value): Value {
    return this.ibin("add", a, b);
  }
  isub(a: Value, b: Value): Value {
    return this.ibin("sub", a, b);
  }
  iand(a: Value, b: Value): Value {
    return this.ibin("and", a, b);
  }
  ior(a: Value, b: Value): Value {
    return this.ibin("or", a, b);
  }
  ixor(a: Value, b: Value): Value {
    return this.ibin("xor", a, b);
  }
  shl(a: Value, b: Value): Value {
    return this.ibin("shl", a, b);
  }
  ashr(a: Value, b: Value): Value {
    return this.ibin("ashr", a, b);
  }
  lshr(a: Value, b: Value): Value {
    return this.ibin("lshr", a, b);
  }

  // i32 → double. sitofp treats the source as signed; uitofp as unsigned (for `>>>`).
  sitofp(a: Value): Value {
    if (a.type.kind !== "i32") ice(`sitofp requires an i32 operand, got ${a.type.kind}`);
    const result = this.nextTemp(T.double);
    this.current.add(`${result.name} = sitofp i32 ${a.name} to double`);
    return result;
  }
  uitofp(a: Value): Value {
    if (a.type.kind !== "i32") ice(`uitofp requires an i32 operand, got ${a.type.kind}`);
    const result = this.nextTemp(T.double);
    this.current.add(`${result.name} = uitofp i32 ${a.name} to double`);
    return result;
  }

  // Reinterpret bits between double and i64 — for boxing a number into a uniform array slot.
  bitcastDoubleToI64(a: Value): Value {
    if (a.type.kind !== "double") ice(`bitcast d→i64 needs double, got ${a.type.kind}`);
    const result = this.nextTemp(T.i64);
    this.current.add(`${result.name} = bitcast double ${a.name} to i64`);
    return result;
  }
  bitcastI64ToDouble(a: Value): Value {
    if (a.type.kind !== "i64") ice(`bitcast i64→d needs i64, got ${a.type.kind}`);
    const result = this.nextTemp(T.double);
    this.current.add(`${result.name} = bitcast i64 ${a.name} to double`);
    return result;
  }

  // ptr ↔ i64 and i1 ↔ i64 — for boxing string/boolean elements into uniform array slots.
  ptrToI64(a: Value): Value {
    if (a.type.kind !== "ptr") ice(`ptrtoint needs ptr, got ${a.type.kind}`);
    const result = this.nextTemp(T.i64);
    this.current.add(`${result.name} = ptrtoint ptr ${a.name} to i64`);
    return result;
  }
  i64ToPtr(a: Value): Value {
    if (a.type.kind !== "i64") ice(`inttoptr needs i64, got ${a.type.kind}`);
    const result = this.nextTemp(T.ptr);
    this.current.add(`${result.name} = inttoptr i64 ${a.name} to ptr`);
    return result;
  }
  zextI1ToI64(a: Value): Value {
    if (a.type.kind !== "i1") ice(`zext i1→i64 needs i1, got ${a.type.kind}`);
    const result = this.nextTemp(T.i64);
    this.current.add(`${result.name} = zext i1 ${a.name} to i64`);
    return result;
  }
  truncI64ToI1(a: Value): Value {
    if (a.type.kind !== "i64") ice(`trunc i64→i1 needs i64, got ${a.type.kind}`);
    const result = this.nextTemp(T.i1);
    this.current.add(`${result.name} = trunc i64 ${a.name} to i1`);
    return result;
  }

  // select i1 cond, a, b — a and b must share a type.
  select(cond: Value, a: Value, b: Value): Value {
    if (cond.type.kind !== "i1") ice(`select cond must be i1, got ${cond.type.kind}`);
    if (a.type.kind !== b.type.kind) ice(`select arms differ: ${a.type.kind}/${b.type.kind}`);
    const result = this.nextTemp(a.type);
    const ty = llvmType(a.type);
    this.current.add(`${result.name} = select i1 ${cond.name}, ${ty} ${a.name}, ${ty} ${b.name}`);
    return result;
  }

  // Logical not on an i1: xor with true.
  logicalNot(a: Value): Value {
    if (a.type.kind !== "i1") ice(`logicalNot requires an i1 operand, got ${a.type.kind}`);
    const result = this.nextTemp(T.i1);
    this.current.add(`${result.name} = xor i1 ${a.name}, true`);
    return result;
  }

  // Non-short-circuiting i1 OR (both operands already evaluated, e.g. two sentinel checks).
  logicalOr(a: Value, b: Value): Value {
    if (a.type.kind !== "i1" || b.type.kind !== "i1")
      ice(`logicalOr requires i1 operands, got ${a.type.kind}/${b.type.kind}`);
    const result = this.nextTemp(T.i1);
    this.current.add(`${result.name} = or i1 ${a.name}, ${b.name}`);
    return result;
  }

  // i1 → i32 zero-extension (e.g. to pass a boolean across the runtime's int ABI).
  zextI1ToI32(a: Value): Value {
    if (a.type.kind !== "i1") ice(`zextI1ToI32 requires an i1 operand, got ${a.type.kind}`);
    const result = this.nextTemp(T.i32);
    this.current.add(`${result.name} = zext i1 ${a.name} to i32`);
    return result;
  }

  ret(value: Value): void {
    if (value.type.kind === "void") ice(`ret with void value in ${this.name}; use retVoid`);
    this.current.terminate(`ret ${llvmType(value.type)} ${value.name}`);
  }

  retVoid(): void {
    this.current.terminate("ret void");
  }

  // Marks a block as never reached (e.g. the merge block after a non-void function whose every
  // path returns). tsc's exhaustiveness guarantees make these genuinely dead.
  unreachable(): void {
    this.current.terminate("unreachable");
  }

  finish(): string {
    for (const b of this.blocks) {
      if (!b.isTerminated) ice(`function ${this.name} block ${b.label} has no terminator`);
    }
    const sig = this.params.map((p) => `${llvmType(p.type)} ${p.name}`).join(", ");
    const body = this.blocks
      .map((b, i) => {
        // Entry block leads with the hoisted allocas, then its own instructions.
        const header = i === 0 ? this.allocas.join("\n") : `${b.label}:`;
        const lines = [header, b.instructions.join("\n")].filter((s) => s.length > 0);
        return lines.join("\n");
      })
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

  // Reference an external global by name (an `external global i8`), returning a ptr to it. Used
  // for the `undefined` sentinel: its unique address distinguishes it from any heap box.
  externGlobal(name: string): Value {
    this.externs.set(`global ${name}`, `@${name} = external global i8`);
    return { name: `@${name}`, type: T.ptr };
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
