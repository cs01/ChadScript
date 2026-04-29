import type { HIRType, HIRFunction, HIRStmt } from "../hir/types.js";
import { LLVMModule } from "./llvm.js";

export class EmitContext {
  readonly m: LLVMModule;
  private localAllocs = new Map<number, any>();
  private localNames = new Map<number, string>();
  private globalValues = new Map<string, { alloc: any; type: HIRType }>();
  private loopStack: { condBlock: any; exitBlock: any }[] = [];
  private declaredFunctions = new Map<string, { fn: any; fnType: any }>();
  private mathIntrinsics = new Map<string, { fn: any; fnType: any }>();
  private structTypes = new Map<
    string,
    { llvmType: any; fields: { name: string; type: HIRType }[] }
  >();
  private interfaceTypes = new Map<
    string,
    { fatType: any; iface: import("../hir/types.js").HIRInterface; layoutType: any }
  >();
  private vtables = new Map<string, any>();
  private closureType: any = null;
  private capturedLocals = new Map<number, { envAlloc: any; index: number; type: HIRType }>();
  private envAlloc: any = null;
  private asyncPromiseAlloc: any = null;
  private currentFn: any = null;
  currentReturnType: HIRType = { kind: "void" };
  diScope: any = null;

  constructor(m: LLVMModule) {
    this.m = m;
  }

  registerLocal(id: number, name: string, alloc: any): void {
    this.localAllocs.set(id, alloc);
    this.localNames.set(id, name);
  }

  getLocalAlloc(id: number): any {
    return this.localAllocs.get(id);
  }

  resetLocals(): void {
    this.localAllocs.clear();
    this.localNames.clear();
  }

  pushLoop(condBlock: any, exitBlock: any): void {
    this.loopStack.push({ condBlock, exitBlock });
  }

  popLoop(): void {
    this.loopStack.pop();
  }

  currentLoop(): { condBlock: any; exitBlock: any } {
    return this.loopStack[this.loopStack.length - 1];
  }

  setCurrentFn(fn: any): void {
    this.currentFn = fn;
  }

  getCurrentFn(): any {
    return this.currentFn;
  }

  registerGlobal(name: string, alloc: any, type: HIRType): void {
    this.globalValues.set(name, { alloc, type });
  }

  getGlobal(name: string): { alloc: any; type: HIRType } | undefined {
    return this.globalValues.get(name);
  }

  declareFunction(name: string, fn: any, fnType: any): void {
    this.declaredFunctions.set(name, { fn, fnType });
  }

  getDeclaredFunction(name: string): { fn: any; fnType: any } | undefined {
    return this.declaredFunctions.get(name);
  }

  declareMathIntrinsic(name: string, fn: any, fnType: any): void {
    this.mathIntrinsics.set(name, { fn, fnType });
  }

  getMathIntrinsic(name: string): { fn: any; fnType: any } | undefined {
    return this.mathIntrinsics.get(name);
  }

  registerStructType(name: string, llvmType: any, fields: { name: string; type: HIRType }[]): void {
    this.structTypes.set(name, { llvmType, fields });
  }

  getStructType(
    name: string,
  ): { llvmType: any; fields: { name: string; type: HIRType }[] } | undefined {
    return this.structTypes.get(name);
  }

  registerInterfaceType(
    name: string,
    fatType: any,
    iface: import("../hir/types.js").HIRInterface,
    layoutType: any,
  ): void {
    this.interfaceTypes.set(name, { fatType, iface, layoutType });
  }

  getInterfaceType(name: string):
    | {
        fatType: any;
        iface: import("../hir/types.js").HIRInterface;
        layoutType: any;
      }
    | undefined {
    return this.interfaceTypes.get(name);
  }

  registerVtable(key: string, vtableGlobal: any): void {
    this.vtables.set(key, vtableGlobal);
  }

  getVtable(key: string): any {
    return this.vtables.get(key);
  }

  getClosureType(): any {
    if (!this.closureType) {
      this.closureType = this.m.structCreateNamed("Closure");
      this.m.structSetBody(this.closureType, [this.m.ptr, this.m.ptr]);
    }
    return this.closureType;
  }

  setCapturedLocal(id: number, envAlloc: any, index: number, type: HIRType): void {
    this.capturedLocals.set(id, { envAlloc, index, type });
  }

  getCapturedLocal(id: number): { envAlloc: any; index: number; type: HIRType } | undefined {
    return this.capturedLocals.get(id);
  }

  setEnvAlloc(alloc: any): void {
    this.envAlloc = alloc;
  }

  getEnvAlloc(): any {
    return this.envAlloc;
  }

  setAsyncPromiseAlloc(alloc: any): void {
    this.asyncPromiseAlloc = alloc;
  }

  getAsyncPromiseAlloc(): any {
    return this.asyncPromiseAlloc;
  }

  resetLocalsAndCaptures(): void {
    this.localAllocs.clear();
    this.localNames.clear();
    this.capturedLocals.clear();
    this.envAlloc = null;
    this.asyncPromiseAlloc = null;
  }
}

export type CaptureMap = Map<
  string,
  { capturedIds: Set<number>; envTypes: { id: number; type: HIRType }[] }
>;

export function llvmType(ctx: EmitContext, t: HIRType): any {
  const m = ctx.m;
  switch (t.kind) {
    case "f64":
      return m.f64;
    case "i64":
      return m.i64;
    case "i1":
      return m.i1;
    case "i8ptr":
      return m.ptr;
    case "void":
      return m.voidTy;
    case "boxed":
      return m.i64;
    case "ptr":
      return m.ptr;
    case "array":
    case "struct":
      return m.ptr;
    case "closure":
      return m.ptr;
    case "promise":
      return m.ptr;
    case "map":
    case "set":
    case "regex":
    case "dynobj":
    case "dynarray":
      return m.ptr;
    default: {
      const _: never = t;
      throw new Error(`unknown HIR type: ${JSON.stringify(t)}`);
    }
  }
}

export function coerceLLVM(ctx: EmitContext, val: any, from: HIRType, to: HIRType): any {
  const m = ctx.m;
  if (from.kind === to.kind) return val;
  if (from.kind === "promise" && to.kind === "promise") return val;
  if (from.kind === "i64" && to.kind === "f64") return m.buildSIToFP(val, m.f64, "");
  if (from.kind === "f64" && to.kind === "i64") return m.buildFPToSI(val, m.i64, "");
  if (from.kind === "i1" && to.kind === "i64") return m.buildZExt(val, m.i64, "");
  if (from.kind === "i1" && to.kind === "f64") {
    const ext = m.buildZExt(val, m.i64, "");
    return m.buildSIToFP(ext, m.f64, "");
  }
  if (to.kind === "boxed") {
    return emitBoxValue(ctx, val, from);
  }
  if (from.kind === "boxed") {
    return emitUnboxValue(ctx, val, to);
  }
  if (to.kind === "f64") return m.constReal(m.f64, 0.0);
  if (to.kind === "i64") return m.constInt(m.i64, 0);
  if (to.kind === "i1") return m.constInt(m.i1, 0);
  return val;
}

export function emitBoxValue(ctx: EmitContext, val: any, from: HIRType): any {
  const m = ctx.m;
  switch (from.kind) {
    case "f64": {
      const fn = ctx.getDeclaredFunction("nanbox_from_f64")!;
      return m.buildCall(fn.fnType, fn.fn, [val], "boxed");
    }
    case "i64": {
      const fn = ctx.getDeclaredFunction("nanbox_from_i64")!;
      return m.buildCall(fn.fnType, fn.fn, [val], "boxed");
    }
    case "i1": {
      const ext = m.buildZExt(val, m.i32, "");
      const fn = ctx.getDeclaredFunction("nanbox_from_bool")!;
      return m.buildCall(fn.fnType, fn.fn, [ext], "boxed");
    }
    case "i8ptr": {
      const fn = ctx.getDeclaredFunction("nanbox_from_string")!;
      return m.buildCall(fn.fnType, fn.fn, [val], "boxed");
    }
    case "ptr": {
      const fn = ctx.getDeclaredFunction("nanbox_from_ptr")!;
      return m.buildCall(fn.fnType, fn.fn, [val], "boxed");
    }
    case "dynobj":
    case "dynarray":
    case "map":
    case "set":
    case "array":
    case "struct":
    case "closure":
    case "promise":
    case "regex": {
      const fn = ctx.getDeclaredFunction("nanbox_from_ptr")!;
      return m.buildCall(fn.fnType, fn.fn, [val], "boxed");
    }
    case "boxed":
      return val;
    default:
      return val;
  }
}

export function emitUnboxValue(ctx: EmitContext, val: any, to: HIRType): any {
  const m = ctx.m;
  switch (to.kind) {
    case "f64": {
      const fn = ctx.getDeclaredFunction("nanbox_to_f64")!;
      return m.buildCall(fn.fnType, fn.fn, [val], "unboxed");
    }
    case "i64": {
      const fn = ctx.getDeclaredFunction("nanbox_to_i64")!;
      return m.buildCall(fn.fnType, fn.fn, [val], "unboxed");
    }
    case "i1": {
      const fn = ctx.getDeclaredFunction("nanbox_to_bool")!;
      const i32val = m.buildCall(fn.fnType, fn.fn, [val], "unboxed");
      return m.buildTrunc(i32val, m.i1, "");
    }
    case "i8ptr": {
      const fn = ctx.getDeclaredFunction("nanbox_to_string")!;
      return m.buildCall(fn.fnType, fn.fn, [val], "unboxed");
    }
    case "ptr": {
      const fn = ctx.getDeclaredFunction("nanbox_to_ptr")!;
      return m.buildCall(fn.fnType, fn.fn, [val], "unboxed");
    }
    case "dynobj":
    case "dynarray":
    case "map":
    case "set":
    case "array":
    case "struct":
    case "closure":
    case "promise":
    case "regex": {
      const fn = ctx.getDeclaredFunction("nanbox_to_ptr")!;
      return m.buildCall(fn.fnType, fn.fn, [val], "unboxed");
    }
    case "boxed":
      return val;
    default:
      return val;
  }
}

export function defaultInit(ctx: EmitContext, t: HIRType): any {
  const m = ctx.m;
  switch (t.kind) {
    case "f64":
      return m.constReal(m.f64, 0.0);
    case "i64":
      return m.constInt(m.i64, 0);
    case "i1":
      return m.constInt(m.i1, 0);
    case "i8ptr":
    case "array":
    case "ptr":
      return m.constNull(m.ptr);
    case "closure":
    case "promise":
    case "map":
    case "set":
    case "dynobj":
    case "dynarray":
      return m.constNull(m.ptr);
    case "boxed":
      return m.constInt(m.i64, 0x7ffc000000000001n);
    default:
      return m.constInt(m.i64, 0);
  }
}

export function emitCapturedLoad(
  ctx: EmitContext,
  captured: { envAlloc: any; index: number; type: HIRType },
  exprType: HIRType,
): any {
  const m = ctx.m;
  const envPtr = m.buildLoad(m.ptr, captured.envAlloc, "env");
  const ty = llvmType(ctx, captured.type);
  const offset = m.constInt(m.i64, captured.index * 8);
  const fieldRaw = m.buildGEP(m.i8, envPtr, [offset], "cap_ptr");
  return m.buildLoad(ty, fieldRaw, "cap_val");
}

export function emitCapturedStore(
  ctx: EmitContext,
  captured: { envAlloc: any; index: number; type: HIRType },
  val: any,
  _exprType: HIRType,
): void {
  const m = ctx.m;
  const envPtr = m.buildLoad(m.ptr, captured.envAlloc, "env");
  const offset = m.constInt(m.i64, captured.index * 8);
  const fieldRaw = m.buildGEP(m.i8, envPtr, [offset], "cap_ptr");
  m.buildStore(val, fieldRaw);
}

export function blockTerminates(stmts: HIRStmt[]): boolean {
  if (stmts.length === 0) return false;
  const last = stmts[stmts.length - 1];
  if (last.kind === "return" || last.kind === "throw") return true;
  if (last.kind === "if" && last.else) {
    return blockTerminates(last.then) && blockTerminates(last.else);
  }
  return false;
}

export function stmtTerminates(stmts: HIRStmt[]): boolean {
  if (stmts.length === 0) return false;
  const last = stmts[stmts.length - 1];
  return (
    last.kind === "break" ||
    last.kind === "continue" ||
    last.kind === "return" ||
    last.kind === "throw"
  );
}

export function collectLocalIds(stmts: HIRStmt[], ids: Set<number>): void {
  for (const stmt of stmts) {
    if (stmt.kind === "let") ids.add(stmt.id);
    if (stmt.kind === "if") {
      collectLocalIds(stmt.then, ids);
      if (stmt.else) collectLocalIds(stmt.else, ids);
    }
    if (stmt.kind === "while") collectLocalIds(stmt.body, ids);
    if (stmt.kind === "for") {
      if (stmt.init && stmt.init.kind === "let") ids.add(stmt.init.id);
      collectLocalIds(stmt.body, ids);
    }
  }
}

export function findLocalTypeInStmts(stmts: HIRStmt[], id: number): HIRType | null {
  for (const stmt of stmts) {
    if (stmt.kind === "let" && stmt.id === id) return stmt.type;
    if (stmt.kind === "if") {
      const t = findLocalTypeInStmts(stmt.then, id);
      if (t) return t;
      if (stmt.else) {
        const e = findLocalTypeInStmts(stmt.else, id);
        if (e) return e;
      }
    }
    if (stmt.kind === "while") {
      const t = findLocalTypeInStmts(stmt.body, id);
      if (t) return t;
    }
    if (stmt.kind === "for") {
      if (stmt.init && stmt.init.kind === "let" && stmt.init.id === id) return stmt.init.type;
      const t = findLocalTypeInStmts(stmt.body, id);
      if (t) return t;
    }
  }
  return null;
}
