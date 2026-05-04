import type { HIRModule, HIRFunction, HIRStmt, HIRExpr, HIRType } from "../hir/types.js";
import { LLVMModule, LLVMIntEQ, LLVMIntNE, LLVMRealOEQ, LLVMPrivateLinkage, LLVMInternalLinkage } from "./llvm.js";
import {
  EmitContext,
  CaptureMap,
  CaptureEnvEntry,
  llvmType,
  coerceLLVM,
  defaultInit,
  emitCapturedLoad,
  emitCapturedStore,
  blockTerminates,
  stmtTerminates,
  collectLocalIds,
  findLocalTypeInStmts,
} from "./emit-context.js";
import { emitExpr, ensureI1 } from "./emit-expr.js";
import { declareExterns } from "./emit-externs.js";

export type { CaptureMap, CaptureEnvEntry } from "./emit-context.js";

export interface EmitResult {
  objectFile: string;
  irFile?: string;
}

function buildCaptureMap(mod: HIRModule): CaptureMap {
  const result: CaptureMap = new Map();
  const byName = new Map<string, HIRFunction>();
  for (const fn of mod.functions) byName.set(fn.name, fn);

  for (const fn of mod.functions) {
    if (fn.captures.length === 0) continue;
    const outers: HIRFunction[] = [];
    if (fn.parentFn) {
      const direct = byName.get(fn.parentFn);
      if (direct) outers.push(direct);
    } else {
      for (const outerFn of mod.functions) {
        if (outerFn === fn) continue;
        outers.push(outerFn);
      }
    }
    for (const outerFn of outers) {
      const outerIds = new Set<number>();
      collectLocalIds(outerFn.body, outerIds);
      for (const p of outerFn.params) outerIds.add(p.id);

      const overlap = fn.captures.filter((cid) => outerIds.has(cid));
      if (overlap.length > 0) {
        const existing: CaptureEnvEntry[] = result.get(outerFn.name) || [];
        for (const cid of overlap) {
          if (!existing.find((e) => e.id === cid)) {
            const type = findLocalType(outerFn, cid);
            existing.push({ id: cid, type });
          }
        }
        result.set(outerFn.name, existing);
      }
    }
  }

  return result;
}

function findLocalType(fn: HIRFunction, id: number): HIRType {
  for (const p of fn.params) if (p.id === id) return p.type;
  const t = findLocalTypeInStmts(fn.body, id);
  if (!t) throw new Error(`capture type not found for local ${id} in ${fn.name}`);
  return t;
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
    if ("callback" in expr && expr.callback) scanExpr(expr.callback as HIRExpr);
    if ("condition" in expr && expr.condition) scanExpr(expr.condition as HIRExpr);
    if ("then" in expr && expr.then && typeof expr.then === "object" && "kind" in expr.then)
      scanExpr(expr.then as HIRExpr);
    if ("props" in expr && Array.isArray(expr.props))
      for (const p of expr.props as { value: HIRExpr }[]) scanExpr(p.value);
    if ("spreadSource" in expr && expr.spreadSource) scanExpr(expr.spreadSource as HIRExpr);
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

export function emitModule(mod: HIRModule, objectPath: string, irPath: string = ""): void {
  const m = new LLVMModule("chadscript");
  const ctx = new EmitContext(m);

  if (mod.sourceInfo) {
    m.initDebugInfo(mod.sourceInfo.filename, mod.sourceInfo.directory);
  }

  declareExterns(ctx);

  for (const ef of mod.externFns) {
    if (ctx.getDeclaredFunction(ef.name)) continue;
    const paramTypes = ef.params.map((p) => llvmType(ctx, p.type));
    const retType = llvmType(ctx, ef.returnType);
    const fnType = m.functionType(retType, paramTypes, ef.variadic ?? false);
    const fn = m.addFunction(ef.name, fnType);
    ctx.declareFunction(ef.name, fn, fnType);
  }

  for (const iface of mod.interfaces) {
    const fatTy = m.structCreateNamed(`${iface.name}_fat`);
    m.structSetBody(fatTy, [m.ptr, m.ptr]);
    const fieldLayoutTy = m.structCreateNamed(`${iface.name}_layout`);
    const fieldTypes = iface.fields.map((f) => llvmType(ctx, f.type));
    m.structSetBody(fieldLayoutTy, fieldTypes);
    ctx.registerInterfaceType(iface.name, fatTy, iface, fieldLayoutTy);
    ctx.registerStructType(iface.name, fieldLayoutTy, iface.fields);
  }

  for (const cls of mod.classes) {
    const fieldTypes = cls.fields.map((f) => llvmType(ctx, f.type));
    const structTy = m.structCreateNamed(cls.name);
    m.structSetBody(structTy, fieldTypes, false);
    ctx.registerStructType(cls.name, structTy, cls.fields);
  }

  for (const g of mod.globals) {
    const ty = llvmType(ctx, g.type);
    const globalVar = m.addGlobal(`g_${g.name}`, ty);
    m.setInitializer(globalVar, defaultInit(ctx, g.type));
    m.setLinkage(globalVar, LLVMInternalLinkage);
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
    emitFunction(ctx, fn, capturedByOuter, closureFuncs, mod);
  }

  emitMain(ctx, mod);

  m.finalizeDebugInfo();

  if (irPath.length > 0) {
    m.printToFile(irPath);
    m.dispose();
    return;
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


function emitFunction(
  ctx: EmitContext,
  fn: HIRFunction,
  capturedByOuter?: CaptureMap,
  closureFuncs?: Set<string>,
  mod?: HIRModule,
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
      const captureType = findCaptureType(fn, captureId, mod);
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
      const fieldTypes = captureInfo.map((e) => llvmType(ctx, e.type));
      const envStructTy = m.structCreateNamed(`env_${fn.name}`);
      m.structSetBody(envStructTy, fieldTypes);
      const envSize = m.constInt(m.i64, captureInfo.length * 8);
      const mallocDecl = ctx.getDeclaredFunction("malloc")!;
      const rawEnv = m.buildCall(mallocDecl.fnType, mallocDecl.fn, [envSize], "env_raw");
      const envAlloca = m.buildAlloca(m.ptr, "env_ptr");
      m.buildStore(rawEnv, envAlloca);
      ctx.setEnvAlloc(envAlloca);

      for (let i = 0; i < captureInfo.length; i++) {
        const e = captureInfo[i];
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

  if (fn.isAsync && fn.returnType.kind === "promise") {
    const newDecl = ctx.getDeclaredFunction("cs2_promise_new")!;
    const promisePtr = m.buildCall(newDecl.fnType, newDecl.fn, [], "promise");
    const promiseAlloc = m.buildAlloca(m.ptr, "__promise");
    m.buildStore(promisePtr, promiseAlloc);
    ctx.setAsyncPromiseAlloc(promiseAlloc);
  }

  for (const stmt of fn.body) {
    emitStmt(ctx, stmt);
  }

  if (!m.currentBlockHasTerminator()) {
    if (!blockTerminates(fn.body)) {
      if (fn.isAsync && fn.returnType.kind === "promise") {
        const promiseAlloc = ctx.getAsyncPromiseAlloc();
        const promiseVal = m.buildLoad(m.ptr, promiseAlloc, "");
        const resolveDecl = ctx.getDeclaredFunction("cs2_promise_resolve_void")!;
        m.buildCall(resolveDecl.fnType, resolveDecl.fn, [promiseVal], "");
        m.buildRet(promiseVal);
      } else if (fn.returnType.kind === "void") {
        m.buildRetVoid();
      } else {
        m.buildUnreachable();
      }
    } else {
      m.buildUnreachable();
    }
  }
}

function findCaptureType(fn: HIRFunction, captureId: number, mod?: HIRModule): HIRType {
  if (mod && fn.parentFn) {
    const parent = mod.functions.find((f) => f.name === fn.parentFn);
    if (parent) {
      for (const p of parent.params) if (p.id === captureId) return p.type;
      const t = findLocalTypeInStmts(parent.body, captureId);
      if (t) return t;
    }
  }
  const own = findLocalTypeInStmts(fn.body, captureId);
  if (own) return own;
  if (mod) {
    for (const mfn of mod.functions) {
      for (const p of mfn.params) if (p.id === captureId) return p.type;
      const t = findLocalTypeInStmts(mfn.body, captureId);
      if (t) return t;
    }
    for (const cls of mod.classes) {
      for (const meth of cls.methods) {
        for (const p of meth.params) if (p.id === captureId) return p.type;
        const t = findLocalTypeInStmts(meth.body, captureId);
        if (t) return t;
      }
    }
    const initT = findLocalTypeInStmts(mod.init, captureId);
    if (initT) return initT;
  }
  throw new Error(`capture type not found for local ${captureId} in closure ${fn.name}`);
}

function emitMain(ctx: EmitContext, mod: HIRModule): void {
  const m = ctx.m;
  ctx.resetLocalsAndCaptures();

  const mainType = m.functionType(m.i32, [m.i32, m.ptr]);
  const mainFn = m.addFunction("main", mainType);
  ctx.setCurrentFn(mainFn);

  const entry = m.appendBlock(mainFn, "entry");
  m.positionAtEnd(entry);

  const argc = m.getParam(mainFn, 0);
  const argv = m.getParam(mainFn, 1);
  const processInit = ctx.getDeclaredFunction("cs2_process_init")!;
  m.buildCall(processInit.fnType, processInit.fn, [argc, argv], "");

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

  const runLoop = ctx.getDeclaredFunction("cs2_run_event_loop")!;
  m.buildCall(runLoop.fnType, runLoop.fn, [], "");

  m.buildRet(m.constInt(m.i32, 0));
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
      if (ctx.currentReturnType.kind === "promise") {
        const promiseAlloc = ctx.getAsyncPromiseAlloc();
        const promiseVal = m.buildLoad(m.ptr, promiseAlloc, "");
        const inner = (
          ctx.currentReturnType as { kind: "promise"; inner: import("../hir/types.js").HIRType }
        ).inner;
        if (stmt.value && inner.kind !== "void") {
          let val = emitExpr(ctx, stmt.value);
          val = coerceLLVM(ctx, val, stmt.value.type, inner);
          const resolveFn = promiseResolveFn(inner);
          const resolveDecl = ctx.getDeclaredFunction(resolveFn)!;
          if (inner.kind === "i1") {
            val = m.buildZExt(val, m.i32, "");
          }
          m.buildCall(resolveDecl.fnType, resolveDecl.fn, [promiseVal, val], "");
        } else {
          const resolveDecl = ctx.getDeclaredFunction("cs2_promise_resolve_void")!;
          m.buildCall(resolveDecl.fnType, resolveDecl.fn, [promiseVal], "");
        }
        m.buildRet(promiseVal);
      } else if (stmt.value) {
        const val = emitExpr(ctx, stmt.value);
        if (ctx.currentReturnType.kind !== "void") {
          const coerced = coerceLLVM(ctx, val, stmt.value.type, ctx.currentReturnType);
          m.buildRet(coerced);
        } else {
          m.buildRetVoid();
        }
      } else {
        m.buildRetVoid();
      }
      break;
    }
    case "if": {
      const condRaw = emitExpr(ctx, stmt.condition);
      const cond = ensureI1(ctx, condRaw, stmt.condition.type);
      const fn = ctx.getCurrentFn();
      const thenBlock = m.appendBlock(fn, "then");
      const elseBlock = stmt.else ? m.appendBlock(fn, "else") : null;
      const mergeBlock = m.appendBlock(fn, "merge");

      m.buildCondBr(cond, thenBlock, elseBlock || mergeBlock);

      m.positionAtEnd(thenBlock);
      for (const s of stmt.then) emitStmt(ctx, s);
      const thenTerminated = blockTerminates(stmt.then);
      if (!thenTerminated) m.buildBr(mergeBlock);
      else if (!m.currentBlockHasTerminator()) m.buildUnreachable();

      let elseTerminated = false;
      if (stmt.else && elseBlock) {
        m.positionAtEnd(elseBlock);
        for (const s of stmt.else) emitStmt(ctx, s);
        elseTerminated = blockTerminates(stmt.else);
        if (!elseTerminated) m.buildBr(mergeBlock);
        else if (!m.currentBlockHasTerminator()) m.buildUnreachable();
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
      const condRawW = emitExpr(ctx, stmt.condition);
      const condW = ensureI1(ctx, condRawW, stmt.condition.type);
      m.buildCondBr(condW, bodyBlock, exitBlock);

      m.positionAtEnd(bodyBlock);
      for (const s of stmt.body) emitStmt(ctx, s);
      if (!stmtTerminates(stmt.body)) m.buildBr(condBlock);
      else if (!m.currentBlockHasTerminator()) m.buildUnreachable();

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
        const condRawF = emitExpr(ctx, stmt.condition);
        const condF = ensureI1(ctx, condRawF, stmt.condition.type);
        m.buildCondBr(condF, bodyBlock, exitBlock);
      } else {
        m.buildBr(bodyBlock);
      }

      m.positionAtEnd(bodyBlock);
      for (const s of stmt.body) emitStmt(ctx, s);
      if (!stmtTerminates(stmt.body)) m.buildBr(updateBlock);
      else if (!m.currentBlockHasTerminator()) m.buildUnreachable();

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
    } else if (!m.currentBlockHasTerminator()) {
      m.buildUnreachable();
    }
  }

  m.positionAtEnd(exitBlock);
  ctx.popLoop();
}

function promiseResolveFn(inner: import("../hir/types.js").HIRType): string {
  switch (inner.kind) {
    case "f64":
      return "cs2_promise_resolve_f64";
    case "i64":
      return "cs2_promise_resolve_i64";
    case "i1":
      return "cs2_promise_resolve_bool";
    case "i8ptr":
      return "cs2_promise_resolve_str";
    case "ptr":
    case "array":
    case "closure":
    case "promise":
      return "cs2_promise_resolve_ptr";
    case "void":
      return "cs2_promise_resolve_void";
    default:
      throw new Error(`unsupported promise resolve type: ${inner.kind}`);
  }
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
