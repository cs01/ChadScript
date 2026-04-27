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

  getInterfaceType(
    name: string,
  ): { fatType: any; iface: import("../hir/types.js").HIRInterface; layoutType: any } | undefined {
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

  resetLocalsAndCaptures(): void {
    this.localAllocs.clear();
    this.localNames.clear();
    this.capturedLocals.clear();
    this.envAlloc = null;
  }
}

export interface EmitResult {
  objectFile: string;
  irFile?: string;
}

type CaptureMap = Map<
  string,
  { capturedIds: Set<number>; envTypes: { id: number; type: HIRType }[] }
>;

function buildCaptureMap(mod: HIRModule): CaptureMap {
  const fnByName = new Map<string, HIRFunction>();
  for (const fn of mod.functions) fnByName.set(fn.name, fn);

  const result: CaptureMap = new Map();

  for (const fn of mod.functions) {
    if (fn.captures.length === 0) continue;
    for (const outerFn of mod.functions) {
      if (outerFn === fn) continue;
      const outerIds = new Set<number>();
      collectLocalIds(outerFn.body, outerIds);
      for (const p of outerFn.params) outerIds.add(p.id);

      const overlap = fn.captures.filter((cid) => outerIds.has(cid));
      if (overlap.length > 0) {
        const existing = result.get(outerFn.name) || {
          capturedIds: new Set<number>(),
          envTypes: [],
        };
        for (const cid of overlap) {
          if (!existing.capturedIds.has(cid)) {
            existing.capturedIds.add(cid);
            const type = findLocalType(outerFn, cid);
            existing.envTypes.push({ id: cid, type });
          }
        }
        result.set(outerFn.name, existing);
      }
    }
  }

  return result;
}

function collectLocalIds(stmts: HIRStmt[], ids: Set<number>): void {
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

function findLocalType(fn: HIRFunction, id: number): HIRType {
  for (const p of fn.params) if (p.id === id) return p.type;
  return findLocalTypeInStmts(fn.body, id) || { kind: "f64" };
}

function findLocalTypeInStmts(stmts: HIRStmt[], id: number): HIRType | null {
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

function findClosureFuncNames(mod: HIRModule, names: Set<string>): void {
  function scanExpr(expr: HIRExpr): void {
    if (expr.kind === "make_closure") names.add(expr.funcName);
    if ("value" in expr && expr.value && typeof expr.value === "object" && "kind" in expr.value)
      scanExpr(expr.value as HIRExpr);
    if ("left" in expr && expr.left) scanExpr(expr.left as HIRExpr);
    if ("right" in expr && expr.right) scanExpr(expr.right as HIRExpr);
    if ("args" in expr && Array.isArray(expr.args)) (expr.args as HIRExpr[]).forEach(scanExpr);
    if ("callee" in expr && expr.callee && typeof expr.callee === "object" && "kind" in expr.callee)
      scanExpr(expr.callee as HIRExpr);
    if ("object" in expr && expr.object) scanExpr(expr.object as HIRExpr);
    if ("condition" in expr && expr.condition) scanExpr(expr.condition as HIRExpr);
    if ("then" in expr && expr.then && typeof expr.then === "object" && "kind" in expr.then)
      scanExpr(expr.then as HIRExpr);
  }
  function scanStmts(stmts: HIRStmt[]): void {
    for (const s of stmts) {
      if (s.kind === "expr") scanExpr(s.expr);
      if (s.kind === "return" && s.value) scanExpr(s.value);
      if (s.kind === "let" && s.init) scanExpr(s.init);
      if (s.kind === "if") {
        scanExpr(s.condition);
        scanStmts(s.then);
        if (s.else) scanStmts(s.else);
      }
      if (s.kind === "while") {
        scanExpr(s.condition);
        scanStmts(s.body);
      }
      if (s.kind === "for") scanStmts(s.body);
    }
  }
  for (const fn of mod.functions) scanStmts(fn.body);
  scanStmts(mod.init);
}

export function emitModule(mod: HIRModule, objectPath: string, irPath?: string): void {
  const m = new LLVMModule("chadscript");
  const ctx = new EmitContext(m);

  if (mod.sourceInfo) {
    m.initDebugInfo(mod.sourceInfo.filename, mod.sourceInfo.directory);
  }

  declareExterns(ctx);

  for (const iface of mod.interfaces) {
    const fatTy = m.structCreateNamed(`${iface.name}_fat`);
    m.structSetBody(fatTy, [m.ptr, m.ptr]);
    const fieldLayoutTy = m.structCreateNamed(`${iface.name}_layout`);
    const fieldTypes = iface.fields.map((f) => llvmType(ctx, f.type));
    m.structSetBody(fieldLayoutTy, fieldTypes);
    ctx.registerInterfaceType(iface.name, fatTy, iface, fieldLayoutTy);
  }

  for (const cls of mod.classes) {
    const fieldTypes = cls.fields.map((f) => llvmType(ctx, f.type));
    const structTy = m.structCreateNamed(cls.name);
    m.structSetBody(structTy, fieldTypes);
    ctx.registerStructType(cls.name, structTy, cls.fields);
  }

  for (const g of mod.globals) {
    const ty = llvmType(ctx, g.type);
    const globalVar = m.addGlobal(`g_${g.name}`, ty);
    m.setInitializer(globalVar, defaultInit(ctx, g.type));
    ctx.registerGlobal(g.name, globalVar, g.type);
  }

  const closureFuncs = new Set<string>();
  for (const fn of mod.functions) {
    if (fn.captures.length > 0) closureFuncs.add(fn.name);
  }
  findClosureFuncNames(mod, closureFuncs);

  for (const fn of mod.functions) {
    const paramTypes = fn.params.map((p) => llvmType(ctx, p.type));
    if (closureFuncs.has(fn.name)) paramTypes.unshift(m.ptr);
    const retType = llvmType(ctx, fn.returnType);
    const fnType = m.functionType(retType, paramTypes);
    const llvmFn = m.addFunction(fn.name, fnType);
    ctx.declareFunction(fn.name, llvmFn, fnType);
  }

  const capturedByOuter = buildCaptureMap(mod);

  buildVtables(ctx, mod);

  for (const fn of mod.functions) {
    emitFunction(ctx, fn, capturedByOuter, closureFuncs);
  }

  emitMain(ctx, mod);

  m.finalizeDebugInfo();

  if (irPath) {
    m.printToFile(irPath);
  }

  m.emitObjectFile(objectPath);
  m.dispose();
}

function buildVtables(ctx: EmitContext, mod: HIRModule): void {
  const m = ctx.m;
  for (const cls of mod.classes) {
    if (!cls.implements) continue;
    for (const ifaceName of cls.implements) {
      const ifaceInfo = ctx.getInterfaceType(ifaceName);
      if (!ifaceInfo) continue;
      const iface = ifaceInfo.iface;
      const fnPtrs: any[] = [];
      for (const method of iface.methods) {
        const fnName = `${cls.name}_${method.name}`;
        const decl = ctx.getDeclaredFunction(fnName);
        if (!decl) throw new Error(`missing method ${fnName} for vtable`);
        fnPtrs.push(decl.fn);
      }
      const vtableArrType = m.arrayType(m.ptr, fnPtrs.length);
      const vtableConst = m.constArray(m.ptr, fnPtrs);
      const vtableGlobal = m.addGlobal(`vtable_${cls.name}_${ifaceName}`, vtableArrType);
      m.setInitializer(vtableGlobal, vtableConst);
      m.setLinkage(vtableGlobal, LLVMPrivateLinkage);
      ctx.registerVtable(`${cls.name}_${ifaceName}`, vtableGlobal);
    }
  }
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

  const printNumType = m.functionType(m.voidTy, [m.f64]);
  const printNumFn = m.addFunction("cs2_print_number", printNumType);
  ctx.declareFunction("cs2_print_number", printNumFn, printNumType);

  const fmtNumType = m.functionType(m.voidTy, [m.ptr, m.f64]);
  const fmtNumFn = m.addFunction("cs2_format_number", fmtNumType);
  ctx.declareFunction("cs2_format_number", fmtNumFn, fmtNumType);

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

  const setjmpType = m.functionType(m.i32, [m.ptr]);
  const setjmpFn = m.addFunction("_setjmp", setjmpType);
  ctx.declareFunction("_setjmp", setjmpFn, setjmpType);

  const bridgeFns: [string, any, any[]][] = [
    ["cs2_str_length", m.i32, [m.ptr]],
    ["cs2_str_char_at", m.ptr, [m.ptr, m.i32]],
    ["cs2_str_index_of", m.i32, [m.ptr, m.ptr]],
    ["cs2_str_includes", m.i32, [m.ptr, m.ptr]],
    ["cs2_str_starts_with", m.i32, [m.ptr, m.ptr]],
    ["cs2_str_ends_with", m.i32, [m.ptr, m.ptr]],
    ["cs2_str_slice", m.ptr, [m.ptr, m.i32, m.i32]],
    ["cs2_str_substring", m.ptr, [m.ptr, m.i32, m.i32]],
    ["cs2_str_to_upper", m.ptr, [m.ptr]],
    ["cs2_str_to_lower", m.ptr, [m.ptr]],
    ["cs2_str_trim", m.ptr, [m.ptr]],
    ["cs2_str_repeat", m.ptr, [m.ptr, m.i32]],
    ["cs2_str_replace", m.ptr, [m.ptr, m.ptr, m.ptr]],
    ["cs2_str_char_code_at", m.i32, [m.ptr, m.i32]],
    ["cs2_str_from_char_code", m.ptr, [m.i32]],
    ["cs2_math_random", m.f64, []],
    ["cs2_num_array_new", m.ptr, [m.i32]],
    ["cs2_num_array_push", m.voidTy, [m.ptr, m.f64]],
    ["cs2_num_array_pop", m.f64, [m.ptr]],
    ["cs2_num_array_get", m.f64, [m.ptr, m.i32]],
    ["cs2_num_array_set", m.voidTy, [m.ptr, m.i32, m.f64]],
    ["cs2_num_array_length", m.i32, [m.ptr]],
    ["cs2_num_array_index_of", m.i32, [m.ptr, m.f64]],
    ["cs2_num_array_includes", m.i32, [m.ptr, m.f64]],
    ["cs2_num_array_slice", m.ptr, [m.ptr, m.i32, m.i32]],
    ["cs2_num_array_reverse", m.voidTy, [m.ptr]],
    ["cs2_num_array_join", m.ptr, [m.ptr, m.ptr]],
    ["cs2_num_array_spread", m.voidTy, [m.ptr, m.ptr]],
    ["cs2_str_array_new", m.ptr, [m.i32]],
    ["cs2_str_array_push", m.voidTy, [m.ptr, m.ptr]],
    ["cs2_str_array_pop", m.ptr, [m.ptr]],
    ["cs2_str_array_get", m.ptr, [m.ptr, m.i32]],
    ["cs2_str_array_set", m.voidTy, [m.ptr, m.i32, m.ptr]],
    ["cs2_str_array_length", m.i32, [m.ptr]],
    ["cs2_str_array_join", m.ptr, [m.ptr, m.ptr]],
    ["cs2_str_array_spread", m.voidTy, [m.ptr, m.ptr]],
    ["cs2_obj_array_new", m.ptr, [m.i32]],
    ["cs2_obj_array_push", m.voidTy, [m.ptr, m.ptr]],
    ["cs2_obj_array_pop", m.ptr, [m.ptr]],
    ["cs2_obj_array_get", m.ptr, [m.ptr, m.i32]],
    ["cs2_obj_array_set", m.voidTy, [m.ptr, m.i32, m.ptr]],
    ["cs2_obj_array_length", m.i32, [m.ptr]],
    ["cs2_try_enter", m.ptr, []],
    ["cs2_try_leave", m.voidTy, []],
    ["cs2_throw", m.voidTy, [m.ptr]],
    ["cs2_catch_msg", m.ptr, []],
  ];
  for (const [name, ret, params] of bridgeFns) {
    const fnType = m.functionType(ret, params);
    const fn = m.addFunction(name, fnType);
    ctx.declareFunction(name, fn, fnType);
  }
}

function llvmType(ctx: EmitContext, t: HIRType): any {
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
      return m.f64;
    case "ptr": {
      const ifaceInfo = ctx.getInterfaceType(t.pointee);
      if (ifaceInfo) return ifaceInfo.fatType;
      return m.ptr;
    }
    case "array":
    case "struct":
      return m.ptr;
    case "closure":
      return m.ptr;
    default: {
      const _: never = t;
      throw new Error(`unknown HIR type: ${JSON.stringify(t)}`);
    }
  }
}

function coerceLLVM(ctx: EmitContext, val: any, from: HIRType, to: HIRType): any {
  const m = ctx.m;
  if (from.kind === to.kind) return val;
  if (from.kind === "i64" && to.kind === "f64") return m.buildSIToFP(val, m.f64, "");
  if (from.kind === "f64" && to.kind === "i64") return m.buildFPToSI(val, m.i64, "");
  if (from.kind === "i1" && to.kind === "i64") return m.buildZExt(val, m.i64, "");
  if (from.kind === "i1" && to.kind === "f64") {
    const ext = m.buildZExt(val, m.i64, "");
    return m.buildSIToFP(ext, m.f64, "");
  }
  return val;
}

function defaultInit(ctx: EmitContext, t: HIRType): any {
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
      return m.constNull(m.ptr);
    default:
      return m.constInt(m.i64, 0);
  }
}

function emitFunction(
  ctx: EmitContext,
  fn: HIRFunction,
  capturedByOuter?: CaptureMap,
  closureFuncs?: Set<string>,
): void {
  const m = ctx.m;
  ctx.resetLocalsAndCaptures();
  ctx.currentReturnType = fn.returnType;

  const decl = ctx.getDeclaredFunction(fn.name)!;
  const llvmFn = decl.fn;
  ctx.setCurrentFn(llvmFn);

  const diScope = fn.line ? m.createDebugFunction(llvmFn, fn.name, fn.line) : null;
  ctx.diScope = diScope;
  if (diScope && fn.line) {
    m.setDebugLocation(fn.line, 0, diScope);
  }

  const entry = m.appendBlock(llvmFn, "entry");
  m.positionAtEnd(entry);

  if (diScope && fn.line) {
    m.setDebugLocation(fn.line, 0, diScope);
  }

  const isClosure = closureFuncs?.has(fn.name) || false;
  const captureInfo = capturedByOuter?.get(fn.name);

  if (isClosure) {
    const envParam = m.getParam(llvmFn, 0);
    const envAlloca = m.buildAlloca(m.ptr, "env");
    m.buildStore(envParam, envAlloca);
    ctx.setEnvAlloc(envAlloca);

    for (let i = 0; i < fn.captures.length; i++) {
      const captureId = fn.captures[i];
      const captureType = findCaptureType(fn, captureId);
      ctx.setCapturedLocal(captureId, envAlloca, i, captureType);
    }

    for (let i = 0; i < fn.params.length; i++) {
      const p = fn.params[i];
      const ty = llvmType(ctx, p.type);
      const alloc = m.buildAlloca(ty, p.name);
      m.buildStore(m.getParam(llvmFn, i + 1), alloc);
      ctx.registerLocal(p.id, p.name, alloc);
    }
  } else {
    if (captureInfo) {
      const fieldTypes = captureInfo.envTypes.map((e) => llvmType(ctx, e.type));
      const envStructTy = m.structCreateNamed(`env_${fn.name}`);
      m.structSetBody(envStructTy, fieldTypes);
      const envSize = m.constInt(m.i64, captureInfo.envTypes.length * 8);
      const mallocDecl = ctx.getDeclaredFunction("malloc")!;
      const rawEnv = m.buildCall(mallocDecl.fnType, mallocDecl.fn, [envSize], "env_raw");
      const envAlloca = m.buildAlloca(m.ptr, "env_ptr");
      m.buildStore(rawEnv, envAlloca);
      ctx.setEnvAlloc(envAlloca);

      for (let i = 0; i < captureInfo.envTypes.length; i++) {
        const e = captureInfo.envTypes[i];
        ctx.setCapturedLocal(e.id, envAlloca, i, e.type);
      }
    }

    for (let i = 0; i < fn.params.length; i++) {
      const p = fn.params[i];
      const captured = ctx.getCapturedLocal(p.id);
      if (captured) {
        emitCapturedStore(ctx, captured, m.getParam(llvmFn, i), p.type);
      } else {
        const ty = llvmType(ctx, p.type);
        const alloc = m.buildAlloca(ty, p.name);
        m.buildStore(m.getParam(llvmFn, i), alloc);
        ctx.registerLocal(p.id, p.name, alloc);
      }
    }
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

function findCaptureType(fn: HIRFunction, captureId: number): HIRType {
  return findLocalTypeInStmts(fn.body, captureId) || { kind: "f64" };
}

function emitMain(ctx: EmitContext, mod: HIRModule): void {
  const m = ctx.m;
  ctx.resetLocalsAndCaptures();

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
  if (last.kind === "return" || last.kind === "throw") return true;
  if (last.kind === "if" && last.else) {
    return blockTerminates(last.then) && blockTerminates(last.else);
  }
  return false;
}

function stmtTerminates(stmts: HIRStmt[]): boolean {
  if (stmts.length === 0) return false;
  const last = stmts[stmts.length - 1];
  return (
    last.kind === "break" ||
    last.kind === "continue" ||
    last.kind === "return" ||
    last.kind === "throw"
  );
}

function emitStmt(ctx: EmitContext, stmt: HIRStmt): void {
  const m = ctx.m;

  if (stmt.line && ctx.diScope) {
    m.setDebugLocation(stmt.line, 0, ctx.diScope);
  }

  switch (stmt.kind) {
    case "let": {
      const captured = ctx.getCapturedLocal(stmt.id);
      if (captured) {
        if (stmt.init) {
          const val = emitExpr(ctx, stmt.init);
          emitCapturedStore(ctx, captured, val, stmt.type);
        }
      } else {
        const ty = llvmType(ctx, stmt.type);
        const alloc = m.buildAlloca(ty, stmt.name);
        ctx.registerLocal(stmt.id, stmt.name, alloc);
        if (stmt.init) {
          const val = emitExpr(ctx, stmt.init);
          m.buildStore(val, alloc);
        }
      }
      break;
    }
    case "expr":
      emitExpr(ctx, stmt.expr);
      break;
    case "return": {
      if (stmt.value) {
        let val = emitExpr(ctx, stmt.value);
        val = coerceLLVM(ctx, val, stmt.value.type, ctx.currentReturnType);
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
    case "switch": {
      emitSwitch(ctx, stmt);
      break;
    }
    case "throw": {
      const msgVal = emitExpr(ctx, stmt.value);
      const throwDecl = ctx.getDeclaredFunction("cs2_throw")!;
      m.buildCall(throwDecl.fnType, throwDecl.fn, [msgVal], "");
      m.buildUnreachable();
      const fn = ctx.getCurrentFn();
      const deadBlock = m.appendBlock(fn, "post.throw");
      m.positionAtEnd(deadBlock);
      break;
    }
    case "try": {
      emitTry(ctx, stmt as HIRStmt & { kind: "try" });
      break;
    }
    default:
      throw new Error(`unhandled statement kind: ${(stmt as any).kind}`);
  }
}

function emitSwitch(ctx: EmitContext, stmt: HIRStmt & { kind: "switch" }): void {
  const m = ctx.m;
  const fn = ctx.getCurrentFn();
  const discVal = emitExpr(ctx, stmt.discriminant);
  const exitBlock = m.appendBlock(fn, "switch.exit");
  const discType = stmt.discriminant.type;

  ctx.pushLoop(exitBlock, exitBlock);

  const caseBlocks: any[] = [];
  for (let i = 0; i < stmt.cases.length; i++) {
    caseBlocks.push(m.appendBlock(fn, stmt.cases[i].test ? `case.${i}` : "default"));
  }

  let firstDefault = -1;
  for (let i = 0; i < stmt.cases.length; i++) {
    if (!stmt.cases[i].test) {
      firstDefault = i;
      break;
    }
  }

  for (let i = 0; i < stmt.cases.length; i++) {
    const c = stmt.cases[i];
    if (c.test) {
      let testVal = emitExpr(ctx, c.test);
      let cmp: any;
      if (discType.kind === "f64" && c.test.type.kind === "i64") {
        testVal = m.buildSIToFP(testVal, m.f64, "");
        cmp = m.buildFCmp(LLVMRealOEQ, discVal, testVal, "");
      } else if (discType.kind === "f64") {
        cmp = m.buildFCmp(LLVMRealOEQ, discVal, testVal, "");
      } else if (discType.kind === "i8ptr") {
        const strcmp = ctx.getDeclaredFunction("strcmp")!;
        const result = m.buildCall(strcmp.fnType, strcmp.fn, [discVal, testVal], "");
        cmp = m.buildICmp(LLVMIntEQ, result, m.constInt(m.i32, 0), "");
      } else {
        cmp = m.buildICmp(LLVMIntEQ, discVal, testVal, "");
      }

      const nextCheck =
        i + 1 < stmt.cases.length && stmt.cases[i + 1].test
          ? m.appendBlock(fn, `check.${i + 1}`)
          : firstDefault >= 0
            ? caseBlocks[firstDefault]
            : exitBlock;
      m.buildCondBr(cmp, caseBlocks[i], nextCheck);
      if (nextCheck !== caseBlocks[firstDefault] && nextCheck !== exitBlock) {
        m.positionAtEnd(nextCheck);
      }
    }
  }

  for (let i = 0; i < stmt.cases.length; i++) {
    m.positionAtEnd(caseBlocks[i]);
    for (const s of stmt.cases[i].body) emitStmt(ctx, s);
    if (!stmtTerminates(stmt.cases[i].body)) {
      m.buildBr(exitBlock);
    }
  }

  m.positionAtEnd(exitBlock);
  ctx.popLoop();
}

function emitTry(ctx: EmitContext, stmt: HIRStmt & { kind: "try" }): void {
  const m = ctx.m;
  const fn = ctx.getCurrentFn();

  const tryEnter = ctx.getDeclaredFunction("cs2_try_enter")!;
  const tryLeave = ctx.getDeclaredFunction("cs2_try_leave")!;
  const catchMsg = ctx.getDeclaredFunction("cs2_catch_msg")!;
  const setjmp = ctx.getDeclaredFunction("_setjmp")!;

  const jmpBuf = m.buildCall(tryEnter.fnType, tryEnter.fn, [], "jmpbuf");
  const sjResult = m.buildCall(setjmp.fnType, setjmp.fn, [jmpBuf], "sjresult");
  const isException = m.buildICmp(LLVMIntNE, sjResult, m.constInt(m.i32, 0), "is_exc");

  const tryBodyBB = m.appendBlock(fn, "try.body");
  const catchBB = stmt.catch ? m.appendBlock(fn, "catch.body") : null;
  const finallyBB = stmt.finally ? m.appendBlock(fn, "finally.body") : null;
  const tryEndBB = m.appendBlock(fn, "try.end");

  m.buildCondBr(isException, catchBB || finallyBB || tryEndBB, tryBodyBB);

  m.positionAtEnd(tryBodyBB);
  for (const s of stmt.body) emitStmt(ctx, s);
  if (!blockTerminates(stmt.body)) {
    m.buildCall(tryLeave.fnType, tryLeave.fn, [], "");
    m.buildBr(finallyBB || tryEndBB);
  }

  if (stmt.catch && catchBB) {
    m.positionAtEnd(catchBB);
    m.buildCall(tryLeave.fnType, tryLeave.fn, [], "");
    const errMsg = m.buildCall(catchMsg.fnType, catchMsg.fn, [], "errmsg");
    const errAlloc = m.buildAlloca(m.ptr, stmt.catch.paramName);
    m.buildStore(errMsg, errAlloc);
    ctx.registerLocal(stmt.catch.paramId, stmt.catch.paramName, errAlloc);
    for (const s of stmt.catch.body) emitStmt(ctx, s);
    if (!blockTerminates(stmt.catch.body)) {
      m.buildBr(finallyBB || tryEndBB);
    }
  }

  if (stmt.finally && finallyBB) {
    m.positionAtEnd(finallyBB);
    for (const s of stmt.finally) emitStmt(ctx, s);
    if (!blockTerminates(stmt.finally)) {
      m.buildBr(tryEndBB);
    }
  }

  m.positionAtEnd(tryEndBB);
}

function emitExpr(ctx: EmitContext, expr: HIRExpr): any {
  const m = ctx.m;

  switch (expr.kind) {
    case "literal_f64":
      return m.constReal(m.f64, expr.value);
    case "literal_i64":
      return m.constInt(m.i64, expr.value);
    case "literal_i1":
      return m.constInt(m.i1, expr.value ? 1 : 0);
    case "literal_string":
      return m.buildGlobalStringPtr(expr.value, "str");
    case "literal_null":
      return m.constNull(m.ptr);
    case "local_get": {
      const alloc = ctx.getLocalAlloc(expr.id);
      if (alloc) {
        const ty = llvmType(ctx, expr.type);
        return m.buildLoad(ty, alloc, "");
      }
      const captured = ctx.getCapturedLocal(expr.id);
      if (captured) {
        return emitCapturedLoad(ctx, captured, expr.type);
      }
      throw new Error(`unresolved local id ${expr.id}`);
    }
    case "local_set": {
      const val = emitExpr(ctx, expr.value);
      const alloc = ctx.getLocalAlloc(expr.id);
      if (alloc) {
        m.buildStore(val, alloc);
        return val;
      }
      const captured = ctx.getCapturedLocal(expr.id);
      if (captured) {
        emitCapturedStore(ctx, captured, val, expr.type);
        return val;
      }
      throw new Error(`unresolved local id ${expr.id}`);
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
      const fn = ctx.getCurrentFn();
      const cond = emitExpr(ctx, expr.condition);

      const thenBlock = m.appendBlock(fn, "cond.then");
      const elseBlock = m.appendBlock(fn, "cond.else");
      const mergeBlock = m.appendBlock(fn, "cond.merge");

      m.buildCondBr(cond, thenBlock, elseBlock);

      m.positionAtEnd(thenBlock);
      const thenVal = emitExpr(ctx, expr.then);
      const thenEndBlock = m.getInsertBlock();
      m.buildBr(mergeBlock);

      m.positionAtEnd(elseBlock);
      const elseVal = emitExpr(ctx, expr.else);
      const elseEndBlock = m.getInsertBlock();
      m.buildBr(mergeBlock);

      m.positionAtEnd(mergeBlock);
      const ty = llvmType(ctx, expr.type);
      const phi = m.buildPhi(ty, "");
      m.addIncoming(phi, [thenVal, elseVal], [thenEndBlock, elseEndBlock]);
      return phi;
    }
    case "narrow_i64": {
      const val = emitExpr(ctx, expr.value);
      return m.buildFPToSI(val, m.i64, "");
    }
    case "widen_f64": {
      const val = emitExpr(ctx, expr.value);
      return m.buildSIToFP(val, m.f64, "");
    }
    case "alloc_array":
      return emitAllocArray(ctx, expr as HIRExpr & { kind: "alloc_array" });
    case "alloc_array_spread":
      return emitAllocArraySpread(ctx, expr as HIRExpr & { kind: "alloc_array_spread" });
    case "alloc_struct":
      return emitAllocStruct(ctx, expr as HIRExpr & { kind: "alloc_struct" });
    case "field_get":
      return emitFieldGet(ctx, expr as HIRExpr & { kind: "field_get" });
    case "field_set":
      return emitFieldSet(ctx, expr as HIRExpr & { kind: "field_set" });
    case "index_get":
      return emitIndexGet(ctx, expr as HIRExpr & { kind: "index_get" });
    case "index_set":
      return emitIndexSet(ctx, expr as HIRExpr & { kind: "index_set" });
    case "vtable_call":
      return emitVtableCall(ctx, expr as HIRExpr & { kind: "vtable_call" });
    case "wrap_interface":
      return emitWrapInterface(ctx, expr as HIRExpr & { kind: "wrap_interface" });
    case "make_closure":
      return emitMakeClosure(ctx, expr as HIRExpr & { kind: "make_closure" });
    case "call_closure":
      return emitCallClosure(ctx, expr as HIRExpr & { kind: "call_closure" });
    default:
      return m.constInt(m.i64, 0);
  }
}

function emitArrayPrefix(elemType: HIRType): string {
  if (elemType.kind === "i8ptr") return "cs2_str_array";
  if (elemType.kind === "ptr") return "cs2_obj_array";
  return "cs2_num_array";
}

function emitAllocArray(ctx: EmitContext, expr: HIRExpr & { kind: "alloc_array" }): any {
  const m = ctx.m;
  const prefix = emitArrayPrefix(expr.elementType);
  const newFn = `${prefix}_new`;
  const pushFn = `${prefix}_push`;

  const capacity = Math.max(expr.initialValues.length, 4);
  const newDecl = ctx.getDeclaredFunction(newFn)!;
  const arr = m.buildCall(newDecl.fnType, newDecl.fn, [m.constInt(m.i32, capacity)], "arr");

  if (expr.initialValues.length > 0) {
    const pushDecl = ctx.getDeclaredFunction(pushFn)!;
    for (const valExpr of expr.initialValues) {
      const v = emitExpr(ctx, valExpr);
      m.buildCall(pushDecl.fnType, pushDecl.fn, [arr, v], "");
    }
  }

  return arr;
}

function emitAllocArraySpread(
  ctx: EmitContext,
  expr: HIRExpr & { kind: "alloc_array_spread" },
): any {
  const m = ctx.m;
  const prefix = emitArrayPrefix(expr.elementType);
  const newDecl = ctx.getDeclaredFunction(`${prefix}_new`)!;
  const pushDecl = ctx.getDeclaredFunction(`${prefix}_push`)!;
  const spreadDecl = ctx.getDeclaredFunction(`${prefix}_spread`)!;

  const arr = m.buildCall(newDecl.fnType, newDecl.fn, [m.constInt(m.i32, 4)], "arr");

  for (const el of expr.elements) {
    if (el.spread) {
      const src = emitExpr(ctx, el.value);
      m.buildCall(spreadDecl.fnType, spreadDecl.fn, [arr, src], "");
    } else {
      const v = emitExpr(ctx, el.value);
      m.buildCall(pushDecl.fnType, pushDecl.fn, [arr, v], "");
    }
  }

  return arr;
}

function emitAllocStruct(ctx: EmitContext, expr: HIRExpr & { kind: "alloc_struct" }): any {
  const m = ctx.m;
  const structInfo = ctx.getStructType(expr.structName);
  if (!structInfo) throw new Error(`unknown struct type: ${expr.structName}`);

  const size = m.sizeOf(structInfo.llvmType);
  const malloc = ctx.getDeclaredFunction("malloc")!;
  const raw = m.buildCall(malloc.fnType, malloc.fn, [size], "obj");

  for (let i = 0; i < expr.fields.length; i++) {
    const val = emitExpr(ctx, expr.fields[i]);
    const fieldPtr = m.buildGEP(
      structInfo.llvmType,
      raw,
      [m.constInt(m.i32, 0), m.constInt(m.i32, i)],
      "",
    );
    m.buildStore(val, fieldPtr);
  }

  return raw;
}

function emitFieldGet(ctx: EmitContext, expr: HIRExpr & { kind: "field_get" }): any {
  const m = ctx.m;
  const typeName = (expr.object.type as { kind: "ptr"; pointee: string }).pointee;
  const ifaceInfo = ctx.getInterfaceType(typeName);

  if (ifaceInfo) {
    const fatVal = emitExpr(ctx, expr.object);
    const dataPtr = m.buildExtractValue(fatVal, 0, "data");
    const fieldPtr = m.buildGEP(
      ifaceInfo.layoutType,
      dataPtr,
      [m.constInt(m.i32, 0), m.constInt(m.i32, expr.index)],
      "",
    );
    return m.buildLoad(llvmType(ctx, expr.type), fieldPtr, "");
  }

  const obj = emitExpr(ctx, expr.object);
  const structInfo = ctx.getStructType(typeName);
  if (!structInfo) throw new Error(`unknown struct type: ${typeName}`);

  const fieldPtr = m.buildGEP(
    structInfo.llvmType,
    obj,
    [m.constInt(m.i32, 0), m.constInt(m.i32, expr.index)],
    "",
  );
  return m.buildLoad(llvmType(ctx, expr.type), fieldPtr, "");
}

function emitFieldSet(ctx: EmitContext, expr: HIRExpr & { kind: "field_set" }): any {
  const m = ctx.m;
  const obj = emitExpr(ctx, expr.object);
  const val = emitExpr(ctx, expr.value);
  const className = (expr.object.type as { kind: "ptr"; pointee: string }).pointee;
  const structInfo = ctx.getStructType(className);
  if (!structInfo) throw new Error(`unknown struct type: ${className}`);

  const fieldPtr = m.buildGEP(
    structInfo.llvmType,
    obj,
    [m.constInt(m.i32, 0), m.constInt(m.i32, expr.index)],
    "",
  );
  m.buildStore(val, fieldPtr);
  return val;
}

function emitWrapInterface(ctx: EmitContext, expr: HIRExpr & { kind: "wrap_interface" }): any {
  const m = ctx.m;
  const dataPtr = emitExpr(ctx, expr.value);
  const vtableGlobal = ctx.getVtable(`${expr.className}_${expr.interfaceName}`);
  if (!vtableGlobal) throw new Error(`missing vtable: ${expr.className}_${expr.interfaceName}`);
  const ifaceInfo = ctx.getInterfaceType(expr.interfaceName);
  if (!ifaceInfo) throw new Error(`unknown interface: ${expr.interfaceName}`);

  let fat = m.constNull(ifaceInfo.fatType);
  fat = m.buildInsertValue(fat, dataPtr, 0, "");
  fat = m.buildInsertValue(fat, vtableGlobal, 1, "");
  return fat;
}

function emitVtableCall(ctx: EmitContext, expr: HIRExpr & { kind: "vtable_call" }): any {
  const m = ctx.m;
  const fatVal = emitExpr(ctx, expr.object);
  const dataPtr = m.buildExtractValue(fatVal, 0, "data");
  const vtablePtr = m.buildExtractValue(fatVal, 1, "vtable");

  const ifaceInfo = ctx.getInterfaceType(expr.interfaceName);
  if (!ifaceInfo) throw new Error(`unknown interface: ${expr.interfaceName}`);

  const methodCount = ifaceInfo.iface.methods.length;
  const vtableArrTy = m.arrayType(m.ptr, methodCount);
  const fnPtrPtr = m.buildGEP(
    vtableArrTy,
    vtablePtr,
    [m.constInt(m.i32, 0), m.constInt(m.i32, expr.methodIndex)],
    "",
  );
  const fnPtr = m.buildLoad(m.ptr, fnPtrPtr, "fnptr");

  const methodDef = ifaceInfo.iface.methods[expr.methodIndex];
  const paramTypes = [m.ptr, ...methodDef.params.map((p) => llvmType(ctx, p.type))];
  const retType = llvmType(ctx, expr.returnType);
  const fnType = m.functionType(retType, paramTypes);

  const callArgs = [dataPtr, ...expr.args.map((a) => emitExpr(ctx, a))];
  return m.buildCall(fnType, fnPtr, callArgs, expr.returnType.kind === "void" ? "" : "vcall");
}

function emitIndexGet(ctx: EmitContext, expr: HIRExpr & { kind: "index_get" }): any {
  const m = ctx.m;
  const arr = emitExpr(ctx, expr.array);
  let idx = emitExpr(ctx, expr.index);
  if (expr.index.type.kind === "i64") {
    idx = m.buildTrunc(idx, m.i32, "");
  }
  const elemType =
    expr.array.type.kind === "array" ? (expr.array.type as any).element : { kind: "f64" };
  const storagePrefix = elemType.kind === "i1" ? "cs2_num_array" : emitArrayPrefix(elemType);
  const getFn = `${storagePrefix}_get`;
  const decl = ctx.getDeclaredFunction(getFn)!;
  let result = m.buildCall(decl.fnType, decl.fn, [arr, idx], "");
  if (elemType.kind === "i1") {
    result = m.buildFCmp(LLVMRealONE, result, m.constReal(m.f64, 0.0), "");
  }
  return result;
}

function emitIndexSet(ctx: EmitContext, expr: HIRExpr & { kind: "index_set" }): any {
  const m = ctx.m;
  const arr = emitExpr(ctx, expr.array);
  let idx = emitExpr(ctx, expr.index);
  if (expr.index.type.kind === "i64") {
    idx = m.buildTrunc(idx, m.i32, "");
  }
  let val = emitExpr(ctx, expr.value);
  const elemType =
    expr.array.type.kind === "array" ? (expr.array.type as any).element : { kind: "f64" };
  const storagePrefix = elemType.kind === "i1" ? "cs2_num_array" : emitArrayPrefix(elemType);
  if (elemType.kind === "i1") {
    const ext = m.buildZExt(val, m.i64, "");
    val = m.buildSIToFP(ext, m.f64, "");
  }
  const setFn = `${storagePrefix}_set`;
  const decl = ctx.getDeclaredFunction(setFn)!;
  m.buildCall(decl.fnType, decl.fn, [arr, idx, val], "");
  return val;
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
    case "bit_or":
    case "bit_xor":
    case "shl":
    case "shr":
    case "ushr": {
      const l32 = m.buildTrunc(left, m.i32, "");
      const r32 = m.buildTrunc(right, m.i32, "");
      let res32: any;
      switch (expr.op) {
        case "bit_and":
          res32 = m.buildAnd(l32, r32, "");
          break;
        case "bit_or":
          res32 = m.buildOr(l32, r32, "");
          break;
        case "bit_xor":
          res32 = m.buildXor(l32, r32, "");
          break;
        case "shl":
          res32 = m.buildShl(l32, r32, "");
          break;
        case "shr":
          res32 = m.buildAShr(l32, r32, "");
          break;
        case "ushr":
          res32 = m.buildLShr(l32, r32, "");
          break;
      }
      return m.buildSExt(res32, m.i64, "");
    }
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
    case "typeof": {
      const typeStr =
        expr.operand.type.kind === "f64" || expr.operand.type.kind === "i64"
          ? "number"
          : expr.operand.type.kind === "i8ptr"
            ? "string"
            : expr.operand.type.kind === "i1"
              ? "boolean"
              : expr.operand.type.kind === "ptr"
                ? "object"
                : "undefined";
      return m.buildGlobalStringPtr(typeStr, "typeof_str");
    }
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

  const bridgeFn = ctx.getDeclaredFunction(expr.func);
  if (bridgeFn) {
    const args = expr.args.map((a) => {
      let val = emitExpr(ctx, a);
      if (a.type.kind === "i64") {
        val = m.buildTrunc(val, m.i32, "");
      } else if (a.type.kind === "i1" && expr.func.includes("num_array")) {
        const ext = m.buildZExt(val, m.i64, "");
        val = m.buildSIToFP(ext, m.f64, "");
      }
      return val;
    });
    let result = m.buildCall(bridgeFn.fnType, bridgeFn.fn, args, "");
    if (expr.returnType.kind === "i64") {
      result = m.buildSExt(result, m.i64, "");
    }
    return result;
  }

  return m.constInt(m.i64, 0);
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
    const printNum = ctx.getDeclaredFunction("cs2_print_number")!;
    m.buildCall(printNum.fnType, printNum.fn, [val], "");
    if (nl) {
      const nlStr = m.buildGlobalStringPtr("\n", "nl");
      const printf = ctx.getDeclaredFunction("printf")!;
      m.buildCall(printf.fnType, printf.fn, [nlStr], "");
    }
  } else if (arg.type.kind === "i64") {
    const fmt = m.buildGlobalStringPtr(`%ld${nl}`, "fmt");
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
    const fmtNum = ctx.getDeclaredFunction("cs2_format_number")!;
    m.buildCall(fmtNum.fnType, fmtNum.fn, [buf, val], "");
  } else if (arg.type.kind === "i64") {
    const fmt = m.buildGlobalStringPtr("%ld", "fmt");
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
    if (a.type.kind === "i64") {
      return m.buildSIToFP(val, m.f64, "");
    }
    return val;
  });

  return m.buildCall(intrinsic.fnType, intrinsic.fn, args, "");
}

function emitCapturedLoad(
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

function emitCapturedStore(
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

function emitMakeClosure(ctx: EmitContext, expr: HIRExpr & { kind: "make_closure" }): any {
  const m = ctx.m;
  const closureTy = ctx.getClosureType();

  const fnDecl = ctx.getDeclaredFunction(expr.funcName);
  if (!fnDecl) throw new Error(`undeclared closure function: ${expr.funcName}`);
  const fnPtr = m.buildBitCast(fnDecl.fn, m.ptr, "fn_ptr");

  const envAlloc = ctx.getEnvAlloc();
  const envPtr = envAlloc ? m.buildLoad(m.ptr, envAlloc, "env") : m.constNull(m.ptr);

  const mallocDecl = ctx.getDeclaredFunction("malloc")!;
  const closureSize = m.constInt(m.i64, 16);
  const rawPtr = m.buildCall(mallocDecl.fnType, mallocDecl.fn, [closureSize], "closure_raw");

  const fnSlot = m.buildGEP(m.i8, rawPtr, [m.constInt(m.i64, 0)], "fn_slot");
  m.buildStore(fnPtr, fnSlot);
  const envSlot = m.buildGEP(m.i8, rawPtr, [m.constInt(m.i64, 8)], "env_slot");
  m.buildStore(envPtr, envSlot);

  return rawPtr;
}

function emitCallClosure(ctx: EmitContext, expr: HIRExpr & { kind: "call_closure" }): any {
  const m = ctx.m;
  const closurePtr = emitExpr(ctx, expr.callee);

  const fnSlot = m.buildGEP(m.i8, closurePtr, [m.constInt(m.i64, 0)], "fn_slot");
  const fnPtr = m.buildLoad(m.ptr, fnSlot, "fn_ptr");
  const envSlot = m.buildGEP(m.i8, closurePtr, [m.constInt(m.i64, 8)], "env_slot");
  const envPtr = m.buildLoad(m.ptr, envSlot, "env_ptr");

  const argVals = expr.args.map((a) => emitExpr(ctx, a));
  const allArgs = [envPtr, ...argVals];

  const paramTypes = [m.ptr, ...expr.args.map((a) => llvmType(ctx, a.type))];
  const retType = llvmType(ctx, expr.returnType);
  const fnType = m.functionType(retType, paramTypes);

  return m.buildCall(fnType, fnPtr, allArgs, expr.returnType.kind === "void" ? "" : "");
}
