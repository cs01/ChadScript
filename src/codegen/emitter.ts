import type {
  HIRModule,
  HIRFunction,
  HIRStmt,
  HIRExpr,
  HIRType,
  HIRParam,
  BinaryOp,
} from "../hir/types.js";
import {
  LLVMModule,
  LLVMIntEQ,
  LLVMIntNE,
  LLVMIntSLT,
  LLVMIntSLE,
  LLVMIntSGT,
  LLVMIntSGE,
  LLVMRealOEQ,
  LLVMRealONE,
  LLVMRealOLT,
  LLVMRealOLE,
  LLVMRealOGT,
  LLVMRealOGE,
  LLVMPrivateLinkage,
} from "./llvm.js";

class EmitContext {
  readonly m: LLVMModule;
  private localAllocs = new Map<number, any>();
  private localNames = new Map<number, string>();
  private globalValues = new Map<string, { alloc: any; type: HIRType }>();
  private loopStack: { condBlock: any; exitBlock: any }[] = [];
  private declaredFunctions = new Map<string, { fn: any; fnType: any }>();
  private mathIntrinsics = new Map<string, { fn: any; fnType: any }>();
  private currentFn: any = null;

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
}

export interface EmitResult {
  objectFile: string;
  irFile?: string;
}

export function emitModule(mod: HIRModule, objectPath: string, irPath?: string): void {
  const m = new LLVMModule("chadscript");
  const ctx = new EmitContext(m);

  declareExterns(ctx);

  for (const g of mod.globals) {
    const ty = llvmType(ctx, g.type);
    const globalVar = m.addGlobal(`g_${g.name}`, ty);
    m.setInitializer(globalVar, defaultInit(ctx, g.type));
    ctx.registerGlobal(g.name, globalVar, g.type);
  }

  for (const fn of mod.functions) {
    const paramTypes = fn.params.map((p) => llvmType(ctx, p.type));
    const retType = llvmType(ctx, fn.returnType);
    const fnType = m.functionType(retType, paramTypes);
    const llvmFn = m.addFunction(fn.name, fnType);
    ctx.declareFunction(fn.name, llvmFn, fnType);
  }

  for (const fn of mod.functions) {
    emitFunction(ctx, fn);
  }

  emitMain(ctx, mod);

  if (irPath) {
    m.printToFile(irPath);
  }

  m.emitObjectFile(objectPath);
  m.dispose();
}

function declareExterns(ctx: EmitContext): void {
  const m = ctx.m;

  const putsType = m.functionType(m.i32, [m.ptr]);
  const putsFn = m.addFunction("puts", putsType);
  ctx.declareFunction("puts", putsFn, putsType);

  const printfType = m.functionType(m.i32, [m.ptr], true);
  const printfFn = m.addFunction("printf", printfType);
  ctx.declareFunction("printf", printfFn, printfType);

  const sprintfType = m.functionType(m.i32, [m.ptr, m.ptr], true);
  const sprintfFn = m.addFunction("sprintf", sprintfType);
  ctx.declareFunction("sprintf", sprintfFn, sprintfType);

  const exitType = m.functionType(m.voidTy, [m.i32]);
  const exitFn = m.addFunction("exit", exitType);
  ctx.declareFunction("exit", exitFn, exitType);

  const strlenType = m.functionType(m.i64, [m.ptr]);
  const strlenFn = m.addFunction("strlen", strlenType);
  ctx.declareFunction("strlen", strlenFn, strlenType);

  const mallocType = m.functionType(m.ptr, [m.i64]);
  const mallocFn = m.addFunction("malloc", mallocType);
  ctx.declareFunction("malloc", mallocFn, mallocType);

  const strcpyType = m.functionType(m.ptr, [m.ptr, m.ptr]);
  const strcpyFn = m.addFunction("strcpy", strcpyType);
  ctx.declareFunction("strcpy", strcpyFn, strcpyType);

  const strcatType = m.functionType(m.ptr, [m.ptr, m.ptr]);
  const strcatFn = m.addFunction("strcat", strcatType);
  ctx.declareFunction("strcat", strcatFn, strcatType);

  const strcmpType = m.functionType(m.i32, [m.ptr, m.ptr]);
  const strcmpFn = m.addFunction("strcmp", strcmpType);
  ctx.declareFunction("strcmp", strcmpFn, strcmpType);

  const mathIntrinsics1: [string, string][] = [
    ["llvm.floor.f64", "cs_math_floor"],
    ["llvm.ceil.f64", "cs_math_ceil"],
    ["llvm.fabs.f64", "cs_math_abs"],
    ["llvm.sqrt.f64", "cs_math_sqrt"],
    ["llvm.log.f64", "cs_math_log"],
    ["llvm.round.f64", "cs_math_round"],
  ];
  const math1Type = m.functionType(m.f64, [m.f64]);
  for (const [llvmName, csName] of mathIntrinsics1) {
    const fn = m.addFunction(llvmName, math1Type);
    ctx.declareMathIntrinsic(csName, fn, math1Type);
  }

  const mathIntrinsics2: [string, string][] = [
    ["llvm.pow.f64", "cs_math_pow"],
    ["llvm.maxnum.f64", "cs_math_max"],
    ["llvm.minnum.f64", "cs_math_min"],
  ];
  const math2Type = m.functionType(m.f64, [m.f64, m.f64]);
  for (const [llvmName, csName] of mathIntrinsics2) {
    const fn = m.addFunction(llvmName, math2Type);
    ctx.declareMathIntrinsic(csName, fn, math2Type);
  }
}

function llvmType(ctx: EmitContext, t: HIRType): any {
  const m = ctx.m;
  switch (t.kind) {
    case "f64":
      return m.f64;
    case "i32":
      return m.i32;
    case "i1":
      return m.i1;
    case "i8ptr":
      return m.ptr;
    case "void":
      return m.voidTy;
    case "boxed":
      return m.f64;
    case "ptr":
    case "array":
    case "struct":
      return m.ptr;
    default: {
      const _: never = t;
      throw new Error(`unknown HIR type: ${JSON.stringify(t)}`);
    }
  }
}

function defaultInit(ctx: EmitContext, t: HIRType): any {
  const m = ctx.m;
  switch (t.kind) {
    case "f64":
      return m.constReal(m.f64, 0.0);
    case "i32":
      return m.constInt(m.i32, 0);
    case "i1":
      return m.constInt(m.i1, 0);
    case "i8ptr":
      return m.constNull(m.ptr);
    default:
      return m.constInt(m.i32, 0);
  }
}

function emitFunction(ctx: EmitContext, fn: HIRFunction): void {
  const m = ctx.m;
  ctx.resetLocals();

  const decl = ctx.getDeclaredFunction(fn.name)!;
  const llvmFn = decl.fn;
  ctx.setCurrentFn(llvmFn);

  const entry = m.appendBlock(llvmFn, "entry");
  m.positionAtEnd(entry);

  for (let i = 0; i < fn.params.length; i++) {
    const p = fn.params[i];
    const ty = llvmType(ctx, p.type);
    const alloc = m.buildAlloca(ty, p.name);
    m.buildStore(m.getParam(llvmFn, i), alloc);
    ctx.registerLocal(p.id, p.name, alloc);
  }

  for (const stmt of fn.body) {
    emitStmt(ctx, stmt);
  }

  if (!blockTerminates(fn.body)) {
    if (fn.returnType.kind === "void") {
      m.buildRetVoid();
    }
  }
}

function emitMain(ctx: EmitContext, mod: HIRModule): void {
  const m = ctx.m;
  ctx.resetLocals();

  const mainType = m.functionType(m.i32, [m.i32, m.ptr]);
  const mainFn = m.addFunction("main", mainType);
  ctx.setCurrentFn(mainFn);

  const entry = m.appendBlock(mainFn, "entry");
  m.positionAtEnd(entry);

  for (const g of mod.globals) {
    if (g.init) {
      const val = emitExpr(ctx, g.init);
      const globalInfo = ctx.getGlobal(g.name)!;
      m.buildStore(val, globalInfo.alloc);
    }
  }

  for (const stmt of mod.init) {
    emitStmt(ctx, stmt);
  }

  m.buildRet(m.constInt(m.i32, 0));
}

function blockTerminates(stmts: HIRStmt[]): boolean {
  if (stmts.length === 0) return false;
  const last = stmts[stmts.length - 1];
  if (last.kind === "return") return true;
  if (last.kind === "if" && last.else) {
    return blockTerminates(last.then) && blockTerminates(last.else);
  }
  return false;
}

function stmtTerminates(stmts: HIRStmt[]): boolean {
  if (stmts.length === 0) return false;
  const last = stmts[stmts.length - 1];
  return last.kind === "break" || last.kind === "continue" || last.kind === "return";
}

function emitStmt(ctx: EmitContext, stmt: HIRStmt): void {
  const m = ctx.m;

  switch (stmt.kind) {
    case "let": {
      const ty = llvmType(ctx, stmt.type);
      const alloc = m.buildAlloca(ty, stmt.name);
      ctx.registerLocal(stmt.id, stmt.name, alloc);
      if (stmt.init) {
        const val = emitExpr(ctx, stmt.init);
        m.buildStore(val, alloc);
      }
      break;
    }
    case "expr":
      emitExpr(ctx, stmt.expr);
      break;
    case "return": {
      if (stmt.value) {
        const val = emitExpr(ctx, stmt.value);
        m.buildRet(val);
      } else {
        m.buildRetVoid();
      }
      break;
    }
    case "if": {
      const cond = emitExpr(ctx, stmt.condition);
      const fn = ctx.getCurrentFn();
      const thenBlock = m.appendBlock(fn, "then");
      const elseBlock = stmt.else ? m.appendBlock(fn, "else") : null;
      const mergeBlock = m.appendBlock(fn, "merge");

      m.buildCondBr(cond, thenBlock, elseBlock || mergeBlock);

      m.positionAtEnd(thenBlock);
      for (const s of stmt.then) emitStmt(ctx, s);
      const thenTerminated = blockTerminates(stmt.then);
      if (!thenTerminated) m.buildBr(mergeBlock);

      let elseTerminated = false;
      if (stmt.else && elseBlock) {
        m.positionAtEnd(elseBlock);
        for (const s of stmt.else) emitStmt(ctx, s);
        elseTerminated = blockTerminates(stmt.else);
        if (!elseTerminated) m.buildBr(mergeBlock);
      }

      if (!(thenTerminated && elseTerminated)) {
        m.positionAtEnd(mergeBlock);
      }
      break;
    }
    case "while": {
      const fn = ctx.getCurrentFn();
      const condBlock = m.appendBlock(fn, "while.cond");
      const bodyBlock = m.appendBlock(fn, "while.body");
      const exitBlock = m.appendBlock(fn, "while.exit");

      ctx.pushLoop(condBlock, exitBlock);
      m.buildBr(condBlock);

      m.positionAtEnd(condBlock);
      const cond = emitExpr(ctx, stmt.condition);
      m.buildCondBr(cond, bodyBlock, exitBlock);

      m.positionAtEnd(bodyBlock);
      for (const s of stmt.body) emitStmt(ctx, s);
      if (!stmtTerminates(stmt.body)) m.buildBr(condBlock);

      m.positionAtEnd(exitBlock);
      ctx.popLoop();
      break;
    }
    case "for": {
      if (stmt.init) emitStmt(ctx, stmt.init);
      const fn = ctx.getCurrentFn();
      const condBlock = m.appendBlock(fn, "for.cond");
      const bodyBlock = m.appendBlock(fn, "for.body");
      const updateBlock = m.appendBlock(fn, "for.update");
      const exitBlock = m.appendBlock(fn, "for.exit");

      ctx.pushLoop(updateBlock, exitBlock);
      m.buildBr(condBlock);

      m.positionAtEnd(condBlock);
      if (stmt.condition) {
        const cond = emitExpr(ctx, stmt.condition);
        m.buildCondBr(cond, bodyBlock, exitBlock);
      } else {
        m.buildBr(bodyBlock);
      }

      m.positionAtEnd(bodyBlock);
      for (const s of stmt.body) emitStmt(ctx, s);
      if (!stmtTerminates(stmt.body)) m.buildBr(updateBlock);

      m.positionAtEnd(updateBlock);
      if (stmt.update) emitExpr(ctx, stmt.update);
      m.buildBr(condBlock);

      m.positionAtEnd(exitBlock);
      ctx.popLoop();
      break;
    }
    case "break": {
      const loop = ctx.currentLoop();
      m.buildBr(loop.exitBlock);
      const fn = ctx.getCurrentFn();
      const deadBlock = m.appendBlock(fn, "dead");
      m.positionAtEnd(deadBlock);
      break;
    }
    case "continue": {
      const loop = ctx.currentLoop();
      m.buildBr(loop.condBlock);
      const fn = ctx.getCurrentFn();
      const deadBlock = m.appendBlock(fn, "dead");
      m.positionAtEnd(deadBlock);
      break;
    }
    default:
      break;
  }
}

function emitExpr(ctx: EmitContext, expr: HIRExpr): any {
  const m = ctx.m;

  switch (expr.kind) {
    case "literal_f64":
      return m.constReal(m.f64, expr.value);
    case "literal_i32":
      return m.constInt(m.i32, expr.value);
    case "literal_i1":
      return m.constInt(m.i1, expr.value ? 1 : 0);
    case "literal_string":
      return m.buildGlobalStringPtr(expr.value, "str");
    case "literal_null":
      return m.constNull(m.ptr);
    case "local_get": {
      const alloc = ctx.getLocalAlloc(expr.id);
      const ty = llvmType(ctx, expr.type);
      return m.buildLoad(ty, alloc, "");
    }
    case "local_set": {
      const val = emitExpr(ctx, expr.value);
      const alloc = ctx.getLocalAlloc(expr.id);
      m.buildStore(val, alloc);
      return val;
    }
    case "global_get": {
      const g = ctx.getGlobal(expr.name)!;
      const ty = llvmType(ctx, expr.type);
      return m.buildLoad(ty, g.alloc, "");
    }
    case "global_set": {
      const val = emitExpr(ctx, expr.value);
      const g = ctx.getGlobal(expr.name)!;
      m.buildStore(val, g.alloc);
      return val;
    }
    case "binary":
      return emitBinary(ctx, expr);
    case "unary":
      return emitUnary(ctx, expr);
    case "call":
      return emitCall(ctx, expr);
    case "runtime_call":
      return emitRuntimeCall(ctx, expr);
    case "conditional": {
      const cond = emitExpr(ctx, expr.condition);
      const thenVal = emitExpr(ctx, expr.then);
      const elseVal = emitExpr(ctx, expr.else);
      return m.buildSelect(cond, thenVal, elseVal, "");
    }
    case "narrow_i32": {
      const val = emitExpr(ctx, expr.value);
      const i64val = m.buildFPToSI(val, m.i64, "");
      return m.buildTrunc(i64val, m.i32, "");
    }
    case "widen_f64": {
      const val = emitExpr(ctx, expr.value);
      return m.buildSIToFP(val, m.f64, "");
    }
    default:
      return m.constInt(m.i32, 0);
  }
}

function emitCall(ctx: EmitContext, expr: HIRExpr & { kind: "call" }): any {
  const m = ctx.m;
  const args = expr.args.map((a) => emitExpr(ctx, a));
  const decl = ctx.getDeclaredFunction(expr.callee);
  if (!decl) throw new Error(`undeclared function: ${expr.callee}`);
  return m.buildCall(decl.fnType, decl.fn, args, expr.returnType.kind === "void" ? "" : "");
}

function emitBinary(ctx: EmitContext, expr: HIRExpr & { kind: "binary" }): any {
  const m = ctx.m;

  if (expr.op === "and" || expr.op === "or") {
    return emitShortCircuit(ctx, expr);
  }

  if (expr.op === "str_eq" || expr.op === "str_ne") {
    return emitStringCompare(ctx, expr);
  }

  const left = emitExpr(ctx, expr.left);
  const right = emitExpr(ctx, expr.right);
  const isFloat = expr.left.type.kind === "f64";

  switch (expr.op) {
    case "add":
      return isFloat ? m.buildFAdd(left, right, "") : m.buildAdd(left, right, "");
    case "sub":
      return isFloat ? m.buildFSub(left, right, "") : m.buildSub(left, right, "");
    case "mul":
      return isFloat ? m.buildFMul(left, right, "") : m.buildMul(left, right, "");
    case "div":
      return isFloat ? m.buildFDiv(left, right, "") : m.buildSDiv(left, right, "");
    case "rem":
      return isFloat ? m.buildFRem(left, right, "") : m.buildSRem(left, right, "");
    case "eq":
      return isFloat
        ? m.buildFCmp(LLVMRealOEQ, left, right, "")
        : m.buildICmp(LLVMIntEQ, left, right, "");
    case "ne":
      return isFloat
        ? m.buildFCmp(LLVMRealONE, left, right, "")
        : m.buildICmp(LLVMIntNE, left, right, "");
    case "lt":
      return isFloat
        ? m.buildFCmp(LLVMRealOLT, left, right, "")
        : m.buildICmp(LLVMIntSLT, left, right, "");
    case "le":
      return isFloat
        ? m.buildFCmp(LLVMRealOLE, left, right, "")
        : m.buildICmp(LLVMIntSLE, left, right, "");
    case "gt":
      return isFloat
        ? m.buildFCmp(LLVMRealOGT, left, right, "")
        : m.buildICmp(LLVMIntSGT, left, right, "");
    case "ge":
      return isFloat
        ? m.buildFCmp(LLVMRealOGE, left, right, "")
        : m.buildICmp(LLVMIntSGE, left, right, "");
    case "bit_and":
      return m.buildAnd(left, right, "");
    case "bit_or":
      return m.buildOr(left, right, "");
    case "bit_xor":
      return m.buildXor(left, right, "");
    case "shl":
      return m.buildShl(left, right, "");
    case "shr":
      return m.buildAShr(left, right, "");
    case "ushr":
      return m.buildLShr(left, right, "");
    default:
      throw new Error(`unhandled binary op: ${expr.op}`);
  }
}

function emitStringCompare(ctx: EmitContext, expr: HIRExpr & { kind: "binary" }): any {
  const m = ctx.m;
  const left = emitExpr(ctx, expr.left);
  const right = emitExpr(ctx, expr.right);
  const strcmp = ctx.getDeclaredFunction("strcmp")!;
  const result = m.buildCall(strcmp.fnType, strcmp.fn, [left, right], "");
  if (expr.op === "str_eq") {
    return m.buildICmp(LLVMIntEQ, result, m.constInt(m.i32, 0), "");
  }
  return m.buildICmp(LLVMIntNE, result, m.constInt(m.i32, 0), "");
}

function emitShortCircuit(ctx: EmitContext, expr: HIRExpr & { kind: "binary" }): any {
  const m = ctx.m;
  const fn = ctx.getCurrentFn();

  const left = emitExpr(ctx, expr.left);
  const leftBlock = m.getInsertBlock();

  const rhsBlock = m.appendBlock(fn, "sc.rhs");
  const mergeBlock = m.appendBlock(fn, "sc.merge");

  if (expr.op === "and") {
    m.buildCondBr(left, rhsBlock, mergeBlock);
  } else {
    m.buildCondBr(left, mergeBlock, rhsBlock);
  }

  m.positionAtEnd(rhsBlock);
  const right = emitExpr(ctx, expr.right);
  const rhsEndBlock = m.getInsertBlock();
  m.buildBr(mergeBlock);

  m.positionAtEnd(mergeBlock);
  const phi = m.buildPhi(m.i1, "");

  if (expr.op === "and") {
    m.addIncoming(phi, [right, m.constInt(m.i1, 0)], [rhsEndBlock, leftBlock]);
  } else {
    m.addIncoming(phi, [right, m.constInt(m.i1, 1)], [rhsEndBlock, leftBlock]);
  }

  return phi;
}

function emitUnary(ctx: EmitContext, expr: HIRExpr & { kind: "unary" }): any {
  const m = ctx.m;
  const operand = emitExpr(ctx, expr.operand);

  switch (expr.op) {
    case "neg":
      return expr.operand.type.kind === "f64" ? m.buildFNeg(operand, "") : m.buildNeg(operand, "");
    case "not":
      return m.buildXor(operand, m.constInt(m.i1, 1), "");
    case "bit_not":
      return m.buildNot(operand, "");
    default:
      throw new Error(`unhandled unary op: ${expr.op}`);
  }
}

function emitRuntimeCall(ctx: EmitContext, expr: HIRExpr & { kind: "runtime_call" }): any {
  const m = ctx.m;

  if (expr.func.startsWith("cs_math_")) {
    return emitMathCall(ctx, expr);
  }

  if (expr.func === "cs_string_concat") {
    return emitStringConcat(ctx, expr);
  }

  if (expr.func === "cs_console_log") {
    for (let i = 0; i < expr.args.length; i++) {
      if (i > 0) {
        const spaceStr = m.buildGlobalStringPtr(" ", "space");
        const printf = ctx.getDeclaredFunction("printf")!;
        m.buildCall(printf.fnType, printf.fn, [spaceStr], "");
      }
      const arg = expr.args[i];
      const val = emitExpr(ctx, arg);
      emitPrintValue(ctx, arg, val, i === expr.args.length - 1);
    }
    if (expr.args.length === 0) {
      const nlStr = m.buildGlobalStringPtr("\n", "nl");
      const printf = ctx.getDeclaredFunction("printf")!;
      m.buildCall(printf.fnType, printf.fn, [nlStr], "");
    }
    return m.constInt(m.i32, 0);
  }

  return m.constInt(m.i32, 0);
}

function emitPrintValue(ctx: EmitContext, arg: HIRExpr, val: any, isLast: boolean): void {
  const m = ctx.m;
  const nl = isLast ? "\n" : "";

  if (arg.type.kind === "i8ptr") {
    if (isLast) {
      const puts = ctx.getDeclaredFunction("puts")!;
      m.buildCall(puts.fnType, puts.fn, [val], "");
    } else {
      const fmt = m.buildGlobalStringPtr("%s", "fmt");
      const printf = ctx.getDeclaredFunction("printf")!;
      m.buildCall(printf.fnType, printf.fn, [fmt, val], "");
    }
  } else if (arg.type.kind === "f64") {
    const fmt = m.buildGlobalStringPtr(`%.17g${nl}`, "fmt");
    const printf = ctx.getDeclaredFunction("printf")!;
    m.buildCall(printf.fnType, printf.fn, [fmt, val], "");
  } else if (arg.type.kind === "i32") {
    const fmt = m.buildGlobalStringPtr(`%d${nl}`, "fmt");
    const printf = ctx.getDeclaredFunction("printf")!;
    m.buildCall(printf.fnType, printf.fn, [fmt, val], "");
  } else if (arg.type.kind === "i1") {
    const trueStr = m.buildGlobalStringPtr("true", "true");
    const falseStr = m.buildGlobalStringPtr("false", "false");
    const selected = m.buildSelect(val, trueStr, falseStr, "");
    if (isLast) {
      const puts = ctx.getDeclaredFunction("puts")!;
      m.buildCall(puts.fnType, puts.fn, [selected], "");
    } else {
      const fmt = m.buildGlobalStringPtr("%s", "fmt");
      const printf = ctx.getDeclaredFunction("printf")!;
      m.buildCall(printf.fnType, printf.fn, [fmt, selected], "");
    }
  }
}

function emitToString(ctx: EmitContext, arg: HIRExpr, val: any): any {
  const m = ctx.m;
  if (arg.type.kind === "i8ptr") return val;

  const malloc = ctx.getDeclaredFunction("malloc")!;
  const buf = m.buildCall(malloc.fnType, malloc.fn, [m.constInt(m.i64, 32)], "buf");

  if (arg.type.kind === "f64") {
    const fmt = m.buildGlobalStringPtr("%.17g", "fmt");
    const sprintf = ctx.getDeclaredFunction("sprintf")!;
    m.buildCall(sprintf.fnType, sprintf.fn, [buf, fmt, val], "");
  } else if (arg.type.kind === "i32") {
    const fmt = m.buildGlobalStringPtr("%d", "fmt");
    const sprintf = ctx.getDeclaredFunction("sprintf")!;
    m.buildCall(sprintf.fnType, sprintf.fn, [buf, fmt, val], "");
  } else if (arg.type.kind === "i1") {
    const trueStr = m.buildGlobalStringPtr("true", "true");
    const falseStr = m.buildGlobalStringPtr("false", "false");
    return m.buildSelect(val, trueStr, falseStr, "");
  }

  return buf;
}

function emitStringConcat(ctx: EmitContext, expr: HIRExpr & { kind: "runtime_call" }): any {
  const m = ctx.m;
  const leftArg = expr.args[0];
  const rightArg = expr.args[1];
  const leftVal = emitExpr(ctx, leftArg);
  const rightVal = emitExpr(ctx, rightArg);

  const leftStr = emitToString(ctx, leftArg, leftVal);
  const rightStr = emitToString(ctx, rightArg, rightVal);

  const strlen = ctx.getDeclaredFunction("strlen")!;
  const malloc = ctx.getDeclaredFunction("malloc")!;
  const strcpy = ctx.getDeclaredFunction("strcpy")!;
  const strcat = ctx.getDeclaredFunction("strcat")!;

  const lenL = m.buildCall(strlen.fnType, strlen.fn, [leftStr], "");
  const lenR = m.buildCall(strlen.fnType, strlen.fn, [rightStr], "");
  const totalLen = m.buildAdd(lenL, lenR, "");
  const totalLen1 = m.buildAdd(totalLen, m.constInt(m.i64, 1), "");
  const buf = m.buildCall(malloc.fnType, malloc.fn, [totalLen1], "");
  m.buildCall(strcpy.fnType, strcpy.fn, [buf, leftStr], "");
  m.buildCall(strcat.fnType, strcat.fn, [buf, rightStr], "");
  return buf;
}

function emitMathCall(ctx: EmitContext, expr: HIRExpr & { kind: "runtime_call" }): any {
  const m = ctx.m;
  const intrinsic = ctx.getMathIntrinsic(expr.func);
  if (!intrinsic) throw new Error(`unsupported math function: ${expr.func}`);

  const args = expr.args.map((a) => {
    const val = emitExpr(ctx, a);
    if (a.type.kind === "i32") {
      return m.buildSIToFP(val, m.f64, "");
    }
    return val;
  });

  return m.buildCall(intrinsic.fnType, intrinsic.fn, args, "");
}
