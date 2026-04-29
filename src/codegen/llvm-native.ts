declare function LLVMContextCreate(): string;
declare function LLVMContextDispose(ctx: string): void;
declare function LLVMModuleCreateWithNameInContext(name: string, ctx: string): string;
declare function LLVMDisposeModule(mod: string): void;
declare function LLVMSetTarget(mod: string, triple: string): void;
declare function LLVMSetModuleDataLayout(mod: string, dl: string): void;
declare function LLVMInt1TypeInContext(ctx: string): string;
declare function LLVMInt8TypeInContext(ctx: string): string;
declare function LLVMInt32TypeInContext(ctx: string): string;
declare function LLVMInt64TypeInContext(ctx: string): string;
declare function LLVMDoubleTypeInContext(ctx: string): string;
declare function LLVMVoidTypeInContext(ctx: string): string;
declare function LLVMStructCreateNamed(ctx: string, name: string): string;
declare function LLVMSizeOf(type: string): string;
declare function LLVMBuildBitCast(b: string, val: string, destTy: string, name: string): string;
declare function LLVMAddFunction(mod: string, name: string, type: string): string;
declare function LLVMAddGlobal(mod: string, type: string, name: string): string;
declare function LLVMSetInitializer(global: string, val: string): void;
declare function LLVMCreateBuilderInContext(ctx: string): string;
declare function LLVMDisposeBuilder(b: string): void;
declare function LLVMPositionBuilderAtEnd(b: string, block: string): void;
declare function LLVMGetInsertBlock(b: string): string;
declare function LLVMGetBasicBlockTerminator(block: string): string;
declare function LLVMConstNull(type: string): string;
declare function LLVMGetUndef(type: string): string;
declare function LLVMBuildAdd(b: string, lhs: string, rhs: string, name: string): string;
declare function LLVMBuildSub(b: string, lhs: string, rhs: string, name: string): string;
declare function LLVMBuildMul(b: string, lhs: string, rhs: string, name: string): string;
declare function LLVMBuildSDiv(b: string, lhs: string, rhs: string, name: string): string;
declare function LLVMBuildSRem(b: string, lhs: string, rhs: string, name: string): string;
declare function LLVMBuildFAdd(b: string, lhs: string, rhs: string, name: string): string;
declare function LLVMBuildFSub(b: string, lhs: string, rhs: string, name: string): string;
declare function LLVMBuildFMul(b: string, lhs: string, rhs: string, name: string): string;
declare function LLVMBuildFDiv(b: string, lhs: string, rhs: string, name: string): string;
declare function LLVMBuildFRem(b: string, lhs: string, rhs: string, name: string): string;
declare function LLVMBuildAnd(b: string, lhs: string, rhs: string, name: string): string;
declare function LLVMBuildOr(b: string, lhs: string, rhs: string, name: string): string;
declare function LLVMBuildXor(b: string, lhs: string, rhs: string, name: string): string;
declare function LLVMBuildShl(b: string, lhs: string, rhs: string, name: string): string;
declare function LLVMBuildAShr(b: string, lhs: string, rhs: string, name: string): string;
declare function LLVMBuildLShr(b: string, lhs: string, rhs: string, name: string): string;
declare function LLVMBuildNeg(b: string, val: string, name: string): string;
declare function LLVMBuildFNeg(b: string, val: string, name: string): string;
declare function LLVMBuildNot(b: string, val: string, name: string): string;
declare function LLVMBuildAlloca(b: string, type: string, name: string): string;
declare function LLVMBuildLoad2(b: string, type: string, ptr: string, name: string): string;
declare function LLVMBuildStore(b: string, val: string, ptr: string): string;
declare function LLVMBuildGlobalStringPtr(b: string, str: string, name: string): string;
declare function LLVMBuildBr(b: string, dest: string): string;
declare function LLVMBuildCondBr(b: string, cond: string, then: string, els: string): string;
declare function LLVMBuildRet(b: string, val: string): string;
declare function LLVMBuildRetVoid(b: string): string;
declare function LLVMBuildUnreachable(b: string): string;
declare function LLVMBuildSelect(b: string, cond: string, then: string, els: string, name: string): string;
declare function LLVMBuildPhi(b: string, type: string, name: string): string;
declare function LLVMBuildTrunc(b: string, val: string, destTy: string, name: string): string;
declare function LLVMBuildZExt(b: string, val: string, destTy: string, name: string): string;
declare function LLVMBuildSExt(b: string, val: string, destTy: string, name: string): string;
declare function LLVMBuildFPToSI(b: string, val: string, destTy: string, name: string): string;
declare function LLVMBuildSIToFP(b: string, val: string, destTy: string, name: string): string;
declare function LLVMValueAsMetadata(val: string): string;
declare function LLVMSetSubprogram(fn: string, sp: string): void;
declare function LLVMSetCurrentDebugLocation2(b: string, loc: string): void;
declare function LLVMDIBuilderFinalize(builder: string): void;
declare function LLVMDisposeDIBuilder(builder: string): void;
declare function LLVMCreateDIBuilder(mod: string): string;
declare function LLVMDisposeMessage(msg: string): void;
declare function LLVMGetDefaultTargetTriple(): string;
declare function LLVMCreateTargetMachine(target: string, triple: string, cpu: string, features: string, optLevel: number, reloc: number, codeModel: number): string;
declare function LLVMCreateTargetDataLayout(tm: string): string;
declare function LLVMDisposeTargetMachine(tm: string): void;
declare function LLVMDisposeTargetData(dl: string): void;
declare function LLVMInitializeAArch64TargetInfo(): void;
declare function LLVMInitializeAArch64Target(): void;
declare function LLVMInitializeAArch64TargetMC(): void;
declare function LLVMInitializeAArch64AsmPrinter(): void;
declare function LLVMInitializeX86TargetInfo(): void;
declare function LLVMInitializeX86Target(): void;
declare function LLVMInitializeX86TargetMC(): void;
declare function LLVMInitializeX86AsmPrinter(): void;

declare function chad2_LLVMPointerTypeInContext(ctx: string, addrSpace: number): string;
declare function chad2_LLVMGetParam(fn: string, index: number): string;
declare function chad2_LLVMAppendBasicBlockInContext(ctx: string, fn: string, name: string): string;
declare function chad2_LLVMSetLinkage(val: string, linkage: number): void;
declare function chad2_LLVMBuildICmp(b: string, op: number, lhs: string, rhs: string, name: string): string;
declare function chad2_LLVMBuildFCmp(b: string, op: number, lhs: string, rhs: string, name: string): string;
declare function chad2_LLVMBuildExtractValue(b: string, agg: string, idx: number, name: string): string;
declare function chad2_LLVMBuildInsertValue(b: string, agg: string, elt: string, idx: number, name: string): string;
declare function chad2_LLVMConstInt(type: string, hi32: number, lo32: number, signExtend: number): string;
declare function chad2_LLVMConstReal(type: string, val: number): string;
declare function chad2_LLVMArrayType2(elemType: string, count: number): string;
declare function chad2_LLVMFunctionType(ret: string, params: string, numParams: number, isVarArg: number): string;
declare function chad2_LLVMStructSetBody(type: string, elems: string, count: number, packed: number): void;
declare function chad2_LLVMConstArray2(elemType: string, vals: string, count: number): string;
declare function chad2_LLVMConstNamedStruct(type: string, vals: string, count: number): string;
declare function chad2_LLVMBuildCall2(b: string, fnType: string, fn: string, args: string, numArgs: number, name: string): string;
declare function chad2_LLVMAddIncoming(phi: string, vals: string, blocks: string, count: number): void;
declare function chad2_LLVMBuildInBoundsGEP2(b: string, type: string, ptr: string, indices: string, numIndices: number, name: string): string;
declare function chad2_LLVMGetEnumAttributeKindForName(name: string): number;
declare function chad2_LLVMCreateEnumAttribute(ctx: string, kind: number, val: number): string;
declare function chad2_LLVMAddAttributeAtIndex(fn: string, idx: number, attr: string): void;
declare function chad2_LLVMAddModuleFlag(mod: string, behavior: number, key: string, valI: number, metadata: string): void;
declare function chad2_LLVMDIBuilderCreateFile(builder: string, filename: string, directory: string): string;
declare function chad2_LLVMDIBuilderCreateCompileUnit(builder: string, lang: number, file: string, producer: string, isOptimized: number, runtimeVer: number): string;
declare function chad2_LLVMDIBuilderCreateSubroutineType(builder: string, file: string, paramTypes: string, numParams: number): string;
declare function chad2_LLVMDIBuilderCreateFunction(builder: string, scope: string, name: string, linkage: string, file: string, lineno: number, type: string, isLocal: number, isDefinition: number, scopeLine: number): string;
declare function chad2_LLVMMDStringInContext2(ctx: string, str: string): string;
declare function chad2_LLVMDIBuilderCreateDebugLocation(ctx: string, line: number, col: number, scope: string, inlinedAt: string): string;
declare function chad2_LLVMGetTargetFromTriple(triple: string): string;
declare function chad2_LLVMPrintModuleToFile(mod: string, filename: string): number;
declare function chad2_LLVMTargetMachineEmitToFile(tm: string, mod: string, filename: string, type: number): number;
declare function cs2_str_array_data(arr: string[]): string;

export const LLVMIntEQ = 32;
export const LLVMIntNE = 33;
export const LLVMIntSLT = 40;
export const LLVMIntSLE = 41;
export const LLVMIntSGT = 38;
export const LLVMIntSGE = 39;
export const LLVMRealOEQ = 1;
export const LLVMRealONE = 6;
export const LLVMRealOLT = 4;
export const LLVMRealOLE = 5;
export const LLVMRealOGT = 2;
export const LLVMRealOGE = 3;
export const LLVMRealORD = 7;
export const LLVMRealUNO = 8;
export const LLVMPrivateLinkage = 8;
export const LLVMCodeGenLevelNone = 0;
export const LLVMCodeGenLevelDefault = 2;
export const LLVMRelocPIC = 1;
export const LLVMCodeModelDefault = 0;
export const LLVMObjectFileType = 1;

let _initialized = false;

function initTargets(): void {
  if (_initialized) return;
  LLVMInitializeAArch64TargetInfo();
  LLVMInitializeAArch64Target();
  LLVMInitializeAArch64TargetMC();
  LLVMInitializeAArch64AsmPrinter();
  LLVMInitializeX86TargetInfo();
  LLVMInitializeX86Target();
  LLVMInitializeX86TargetMC();
  LLVMInitializeX86AsmPrinter();
  _initialized = true;
}

function refArrayData(arr: string[]): string {
  if (arr.length === 0) return "";
  return cs2_str_array_data(arr);
}

export class LLVMModule {
  readonly ctx: string;
  readonly mod: string;
  readonly builder: string;
  readonly i1: string;
  readonly i8: string;
  readonly i32: string;
  readonly i64: string;
  readonly f64: string;
  readonly voidTy: string;
  readonly ptr: string;
  private functions: Map<string, string>;
  private globals: Map<string, string>;

  constructor(name: string) {
    initTargets();
    this.ctx = LLVMContextCreate();
    this.mod = LLVMModuleCreateWithNameInContext(name, this.ctx);
    this.builder = LLVMCreateBuilderInContext(this.ctx);
    this.i1 = LLVMInt1TypeInContext(this.ctx);
    this.i8 = LLVMInt8TypeInContext(this.ctx);
    this.i32 = LLVMInt32TypeInContext(this.ctx);
    this.i64 = LLVMInt64TypeInContext(this.ctx);
    this.f64 = LLVMDoubleTypeInContext(this.ctx);
    this.voidTy = LLVMVoidTypeInContext(this.ctx);
    this.ptr = chad2_LLVMPointerTypeInContext(this.ctx, 0);
    this.functions = new Map<string, string>();
    this.globals = new Map<string, string>();
    const triple = LLVMGetDefaultTargetTriple();
    LLVMSetTarget(this.mod, triple);
  }

  dispose(): void {
    LLVMDisposeBuilder(this.builder);
    LLVMDisposeModule(this.mod);
    LLVMContextDispose(this.ctx);
  }

  functionType(ret: string, params: string[], isVarArg: boolean): string {
    const data = refArrayData(params);
    return chad2_LLVMFunctionType(ret, data, params.length, isVarArg ? 1 : 0);
  }

  addFunction(name: string, type: string): string {
    const fn = LLVMAddFunction(this.mod, name, type);
    this.functions.set(name, fn);
    return fn;
  }

  getFunction(name: string): string {
    return this.functions.get(name)!;
  }

  getParam(fn: string, index: number): string {
    return chad2_LLVMGetParam(fn, index);
  }

  addGlobal(name: string, type: string): string {
    const g = LLVMAddGlobal(this.mod, type, name);
    this.globals.set(name, g);
    return g;
  }

  getGlobal(name: string): string {
    return this.globals.get(name)!;
  }

  setInitializer(global: string, value: string): void {
    LLVMSetInitializer(global, value);
  }

  setLinkage(value: string, linkage: number): void {
    chad2_LLVMSetLinkage(value, linkage);
  }

  appendBlock(fn: string, name: string): string {
    return chad2_LLVMAppendBasicBlockInContext(this.ctx, fn, name);
  }

  positionAtEnd(block: string): void {
    LLVMPositionBuilderAtEnd(this.builder, block);
  }

  getInsertBlock(): string {
    return LLVMGetInsertBlock(this.builder);
  }

  currentBlockHasTerminator(): boolean {
    const block = LLVMGetInsertBlock(this.builder);
    if (block === "") return false;
    const term = LLVMGetBasicBlockTerminator(block);
    return term !== "";
  }

  constInt(type: string, val: number, signExtend: boolean): string {
    const hi32 = Math.floor(val / 0x100000000);
    const lo32 = val >>> 0;
    return chad2_LLVMConstInt(type, hi32, lo32, signExtend ? 1 : 0);
  }

  constBigInt(type: string, hexStr: string): string {
    const full = hexStr.length <= 8 ? hexStr : hexStr.slice(0, hexStr.length - 8);
    const lo = hexStr.length <= 8 ? hexStr : hexStr.slice(hexStr.length - 8);
    const hi32 = parseInt(full, 16);
    const lo32 = parseInt(lo, 16);
    return chad2_LLVMConstInt(type, hi32, lo32, 0);
  }

  constReal(type: string, val: number): string {
    return chad2_LLVMConstReal(type, val);
  }

  constNull(type: string): string {
    return LLVMConstNull(type);
  }

  getUndef(type: string): string {
    return LLVMGetUndef(type);
  }

  constArray(elemType: string, values: string[]): string {
    const data = refArrayData(values);
    return chad2_LLVMConstArray2(elemType, data, values.length);
  }

  constNamedStruct(structTy: string, values: string[]): string {
    const data = refArrayData(values);
    return chad2_LLVMConstNamedStruct(structTy, data, values.length);
  }

  arrayType(elemType: string, count: number): string {
    return chad2_LLVMArrayType2(elemType, count);
  }

  structCreateNamed(name: string): string {
    return LLVMStructCreateNamed(this.ctx, name);
  }

  structSetBody(structTy: string, elementTypes: string[], packed: boolean): void {
    const data = refArrayData(elementTypes);
    chad2_LLVMStructSetBody(structTy, data, elementTypes.length, packed ? 1 : 0);
  }

  sizeOf(type: string): string {
    return LLVMSizeOf(type);
  }

  buildBitCast(val: string, destTy: string, name: string): string {
    return LLVMBuildBitCast(this.builder, val, destTy, name);
  }

  buildAdd(lhs: string, rhs: string, name: string): string { return LLVMBuildAdd(this.builder, lhs, rhs, name); }
  buildSub(lhs: string, rhs: string, name: string): string { return LLVMBuildSub(this.builder, lhs, rhs, name); }
  buildMul(lhs: string, rhs: string, name: string): string { return LLVMBuildMul(this.builder, lhs, rhs, name); }
  buildSDiv(lhs: string, rhs: string, name: string): string { return LLVMBuildSDiv(this.builder, lhs, rhs, name); }
  buildSRem(lhs: string, rhs: string, name: string): string { return LLVMBuildSRem(this.builder, lhs, rhs, name); }
  buildFAdd(lhs: string, rhs: string, name: string): string { return LLVMBuildFAdd(this.builder, lhs, rhs, name); }
  buildFSub(lhs: string, rhs: string, name: string): string { return LLVMBuildFSub(this.builder, lhs, rhs, name); }
  buildFMul(lhs: string, rhs: string, name: string): string { return LLVMBuildFMul(this.builder, lhs, rhs, name); }
  buildFDiv(lhs: string, rhs: string, name: string): string { return LLVMBuildFDiv(this.builder, lhs, rhs, name); }
  buildFRem(lhs: string, rhs: string, name: string): string { return LLVMBuildFRem(this.builder, lhs, rhs, name); }
  buildAnd(lhs: string, rhs: string, name: string): string { return LLVMBuildAnd(this.builder, lhs, rhs, name); }
  buildOr(lhs: string, rhs: string, name: string): string { return LLVMBuildOr(this.builder, lhs, rhs, name); }
  buildXor(lhs: string, rhs: string, name: string): string { return LLVMBuildXor(this.builder, lhs, rhs, name); }
  buildShl(lhs: string, rhs: string, name: string): string { return LLVMBuildShl(this.builder, lhs, rhs, name); }
  buildAShr(lhs: string, rhs: string, name: string): string { return LLVMBuildAShr(this.builder, lhs, rhs, name); }
  buildLShr(lhs: string, rhs: string, name: string): string { return LLVMBuildLShr(this.builder, lhs, rhs, name); }
  buildNeg(val: string, name: string): string { return LLVMBuildNeg(this.builder, val, name); }
  buildFNeg(val: string, name: string): string { return LLVMBuildFNeg(this.builder, val, name); }
  buildNot(val: string, name: string): string { return LLVMBuildNot(this.builder, val, name); }
  buildAlloca(type: string, name: string): string { return LLVMBuildAlloca(this.builder, type, name); }
  buildLoad(type: string, ptr: string, name: string): string { return LLVMBuildLoad2(this.builder, type, ptr, name); }
  buildStore(val: string, ptr: string): string { return LLVMBuildStore(this.builder, val, ptr); }
  buildBr(dest: string): string { return LLVMBuildBr(this.builder, dest); }
  buildCondBr(cond: string, then: string, els: string): string { return LLVMBuildCondBr(this.builder, cond, then, els); }
  buildRet(val: string): string { return LLVMBuildRet(this.builder, val); }
  buildRetVoid(): string { return LLVMBuildRetVoid(this.builder); }
  buildUnreachable(): string { return LLVMBuildUnreachable(this.builder); }
  buildSelect(cond: string, then: string, els: string, name: string): string { return LLVMBuildSelect(this.builder, cond, then, els, name); }
  buildPhi(type: string, name: string): string { return LLVMBuildPhi(this.builder, type, name); }
  buildTrunc(val: string, destTy: string, name: string): string { return LLVMBuildTrunc(this.builder, val, destTy, name); }
  buildZExt(val: string, destTy: string, name: string): string { return LLVMBuildZExt(this.builder, val, destTy, name); }
  buildSExt(val: string, destTy: string, name: string): string { return LLVMBuildSExt(this.builder, val, destTy, name); }
  buildFPToSI(val: string, destTy: string, name: string): string { return LLVMBuildFPToSI(this.builder, val, destTy, name); }
  buildSIToFP(val: string, destTy: string, name: string): string { return LLVMBuildSIToFP(this.builder, val, destTy, name); }

  buildICmp(pred: number, lhs: string, rhs: string, name: string): string {
    return chad2_LLVMBuildICmp(this.builder, pred, lhs, rhs, name);
  }

  buildFCmp(pred: number, lhs: string, rhs: string, name: string): string {
    return chad2_LLVMBuildFCmp(this.builder, pred, lhs, rhs, name);
  }

  buildExtractValue(agg: string, index: number, name: string): string {
    return chad2_LLVMBuildExtractValue(this.builder, agg, index, name);
  }

  buildInsertValue(agg: string, val: string, index: number, name: string): string {
    return chad2_LLVMBuildInsertValue(this.builder, agg, val, index, name);
  }

  buildGEP(type: string, ptr: string, indices: string[], name: string): string {
    const data = refArrayData(indices);
    return chad2_LLVMBuildInBoundsGEP2(this.builder, type, ptr, data, indices.length, name);
  }

  buildGlobalStringPtr(str: string, name: string): string {
    return LLVMBuildGlobalStringPtr(this.builder, str, name);
  }

  buildCall(fnType: string, fn: string, args: string[], name: string): string {
    const data = refArrayData(args);
    return chad2_LLVMBuildCall2(this.builder, fnType, fn, data, args.length, name);
  }

  addIncoming(phi: string, values: string[], blocks: string[]): void {
    const vdata = refArrayData(values);
    const bdata = refArrayData(blocks);
    chad2_LLVMAddIncoming(phi, vdata, bdata, values.length);
  }

  addEnumAttr(fn: string, name: string): void {
    const kind = chad2_LLVMGetEnumAttributeKindForName(name);
    const attr = chad2_LLVMCreateEnumAttribute(this.ctx, kind, 0);
    chad2_LLVMAddAttributeAtIndex(fn, 4294967295, attr);
  }

  printToFile(path: string): void {
    if (chad2_LLVMPrintModuleToFile(this.mod, path) !== 0) {
      throw new Error("Failed to print LLVM module to file");
    }
  }

  private diBuilder: string;
  private diFile: string;
  private diCU: string;

  initDebugInfo(filename: string, directory: string): void {
    this.diBuilder = LLVMCreateDIBuilder(this.mod);
    this.diFile = chad2_LLVMDIBuilderCreateFile(this.diBuilder, filename, directory);
    this.diCU = chad2_LLVMDIBuilderCreateCompileUnit(this.diBuilder, 1, this.diFile, "chadscript", 0, 0);
    const dwarfMeta = LLVMValueAsMetadata(this.constInt(this.i32, 4, false));
    const diVerMeta = LLVMValueAsMetadata(this.constInt(this.i32, 3, false));
    chad2_LLVMAddModuleFlag(this.mod, 2, "Dwarf Version", 0, dwarfMeta);
    chad2_LLVMAddModuleFlag(this.mod, 1, "Debug Info Version", 0, diVerMeta);
  }

  createDebugFunction(fn: string, name: string, line: number): string {
    if (this.diBuilder === "") return "";
    const emptyArr: string[] = [];
    const subTy = chad2_LLVMDIBuilderCreateSubroutineType(this.diBuilder, this.diFile, refArrayData(emptyArr), 0);
    const sp = chad2_LLVMDIBuilderCreateFunction(this.diBuilder, this.diFile, name, name, this.diFile, line, subTy, 0, 1, line);
    LLVMSetSubprogram(fn, sp);
    return sp;
  }

  setDebugLocation(line: number, col: number, scope: string): void {
    if (this.diBuilder === "" || scope === "") return;
    const loc = chad2_LLVMDIBuilderCreateDebugLocation(this.ctx, line, col, scope, "");
    LLVMSetCurrentDebugLocation2(this.builder, loc);
  }

  clearDebugLocation(): void {
    LLVMSetCurrentDebugLocation2(this.builder, "");
  }

  finalizeDebugInfo(): void {
    if (this.diBuilder !== "") {
      LLVMDIBuilderFinalize(this.diBuilder);
    }
  }

  emitObjectFile(path: string): void {
    const triple = LLVMGetDefaultTargetTriple();
    const target = chad2_LLVMGetTargetFromTriple(triple);
    if (target === "") throw new Error("Failed to get target from triple");

    const tm = LLVMCreateTargetMachine(target, triple, "generic", "",
      LLVMCodeGenLevelDefault, LLVMRelocPIC, LLVMCodeModelDefault);
    const dl = LLVMCreateTargetDataLayout(tm);
    LLVMSetModuleDataLayout(this.mod, dl);

    if (chad2_LLVMTargetMachineEmitToFile(tm, this.mod, path, LLVMObjectFileType) !== 0) {
      throw new Error("Failed to emit object file");
    }

    LLVMDisposeTargetData(dl);
    LLVMDisposeTargetMachine(tm);
  }
}
