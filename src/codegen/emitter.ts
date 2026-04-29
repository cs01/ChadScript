import type { HIRModule, HIRFunction, HIRStmt, HIRExpr, HIRType } from "../hir/types.js";
import { LLVMModule, LLVMIntEQ, LLVMIntNE, LLVMRealOEQ, LLVMPrivateLinkage } from "./llvm.js";
import {
  EmitContext,
  CaptureMap,
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

export type { CaptureMap } from "./emit-context.js";

export interface EmitResult {
  objectFile: string;
  irFile?: string;
}

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

function findLocalType(fn: HIRFunction, id: number): HIRType {
  for (const p of fn.params) if (p.id === id) return p.type;
  return findLocalTypeInStmts(fn.body, id) || { kind: "f64" };
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
    ctx.registerStructType(iface.name, fieldLayoutTy, iface.fields);
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

  const pyBoolStrType = m.functionType(m.ptr, [m.i32]);
  const pyBoolStrFn = m.addFunction("cs2_py_bool_str", pyBoolStrType);
  ctx.declareFunction("cs2_py_bool_str", pyBoolStrFn, pyBoolStrType);

  const pyFloatStrType = m.functionType(m.ptr, [m.f64]);
  const pyFloatStrFn = m.addFunction("cs2_py_float_str", pyFloatStrType);
  ctx.declareFunction("cs2_py_float_str", pyFloatStrFn, pyFloatStrType);

  const pySetArgvType = m.functionType(m.voidTy, [m.i32, m.ptr]);
  const pySetArgvFn = m.addFunction("cs2_py_set_argv", pySetArgvType);
  ctx.declareFunction("cs2_py_set_argv", pySetArgvFn, pySetArgvType);

  const pySysArgvType = m.functionType(m.ptr, []);
  const pySysArgvFn = m.addFunction("cs2_py_sys_argv", pySysArgvType);
  ctx.declareFunction("cs2_py_sys_argv", pySysArgvFn, pySysArgvType);

  const pySysExitType = m.functionType(m.voidTy, [m.i64]);
  const pySysExitFn = m.addFunction("cs2_py_sys_exit", pySysExitType);
  ctx.declareFunction("cs2_py_sys_exit", pySysExitFn, pySysExitType);

  const fmtNumType = m.functionType(m.voidTy, [m.ptr, m.f64]);
  const fmtNumFn = m.addFunction("cs2_format_number", fmtNumType);
  ctx.declareFunction("cs2_format_number", fmtNumFn, fmtNumType);

  const randomFns: [string, any, any[]][] = [
    ["cs2_random_random", m.f64, []],
    ["cs2_random_seed", m.voidTy, [m.i64]],
    ["cs2_random_randint", m.i64, [m.i64, m.i64]],
    ["cs2_random_uniform", m.f64, [m.f64, m.f64]],
    ["cs2_random_choice_num", m.f64, [m.ptr]],
    ["cs2_random_choice_str", m.ptr, [m.ptr]],
    ["cs2_random_shuffle_num", m.voidTy, [m.ptr]],
  ];
  for (const [name, ret, params] of randomFns) {
    const ft = m.functionType(ret, params);
    const fn = m.addFunction(name, ft);
    ctx.declareFunction(name, fn, ft);
  }

  const osFns: [string, any, any[]][] = [
    ["cs2_os_getcwd", m.ptr, []],
    ["cs2_os_path_exists", m.i32, [m.ptr]],
    ["cs2_os_path_isfile", m.i32, [m.ptr]],
    ["cs2_os_path_isdir", m.i32, [m.ptr]],
    ["cs2_os_path_join", m.ptr, [m.ptr, m.ptr]],
    ["cs2_os_path_basename", m.ptr, [m.ptr]],
    ["cs2_os_path_dirname", m.ptr, [m.ptr]],
    ["cs2_os_path_abspath", m.ptr, [m.ptr]],
    ["cs2_os_path_splitext_name", m.ptr, [m.ptr]],
    ["cs2_os_path_splitext_ext", m.ptr, [m.ptr]],
    ["cs2_os_listdir", m.ptr, [m.ptr]],
    ["cs2_os_getenv", m.ptr, [m.ptr]],
    ["cs2_os_mkdir", m.i32, [m.ptr]],
    ["cs2_os_remove", m.i32, [m.ptr]],
  ];
  for (const [name, ret, params] of osFns) {
    const ft = m.functionType(ret, params);
    const fn = m.addFunction(name, ft);
    ctx.declareFunction(name, fn, ft);
  }

  const ioFns: [string, any, any[]][] = [
    ["cs2_io_open", m.ptr, [m.ptr, m.ptr]],
    ["cs2_io_close", m.voidTy, [m.ptr]],
    ["cs2_io_read", m.ptr, [m.ptr]],
    ["cs2_io_readline", m.ptr, [m.ptr]],
    ["cs2_io_readlines", m.ptr, [m.ptr]],
    ["cs2_io_write", m.voidTy, [m.ptr, m.ptr]],
    ["cs2_io_write_line", m.voidTy, [m.ptr, m.ptr]],
    ["cs2_io_is_eof", m.i32, [m.ptr]],
    ["cs2_io_tell", m.i64, [m.ptr]],
    ["cs2_io_seek", m.voidTy, [m.ptr, m.i64, m.i32]],
    ["cs2_io_read_n", m.ptr, [m.ptr, m.i64]],
    ["cs2_io_flush", m.voidTy, [m.ptr]],
  ];
  for (const [name, ret, params] of ioFns) {
    const ft = m.functionType(ret, params);
    const fn = m.addFunction(name, ft);
    ctx.declareFunction(name, fn, ft);
  }

  const pyJsonFns: [string, any, any[]][] = [
    ["cs2_py_json_dumps_str_str_map", m.ptr, [m.ptr]],
    ["cs2_py_json_dumps_str_num_map", m.ptr, [m.ptr]],
    ["cs2_py_json_dumps_str_array", m.ptr, [m.ptr]],
    ["cs2_py_json_dumps_num_array", m.ptr, [m.ptr]],
    ["cs2_py_json_loads_str_str_map", m.ptr, [m.ptr]],
    ["cs2_py_json_loads_str_num_map", m.ptr, [m.ptr]],
    ["cs2_py_json_loads_str_array", m.ptr, [m.ptr]],
    ["cs2_py_json_loads_num_array", m.ptr, [m.ptr]],
  ];
  for (const [name, ret, params] of pyJsonFns) {
    const ft = m.functionType(ret, params);
    const fn = m.addFunction(name, ft);
    ctx.declareFunction(name, fn, ft);
  }

  const mathIntrinsics1: [string, string][] = [
    ["llvm.floor.f64", "cs_math_floor"],
    ["llvm.ceil.f64", "cs_math_ceil"],
    ["llvm.fabs.f64", "cs_math_abs"],
    ["llvm.sqrt.f64", "cs_math_sqrt"],
    ["llvm.log.f64", "cs_math_log"],
    ["llvm.round.f64", "cs_math_round"],
    ["llvm.sin.f64", "cs_math_sin"],
    ["llvm.cos.f64", "cs_math_cos"],
    ["llvm.exp.f64", "cs_math_exp"],
    ["llvm.log2.f64", "cs_math_log2"],
    ["llvm.log10.f64", "cs_math_log10"],
    ["llvm.trunc.f64", "cs_math_trunc"],
  ];
  const math1Type = m.functionType(m.f64, [m.f64]);
  for (const [llvmName, csName] of mathIntrinsics1) {
    const fn = m.addFunction(llvmName, math1Type);
    ctx.declareMathIntrinsic(csName, fn, math1Type);
  }

  const libm1: [string, string][] = [
    ["tan", "cs_math_tan"],
    ["asin", "cs_math_asin"],
    ["acos", "cs_math_acos"],
    ["atan", "cs_math_atan"],
    ["cbrt", "cs_math_cbrt"],
  ];
  for (const [libName, csName] of libm1) {
    const fn = m.addFunction(libName, math1Type);
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

  const libm2: [string, string][] = [
    ["atan2", "cs_math_atan2"],
    ["hypot", "cs_math_hypot"],
  ];
  for (const [libName, csName] of libm2) {
    const fn = m.addFunction(libName, math2Type);
    ctx.declareMathIntrinsic(csName, fn, math2Type);
  }

  const ctlzType = m.functionType(m.i32, [m.i32, m.i1]);
  const ctlzFn = m.addFunction("llvm.ctlz.i32", ctlzType);
  ctx.declareMathIntrinsic("cs_math_clz32_intrinsic", ctlzFn, ctlzType);

  const setjmpType = m.functionType(m.i32, [m.ptr]);
  const setjmpFn = m.addFunction("_setjmp", setjmpType);
  ctx.declareFunction("_setjmp", setjmpFn, setjmpType);

  const bridgeFns: [string, any, any[]][] = [
    ["cs2_str_equals", m.i32, [m.ptr, m.ptr]],
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
    ["cs2_str_split", m.ptr, [m.ptr, m.ptr]],
    ["cs2_str_pad_start", m.ptr, [m.ptr, m.i32, m.ptr]],
    ["cs2_str_pad_end", m.ptr, [m.ptr, m.i32, m.ptr]],
    ["cs2_str_trim_start", m.ptr, [m.ptr]],
    ["cs2_str_trim_end", m.ptr, [m.ptr]],
    ["cs2_str_last_index_of", m.f64, [m.ptr, m.ptr]],
    ["cs2_str_at", m.ptr, [m.ptr, m.i32]],
    ["cs2_str_replace_all", m.ptr, [m.ptr, m.ptr, m.ptr]],
    ["cs2_parse_float", m.f64, [m.ptr]],
    ["cs2_parse_int", m.f64, [m.ptr]],
    ["cs2_number_to_string", m.ptr, [m.f64]],
    ["cs2_number_to_fixed", m.ptr, [m.f64, m.f64]],
    ["cs2_number_is_integer", m.i32, [m.f64]],
    ["cs2_number_is_nan", m.i32, [m.f64]],
    ["cs2_number_is_finite", m.i32, [m.f64]],
    ["cs2_date_now", m.f64, []],
    ["cs2_date_new", m.ptr, [m.f64]],
    ["cs2_date_new_now", m.ptr, []],
    ["cs2_date_get_time", m.f64, [m.ptr]],
    ["cs2_date_get_full_year", m.f64, [m.ptr]],
    ["cs2_date_get_month", m.f64, [m.ptr]],
    ["cs2_date_get_date", m.f64, [m.ptr]],
    ["cs2_date_get_hours", m.f64, [m.ptr]],
    ["cs2_date_get_minutes", m.f64, [m.ptr]],
    ["cs2_date_get_seconds", m.f64, [m.ptr]],
    ["cs2_date_get_day", m.f64, [m.ptr]],
    ["cs2_date_to_iso_string", m.ptr, [m.ptr]],
    ["cs2_date_to_string", m.ptr, [m.ptr]],
    ["cs2_date_get_milliseconds", m.f64, [m.ptr]],
    ["cs2_date_get_timezone_offset", m.f64, [m.ptr]],
    ["cs2_date_value_of", m.f64, [m.ptr]],
    ["cs2_date_set_time", m.voidTy, [m.ptr, m.f64]],
    ["cs2_date_set_full_year", m.voidTy, [m.ptr, m.f64]],
    ["cs2_date_set_month", m.voidTy, [m.ptr, m.f64]],
    ["cs2_date_set_date", m.voidTy, [m.ptr, m.f64]],
    ["cs2_date_set_hours", m.voidTy, [m.ptr, m.f64]],
    ["cs2_date_set_minutes", m.voidTy, [m.ptr, m.f64]],
    ["cs2_date_set_seconds", m.voidTy, [m.ptr, m.f64]],
    ["cs2_date_to_date_string", m.ptr, [m.ptr]],
    ["cs2_date_to_time_string", m.ptr, [m.ptr]],
    ["cs2_os_hostname", m.ptr, []],
    ["cs2_os_homedir", m.ptr, []],
    ["cs2_os_tmpdir", m.ptr, []],
    ["cs2_os_platform", m.ptr, []],
    ["cs2_os_arch", m.ptr, []],
    ["cs2_os_type", m.ptr, []],
    ["cs2_os_uptime", m.f64, []],
    ["cs2_math_random", m.f64, []],
    ["cs2_num_array_new", m.ptr, [m.i32]],
    ["cs2_num_array_push", m.voidTy, [m.ptr, m.f64]],
    ["cs2_num_array_pop", m.f64, [m.ptr]],
    ["cs2_num_array_get", m.f64, [m.ptr, m.i32]],
    ["cs2_num_array_at", m.f64, [m.ptr, m.i32]],
    ["cs2_num_array_fill", m.voidTy, [m.ptr, m.f64]],
    ["cs2_num_array_sort_fn", m.voidTy, [m.ptr, m.ptr, m.ptr]],
    ["cs2_num_array_set", m.voidTy, [m.ptr, m.i32, m.f64]],
    ["cs2_num_array_length", m.i32, [m.ptr]],
    ["cs2_num_array_index_of", m.i32, [m.ptr, m.f64]],
    ["cs2_num_array_includes", m.i32, [m.ptr, m.f64]],
    ["cs2_num_array_slice", m.ptr, [m.ptr, m.i32, m.i32]],
    ["cs2_num_array_reverse", m.voidTy, [m.ptr]],
    ["cs2_num_array_sort", m.voidTy, [m.ptr]],
    ["cs2_num_array_sort_by", m.voidTy, [m.ptr, m.ptr, m.ptr]],
    ["cs2_num_array_sum", m.f64, [m.ptr]],
    ["cs2_num_array_min", m.f64, [m.ptr]],
    ["cs2_num_array_max", m.f64, [m.ptr]],
    ["cs2_num_array_any", m.i32, [m.ptr]],
    ["cs2_num_array_all", m.i32, [m.ptr]],
    ["cs2_num_array_copy", m.ptr, [m.ptr]],
    ["cs2_num_array_shift", m.f64, [m.ptr]],
    ["cs2_num_array_unshift", m.voidTy, [m.ptr, m.f64]],
    ["cs2_num_array_splice", m.ptr, [m.ptr, m.i32, m.i32]],
    ["cs2_num_array_concat", m.ptr, [m.ptr, m.ptr]],
    ["cs2_num_array_map", m.ptr, [m.ptr, m.ptr, m.ptr]],
    ["cs2_num_array_filter", m.ptr, [m.ptr, m.ptr, m.ptr]],
    ["cs2_num_array_forEach", m.voidTy, [m.ptr, m.ptr, m.ptr]],
    ["cs2_num_array_find", m.f64, [m.ptr, m.ptr, m.ptr]],
    ["cs2_num_array_findIndex", m.f64, [m.ptr, m.ptr, m.ptr]],
    ["cs2_num_array_every", m.f64, [m.ptr, m.ptr, m.ptr]],
    ["cs2_num_array_some", m.f64, [m.ptr, m.ptr, m.ptr]],
    ["cs2_num_array_reduce", m.f64, [m.ptr, m.ptr, m.ptr, m.f64]],
    ["cs2_print_num_array", m.voidTy, [m.ptr]],
    ["cs2_num_array_join", m.ptr, [m.ptr, m.ptr]],
    ["cs2_num_array_spread", m.voidTy, [m.ptr, m.ptr]],
    ["cs2_str_array_new", m.ptr, [m.i32]],
    ["cs2_str_array_push", m.voidTy, [m.ptr, m.ptr]],
    ["cs2_str_array_pop", m.ptr, [m.ptr]],
    ["cs2_str_array_get", m.ptr, [m.ptr, m.i32]],
    ["cs2_str_array_at", m.ptr, [m.ptr, m.i32]],
    ["cs2_str_array_set", m.voidTy, [m.ptr, m.i32, m.ptr]],
    ["cs2_str_array_length", m.i32, [m.ptr]],
    ["cs2_str_array_index_of", m.i32, [m.ptr, m.ptr]],
    ["cs2_str_array_includes", m.i32, [m.ptr, m.ptr]],
    ["cs2_str_array_slice", m.ptr, [m.ptr, m.i32, m.i32]],
    ["cs2_str_array_reverse", m.voidTy, [m.ptr]],
    ["cs2_str_array_concat", m.ptr, [m.ptr, m.ptr]],
    ["cs2_str_array_shift", m.ptr, [m.ptr]],
    ["cs2_str_array_unshift", m.voidTy, [m.ptr, m.ptr]],
    ["cs2_str_array_map", m.ptr, [m.ptr, m.ptr, m.ptr]],
    ["cs2_str_array_filter", m.ptr, [m.ptr, m.ptr, m.ptr]],
    ["cs2_str_array_forEach", m.voidTy, [m.ptr, m.ptr, m.ptr]],
    ["cs2_str_array_findIndex", m.f64, [m.ptr, m.ptr, m.ptr]],
    ["cs2_str_array_every", m.f64, [m.ptr, m.ptr, m.ptr]],
    ["cs2_str_array_some", m.f64, [m.ptr, m.ptr, m.ptr]],
    ["cs2_str_array_find", m.ptr, [m.ptr, m.ptr, m.ptr]],
    ["cs2_str_array_reduce", m.ptr, [m.ptr, m.ptr, m.ptr, m.ptr]],
    ["cs2_str_array_sort", m.voidTy, [m.ptr]],
    ["cs2_str_array_fill", m.voidTy, [m.ptr, m.ptr]],
    ["cs2_str_array_splice", m.ptr, [m.ptr, m.i32, m.i32]],
    ["cs2_print_str_array", m.voidTy, [m.ptr]],
    ["cs2_str_array_join", m.ptr, [m.ptr, m.ptr]],
    ["cs2_str_array_spread", m.voidTy, [m.ptr, m.ptr]],
    ["cs2_obj_array_new", m.ptr, [m.i32]],
    ["cs2_obj_array_push", m.voidTy, [m.ptr, m.ptr]],
    ["cs2_obj_array_pop", m.ptr, [m.ptr]],
    ["cs2_obj_array_get", m.ptr, [m.ptr, m.i32]],
    ["cs2_obj_array_set", m.voidTy, [m.ptr, m.i32, m.ptr]],
    ["cs2_obj_array_length", m.i32, [m.ptr]],
    ["cs2_obj_array_map", m.ptr, [m.ptr, m.ptr, m.ptr]],
    ["cs2_obj_array_filter", m.ptr, [m.ptr, m.ptr, m.ptr]],
    ["cs2_obj_array_forEach", m.voidTy, [m.ptr, m.ptr, m.ptr]],
    ["cs2_obj_array_find", m.ptr, [m.ptr, m.ptr, m.ptr]],
    ["cs2_obj_array_findIndex", m.f64, [m.ptr, m.ptr, m.ptr]],
    ["cs2_obj_array_every", m.f64, [m.ptr, m.ptr, m.ptr]],
    ["cs2_obj_array_some", m.f64, [m.ptr, m.ptr, m.ptr]],
    ["cs2_try_enter", m.ptr, []],
    ["cs2_try_leave", m.voidTy, []],
    ["cs2_throw", m.voidTy, [m.ptr]],
    ["cs2_catch_msg", m.ptr, []],
    ["nanbox_from_f64", m.i64, [m.f64]],
    ["nanbox_from_i64", m.i64, [m.i64]],
    ["nanbox_from_bool", m.i64, [m.i32]],
    ["nanbox_from_string", m.i64, [m.ptr]],
    ["nanbox_from_ptr", m.i64, [m.ptr]],
    ["nanbox_to_f64", m.f64, [m.i64]],
    ["nanbox_to_i64", m.i64, [m.i64]],
    ["nanbox_to_bool", m.i32, [m.i64]],
    ["nanbox_to_string", m.ptr, [m.i64]],
    ["cs2_boxed_to_string", m.ptr, [m.i64]],
    ["nanbox_to_ptr", m.ptr, [m.i64]],
    ["nanbox_is_number", m.i32, [m.i64]],
    ["nanbox_is_string", m.i32, [m.i64]],
    ["nanbox_is_bool", m.i32, [m.i64]],
    ["nanbox_is_null", m.i32, [m.i64]],
    ["nanbox_is_undefined", m.i32, [m.i64]],
    ["nanbox_is_ptr", m.i32, [m.i64]],
    ["nanbox_typeof", m.ptr, [m.i64]],
    ["nanbox_truthy", m.i32, [m.i64]],
    ["nanbox_add", m.i64, [m.i64, m.i64]],
    ["nanbox_sub", m.i64, [m.i64, m.i64]],
    ["nanbox_mul", m.i64, [m.i64, m.i64]],
    ["nanbox_div", m.i64, [m.i64, m.i64]],
    ["nanbox_rem", m.i64, [m.i64, m.i64]],
    ["nanbox_neg", m.i64, [m.i64]],
    ["nanbox_eq", m.i32, [m.i64, m.i64]],
    ["nanbox_ne", m.i32, [m.i64, m.i64]],
    ["nanbox_lt", m.i32, [m.i64, m.i64]],
    ["nanbox_le", m.i32, [m.i64, m.i64]],
    ["nanbox_gt", m.i32, [m.i64, m.i64]],
    ["nanbox_ge", m.i32, [m.i64, m.i64]],
    ["nanbox_to_string_val", m.i64, [m.i64]],
    ["nanbox_print", m.voidTy, [m.i64]],
    ["nanbox_undefined", m.i64, []],
    ["nanbox_null", m.i64, []],
    ["cs2_promise_new", m.ptr, []],
    ["cs2_promise_resolve_f64", m.voidTy, [m.ptr, m.f64]],
    ["cs2_promise_resolve_i64", m.voidTy, [m.ptr, m.i64]],
    ["cs2_promise_resolve_bool", m.voidTy, [m.ptr, m.i32]],
    ["cs2_promise_resolve_ptr", m.voidTy, [m.ptr, m.ptr]],
    ["cs2_promise_resolve_str", m.voidTy, [m.ptr, m.ptr]],
    ["cs2_promise_resolve_void", m.voidTy, [m.ptr]],
    ["cs2_promise_get_f64", m.f64, [m.ptr]],
    ["cs2_promise_get_i64", m.i64, [m.ptr]],
    ["cs2_promise_get_bool", m.i32, [m.ptr]],
    ["cs2_promise_get_ptr", m.ptr, [m.ptr]],
    ["cs2_promise_get_str", m.ptr, [m.ptr]],
    ["cs2_promise_all_num", m.ptr, [m.ptr]],
    ["cs2_promise_all_str", m.ptr, [m.ptr]],
    ["cs2_promise_race_num", m.ptr, [m.ptr]],
    ["cs2_promise_race_str", m.ptr, [m.ptr]],
    ["cs2_set_timeout", m.ptr, [m.ptr, m.f64]],
    ["cs2_set_interval", m.ptr, [m.ptr, m.f64]],
    ["cs2_clear_timer", m.voidTy, [m.ptr]],
    ["cs2_run_event_loop", m.i32, []],
    ["cs2_json_stringify_f64", m.ptr, [m.f64]],
    ["cs2_json_stringify_i64", m.ptr, [m.i64]],
    ["cs2_json_stringify_str", m.ptr, [m.ptr]],
    ["cs2_json_stringify_bool", m.ptr, [m.i32]],
    ["cs2_json_stringify_null", m.ptr, []],
    ["cs2_json_stringify_boxed", m.ptr, [m.i64]],
    ["cs2_json_stringify_num_array", m.ptr, [m.ptr]],
    ["cs2_json_stringify_str_array", m.ptr, [m.ptr]],
    ["cs2_json_parse", m.i64, [m.ptr]],
    ["cs2_process_init", m.voidTy, [m.i32, m.ptr]],
    ["cs2_process_argv_array", m.ptr, []],
    ["cs2_process_env_get", m.ptr, [m.ptr]],
    ["cs2_process_cwd", m.ptr, []],
    ["cs2_process_platform", m.ptr, []],
    ["cs2_process_exit", m.voidTy, [m.i32]],
    ["cs2_console_time", m.voidTy, [m.ptr]],
    ["cs2_console_time_end", m.voidTy, [m.ptr]],
    ["cs2_stderr_str", m.voidTy, [m.ptr]],
    ["cs2_stderr_str_nl", m.voidTy, [m.ptr]],
    ["cs2_stderr_number", m.voidTy, [m.f64]],
    ["cs2_stderr_i64", m.voidTy, [m.i64]],
    ["cs2_stderr_bool", m.voidTy, [m.i32]],
    ["cs2_stderr_nl", m.voidTy, []],
    ["cs2_stderr_space", m.voidTy, []],
    ["cs2_stderr_boxed", m.voidTy, [m.i64]],
    ["cs2_path_join", m.ptr, [m.ptr, m.ptr]],
    ["cs2_path_resolve", m.ptr, [m.ptr]],
    ["cs2_path_dirname", m.ptr, [m.ptr]],
    ["cs2_path_basename", m.ptr, [m.ptr]],
    ["cs2_path_extname", m.ptr, [m.ptr]],
    ["cs2_fs_read_file_sync", m.ptr, [m.ptr]],
    ["cs2_fs_write_file_sync", m.voidTy, [m.ptr, m.ptr]],
    ["cs2_fs_exists_sync", m.i32, [m.ptr]],
    ["cs2_fs_readdir_sync", m.ptr, [m.ptr]],
    ["cs2_fs_mkdir_sync", m.i32, [m.ptr]],
    ["cs2_fs_unlink_sync", m.voidTy, [m.ptr]],
    ["cs2_fs_stat_is_file", m.i32, [m.ptr]],
    ["cs2_fs_stat_is_directory", m.i32, [m.ptr]],
    ["cs2_exec_sync", m.ptr, [m.ptr]],
    ["cs2_crypto_random_bytes_hex", m.ptr, [m.f64]],
    ["cs2_crypto_hash", m.ptr, [m.ptr, m.ptr, m.ptr]],
    ["cs2_buffer_from_string", m.ptr, [m.ptr, m.ptr]],
    ["cs2_buffer_alloc", m.ptr, [m.f64]],
    ["cs2_buffer_to_string", m.ptr, [m.ptr, m.ptr]],
    ["cs2_buffer_length", m.f64, [m.ptr]],
    ["cs2_buffer_at", m.f64, [m.ptr, m.f64]],
    ["cs2_uint8array_new", m.ptr, [m.f64]],
    ["cs2_uint8array_get", m.f64, [m.ptr, m.f64]],
    ["cs2_uint8array_set", m.voidTy, [m.ptr, m.f64, m.f64]],
    ["cs2_uint8array_length", m.f64, [m.ptr]],
    ["cs2_uint8array_from_num_array", m.ptr, [m.ptr]],
    ["cs2_float64array_new", m.ptr, [m.f64]],
    ["cs2_float64array_get", m.f64, [m.ptr, m.f64]],
    ["cs2_float64array_set", m.voidTy, [m.ptr, m.f64, m.f64]],
    ["cs2_float64array_length", m.f64, [m.ptr]],
    ["cs2_float64array_from_num_array", m.ptr, [m.ptr]],
    ["cs2_str_num_map_new", m.ptr, []],
    ["cs2_str_num_map_set", m.voidTy, [m.ptr, m.ptr, m.f64]],
    ["cs2_str_num_map_get", m.f64, [m.ptr, m.ptr]],
    ["cs2_str_num_map_get_or", m.f64, [m.ptr, m.ptr, m.f64]],
    ["cs2_str_num_map_has", m.i32, [m.ptr, m.ptr]],
    ["cs2_str_num_map_delete", m.i32, [m.ptr, m.ptr]],
    ["cs2_str_num_map_size", m.i32, [m.ptr]],
    ["cs2_str_num_map_keys", m.ptr, [m.ptr]],
    ["cs2_str_num_map_values", m.ptr, [m.ptr]],
    ["cs2_str_num_map_clear", m.voidTy, [m.ptr]],
    ["cs2_str_num_map_copy", m.ptr, [m.ptr]],
    ["cs2_str_num_map_key_at", m.ptr, [m.ptr, m.i32]],
    ["cs2_str_num_map_value_at", m.f64, [m.ptr, m.i32]],
    ["cs2_str_str_map_new", m.ptr, []],
    ["cs2_str_str_map_set", m.voidTy, [m.ptr, m.ptr, m.ptr]],
    ["cs2_str_str_map_get", m.ptr, [m.ptr, m.ptr]],
    ["cs2_str_str_map_get_or", m.ptr, [m.ptr, m.ptr, m.ptr]],
    ["cs2_str_str_map_has", m.i32, [m.ptr, m.ptr]],
    ["cs2_str_str_map_delete", m.i32, [m.ptr, m.ptr]],
    ["cs2_str_str_map_size", m.i32, [m.ptr]],
    ["cs2_str_str_map_keys", m.ptr, [m.ptr]],
    ["cs2_str_str_map_values", m.ptr, [m.ptr]],
    ["cs2_str_str_map_clear", m.voidTy, [m.ptr]],
    ["cs2_str_str_map_copy", m.ptr, [m.ptr]],
    ["cs2_str_str_map_key_at", m.ptr, [m.ptr, m.i32]],
    ["cs2_str_str_map_value_at", m.ptr, [m.ptr, m.i32]],
    ["cs2_num_num_map_new", m.ptr, []],
    ["cs2_num_num_map_set", m.voidTy, [m.ptr, m.f64, m.f64]],
    ["cs2_num_num_map_get", m.f64, [m.ptr, m.f64]],
    ["cs2_num_num_map_has", m.i32, [m.ptr, m.f64]],
    ["cs2_num_num_map_delete", m.i32, [m.ptr, m.f64]],
    ["cs2_num_num_map_size", m.i32, [m.ptr]],
    ["cs2_num_num_map_keys", m.ptr, [m.ptr]],
    ["cs2_num_num_map_values", m.ptr, [m.ptr]],
    ["cs2_num_num_map_clear", m.voidTy, [m.ptr]],
    ["cs2_num_num_map_copy", m.ptr, [m.ptr]],
    ["cs2_num_num_map_key_at", m.f64, [m.ptr, m.i32]],
    ["cs2_num_num_map_value_at", m.f64, [m.ptr, m.i32]],
    ["cs2_num_str_map_new", m.ptr, []],
    ["cs2_num_str_map_set", m.voidTy, [m.ptr, m.f64, m.ptr]],
    ["cs2_num_str_map_get", m.ptr, [m.ptr, m.f64]],
    ["cs2_num_str_map_has", m.i32, [m.ptr, m.f64]],
    ["cs2_num_str_map_delete", m.i32, [m.ptr, m.f64]],
    ["cs2_num_str_map_size", m.i32, [m.ptr]],
    ["cs2_num_str_map_keys", m.ptr, [m.ptr]],
    ["cs2_num_str_map_values", m.ptr, [m.ptr]],
    ["cs2_num_str_map_clear", m.voidTy, [m.ptr]],
    ["cs2_num_str_map_copy", m.ptr, [m.ptr]],
    ["cs2_num_str_map_key_at", m.f64, [m.ptr, m.i32]],
    ["cs2_num_str_map_value_at", m.ptr, [m.ptr, m.i32]],
    ["cs2_str_set_new", m.ptr, []],
    ["cs2_str_set_add", m.voidTy, [m.ptr, m.ptr]],
    ["cs2_str_set_has", m.i32, [m.ptr, m.ptr]],
    ["cs2_str_set_delete", m.i32, [m.ptr, m.ptr]],
    ["cs2_str_set_size", m.i32, [m.ptr]],
    ["cs2_str_set_values", m.ptr, [m.ptr]],
    ["cs2_str_set_clear", m.voidTy, [m.ptr]],
    ["cs2_num_set_new", m.ptr, []],
    ["cs2_num_set_add", m.voidTy, [m.ptr, m.f64]],
    ["cs2_num_set_has", m.i32, [m.ptr, m.f64]],
    ["cs2_num_set_delete", m.i32, [m.ptr, m.f64]],
    ["cs2_num_set_size", m.i32, [m.ptr]],
    ["cs2_num_set_values", m.ptr, [m.ptr]],
    ["cs2_num_set_clear", m.voidTy, [m.ptr]],
    ["cs2_regex_new", m.ptr, [m.ptr, m.ptr]],
    ["cs2_regex_test", m.i32, [m.ptr, m.ptr]],
    ["cs2_regex_exec_match", m.ptr, [m.ptr, m.ptr]],
    ["cs2_string_match", m.ptr, [m.ptr, m.ptr]],
    ["cs2_string_replace_regex", m.ptr, [m.ptr, m.ptr, m.ptr]],
    ["cs2_http_create_server", m.ptr, [m.ptr]],
    ["cs2_http_server_listen", m.voidTy, [m.ptr, m.f64, m.ptr]],
    ["cs2_http_server_close", m.voidTy, [m.ptr]],
    ["cs2_http_res_write_head", m.voidTy, [m.ptr, m.f64, m.ptr]],
    ["cs2_http_res_end", m.voidTy, [m.ptr, m.ptr]],
    ["cs2_http_req_method", m.ptr, [m.ptr]],
    ["cs2_http_req_url", m.ptr, [m.ptr]],
    ["cs2_fetch_sync", m.ptr, [m.ptr]],
    ["cs2_dynobj_new", m.ptr, []],
    ["cs2_dynobj_set_f64", m.voidTy, [m.ptr, m.ptr, m.f64]],
    ["cs2_dynobj_set_str", m.voidTy, [m.ptr, m.ptr, m.ptr]],
    ["cs2_dynobj_set_bool", m.voidTy, [m.ptr, m.ptr, m.i32]],
    ["cs2_dynobj_set_null", m.voidTy, [m.ptr, m.ptr]],
    ["cs2_dynobj_set_obj", m.voidTy, [m.ptr, m.ptr, m.ptr]],
    ["cs2_dynobj_set_arr", m.voidTy, [m.ptr, m.ptr, m.ptr]],
    ["cs2_dynobj_get_f64", m.f64, [m.ptr, m.ptr]],
    ["cs2_dynobj_get_str", m.ptr, [m.ptr, m.ptr]],
    ["cs2_dynobj_get_bool", m.i32, [m.ptr, m.ptr]],
    ["cs2_dynobj_get_obj", m.ptr, [m.ptr, m.ptr]],
    ["cs2_dynobj_get_arr", m.ptr, [m.ptr, m.ptr]],
    ["cs2_dynobj_get_boxed", m.i64, [m.ptr, m.ptr]],
    ["cs2_dynobj_has", m.i32, [m.ptr, m.ptr]],
    ["cs2_dynobj_delete", m.voidTy, [m.ptr, m.ptr]],
    ["cs2_dynobj_tag", m.i32, [m.ptr, m.ptr]],
    ["cs2_dynobj_length", m.i32, [m.ptr]],
    ["cs2_dynarray_new", m.ptr, []],
    ["cs2_dynarray_push_f64", m.voidTy, [m.ptr, m.f64]],
    ["cs2_dynarray_push_str", m.voidTy, [m.ptr, m.ptr]],
    ["cs2_dynarray_push_obj", m.voidTy, [m.ptr, m.ptr]],
    ["cs2_dynarray_push_arr", m.voidTy, [m.ptr, m.ptr]],
    ["cs2_dynarray_push_null", m.voidTy, [m.ptr]],
    ["cs2_dynarray_push_bool", m.voidTy, [m.ptr, m.i32]],
    ["cs2_dynarray_length", m.i32, [m.ptr]],
    ["cs2_dynarray_tag_at", m.i32, [m.ptr, m.i32]],
    ["cs2_dynarray_get_f64", m.f64, [m.ptr, m.i32]],
    ["cs2_dynarray_get_str", m.ptr, [m.ptr, m.i32]],
    ["cs2_dynarray_get_obj", m.ptr, [m.ptr, m.i32]],
    ["cs2_dynarray_get_arr", m.ptr, [m.ptr, m.i32]],
    ["cs2_dynarray_get_bool", m.i32, [m.ptr, m.i32]],
    ["cs2_dynarray_filter", m.ptr, [m.ptr, m.ptr, m.ptr]],
    ["cs2_dynarray_map", m.ptr, [m.ptr, m.ptr, m.ptr]],
    ["cs2_dynarray_forEach", m.voidTy, [m.ptr, m.ptr, m.ptr]],
    ["cs2_dynarray_find", m.ptr, [m.ptr, m.ptr, m.ptr]],
    ["cs2_dynarray_findIndex", m.f64, [m.ptr, m.ptr, m.ptr]],
    ["cs2_dynarray_every", m.f64, [m.ptr, m.ptr, m.ptr]],
    ["cs2_dynarray_some", m.f64, [m.ptr, m.ptr, m.ptr]],
    ["cs2_json_parse_obj", m.ptr, [m.ptr]],
    ["cs2_json_parse_arr", m.ptr, [m.ptr]],
  ];
  for (const [name, ret, params] of bridgeFns) {
    const fnType = m.functionType(ret, params);
    const fn = m.addFunction(name, fnType);
    ctx.declareFunction(name, fn, fnType);
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

  if (!blockTerminates(fn.body)) {
    if (fn.isAsync && fn.returnType.kind === "promise") {
      const promiseAlloc = ctx.getAsyncPromiseAlloc();
      const promiseVal = m.buildLoad(m.ptr, promiseAlloc, "");
      const resolveDecl = ctx.getDeclaredFunction("cs2_promise_resolve_void")!;
      m.buildCall(resolveDecl.fnType, resolveDecl.fn, [promiseVal], "");
      m.buildRet(promiseVal);
    } else if (fn.returnType.kind === "void") {
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

  const argc = m.getParam(mainFn, 0);
  const argv = m.getParam(mainFn, 1);
  const processInit = ctx.getDeclaredFunction("cs2_process_init")!;
  m.buildCall(processInit.fnType, processInit.fn, [argc, argv], "");
  const pySetArgv = ctx.getDeclaredFunction("cs2_py_set_argv");
  if (pySetArgv) m.buildCall(pySetArgv.fnType, pySetArgv.fn, [argc, argv], "");

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

  // call the Python module entry point if it exists
  const pyMain = ctx.getDeclaredFunction("__py_main");
  if (pyMain) m.buildCall(pyMain.fnType, pyMain.fn, [], "");

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
        let val = emitExpr(ctx, stmt.value);
        val = coerceLLVM(ctx, val, stmt.value.type, ctx.currentReturnType);
        m.buildRet(val);
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
      const condRawW = emitExpr(ctx, stmt.condition);
      const condW = ensureI1(ctx, condRawW, stmt.condition.type);
      m.buildCondBr(condW, bodyBlock, exitBlock);

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
        const condRawF = emitExpr(ctx, stmt.condition);
        const condF = ensureI1(ctx, condRawF, stmt.condition.type);
        m.buildCondBr(condF, bodyBlock, exitBlock);
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
