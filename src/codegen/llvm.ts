import koffi from "koffi";

const LLVM_PATH = "/opt/homebrew/opt/llvm/lib/libLLVM.dylib";

const lib = koffi.load(LLVM_PATH);

const Ref = "void *";
const RefArr = "void **";
const Bool = "int";

const LLVMContextCreate = lib.func("LLVMContextCreate", Ref, []);
const LLVMContextDispose = lib.func("LLVMContextDispose", "void", [Ref]);
const LLVMModuleCreateWithNameInContext = lib.func("LLVMModuleCreateWithNameInContext", Ref, [
  "str",
  Ref,
]);
const LLVMDisposeModule = lib.func("LLVMDisposeModule", "void", [Ref]);
const LLVMSetTarget = lib.func("LLVMSetTarget", "void", [Ref, "str"]);
const LLVMSetModuleDataLayout = lib.func("LLVMSetModuleDataLayout", "void", [Ref, Ref]);

const LLVMInt1TypeInContext = lib.func("LLVMInt1TypeInContext", Ref, [Ref]);
const LLVMInt8TypeInContext = lib.func("LLVMInt8TypeInContext", Ref, [Ref]);
const LLVMInt32TypeInContext = lib.func("LLVMInt32TypeInContext", Ref, [Ref]);
const LLVMInt64TypeInContext = lib.func("LLVMInt64TypeInContext", Ref, [Ref]);
const LLVMDoubleTypeInContext = lib.func("LLVMDoubleTypeInContext", Ref, [Ref]);
const LLVMVoidTypeInContext = lib.func("LLVMVoidTypeInContext", Ref, [Ref]);
const LLVMPointerTypeInContext = lib.func("LLVMPointerTypeInContext", Ref, [Ref, "uint"]);
const LLVMStructCreateNamed = lib.func("LLVMStructCreateNamed", Ref, [Ref, "str"]);
const LLVMStructSetBody = lib.func("LLVMStructSetBody", "void", [Ref, RefArr, "uint", Bool]);
const LLVMSizeOf = lib.func("LLVMSizeOf", Ref, [Ref]);
const LLVMBuildBitCast = lib.func("LLVMBuildBitCast", Ref, [Ref, Ref, Ref, "str"]);

const LLVMFunctionType = lib.func("LLVMFunctionType", Ref, [Ref, RefArr, "uint", Bool]);

const LLVMAddFunction = lib.func("LLVMAddFunction", Ref, [Ref, "str", Ref]);
const LLVMGetParam = lib.func("LLVMGetParam", Ref, [Ref, "uint"]);

const LLVMAddGlobal = lib.func("LLVMAddGlobal", Ref, [Ref, Ref, "str"]);
const LLVMSetInitializer = lib.func("LLVMSetInitializer", "void", [Ref, Ref]);
const LLVMSetLinkage = lib.func("LLVMSetLinkage", "void", [Ref, "int"]);

const LLVMAppendBasicBlockInContext = lib.func("LLVMAppendBasicBlockInContext", Ref, [
  Ref,
  Ref,
  "str",
]);

const LLVMCreateBuilderInContext = lib.func("LLVMCreateBuilderInContext", Ref, [Ref]);
const LLVMDisposeBuilder = lib.func("LLVMDisposeBuilder", "void", [Ref]);
const LLVMPositionBuilderAtEnd = lib.func("LLVMPositionBuilderAtEnd", "void", [Ref, Ref]);
const LLVMGetInsertBlock = lib.func("LLVMGetInsertBlock", Ref, [Ref]);
const LLVMGetBasicBlockTerminator = lib.func("LLVMGetBasicBlockTerminator", Ref, [Ref]);

const LLVMConstInt = lib.func("LLVMConstInt", Ref, [Ref, "uint64", Bool]);
const LLVMConstReal = lib.func("LLVMConstReal", Ref, [Ref, "double"]);
const LLVMConstNull = lib.func("LLVMConstNull", Ref, [Ref]);
const LLVMGetUndef = lib.func("LLVMGetUndef", Ref, [Ref]);
const LLVMConstArray2 = lib.func("LLVMConstArray2", Ref, [Ref, RefArr, "uint64"]);
const LLVMConstNamedStruct = lib.func("LLVMConstNamedStruct", Ref, [Ref, RefArr, "uint"]);
const LLVMArrayType2 = lib.func("LLVMArrayType2", Ref, [Ref, "uint64"]);

const LLVMBuildAdd = lib.func("LLVMBuildAdd", Ref, [Ref, Ref, Ref, "str"]);
const LLVMBuildSub = lib.func("LLVMBuildSub", Ref, [Ref, Ref, Ref, "str"]);
const LLVMBuildMul = lib.func("LLVMBuildMul", Ref, [Ref, Ref, Ref, "str"]);
const LLVMBuildSDiv = lib.func("LLVMBuildSDiv", Ref, [Ref, Ref, Ref, "str"]);
const LLVMBuildSRem = lib.func("LLVMBuildSRem", Ref, [Ref, Ref, Ref, "str"]);
const LLVMBuildFAdd = lib.func("LLVMBuildFAdd", Ref, [Ref, Ref, Ref, "str"]);
const LLVMBuildFSub = lib.func("LLVMBuildFSub", Ref, [Ref, Ref, Ref, "str"]);
const LLVMBuildFMul = lib.func("LLVMBuildFMul", Ref, [Ref, Ref, Ref, "str"]);
const LLVMBuildFDiv = lib.func("LLVMBuildFDiv", Ref, [Ref, Ref, Ref, "str"]);
const LLVMBuildFRem = lib.func("LLVMBuildFRem", Ref, [Ref, Ref, Ref, "str"]);

const LLVMBuildICmp = lib.func("LLVMBuildICmp", Ref, [Ref, "int", Ref, Ref, "str"]);
const LLVMBuildFCmp = lib.func("LLVMBuildFCmp", Ref, [Ref, "int", Ref, Ref, "str"]);

const LLVMBuildAnd = lib.func("LLVMBuildAnd", Ref, [Ref, Ref, Ref, "str"]);
const LLVMBuildOr = lib.func("LLVMBuildOr", Ref, [Ref, Ref, Ref, "str"]);
const LLVMBuildXor = lib.func("LLVMBuildXor", Ref, [Ref, Ref, Ref, "str"]);
const LLVMBuildShl = lib.func("LLVMBuildShl", Ref, [Ref, Ref, Ref, "str"]);
const LLVMBuildAShr = lib.func("LLVMBuildAShr", Ref, [Ref, Ref, Ref, "str"]);
const LLVMBuildLShr = lib.func("LLVMBuildLShr", Ref, [Ref, Ref, Ref, "str"]);

const LLVMBuildNeg = lib.func("LLVMBuildNeg", Ref, [Ref, Ref, "str"]);
const LLVMBuildFNeg = lib.func("LLVMBuildFNeg", Ref, [Ref, Ref, "str"]);
const LLVMBuildNot = lib.func("LLVMBuildNot", Ref, [Ref, Ref, "str"]);

const LLVMBuildAlloca = lib.func("LLVMBuildAlloca", Ref, [Ref, Ref, "str"]);
const LLVMBuildLoad2 = lib.func("LLVMBuildLoad2", Ref, [Ref, Ref, Ref, "str"]);
const LLVMBuildStore = lib.func("LLVMBuildStore", Ref, [Ref, Ref, Ref]);
const LLVMBuildInBoundsGEP2 = lib.func("LLVMBuildInBoundsGEP2", Ref, [
  Ref,
  Ref,
  Ref,
  RefArr,
  "uint",
  "str",
]);
const LLVMBuildGlobalStringPtr = lib.func("LLVMBuildGlobalStringPtr", Ref, [Ref, "str", "str"]);

const LLVMBuildBr = lib.func("LLVMBuildBr", Ref, [Ref, Ref]);
const LLVMBuildCondBr = lib.func("LLVMBuildCondBr", Ref, [Ref, Ref, Ref, Ref]);
const LLVMBuildRet = lib.func("LLVMBuildRet", Ref, [Ref, Ref]);
const LLVMBuildRetVoid = lib.func("LLVMBuildRetVoid", Ref, [Ref]);
const LLVMBuildUnreachable = lib.func("LLVMBuildUnreachable", Ref, [Ref]);

const LLVMBuildCall2 = lib.func("LLVMBuildCall2", Ref, [Ref, Ref, Ref, RefArr, "uint", "str"]);
const LLVMBuildSelect = lib.func("LLVMBuildSelect", Ref, [Ref, Ref, Ref, Ref, "str"]);

const LLVMBuildPhi = lib.func("LLVMBuildPhi", Ref, [Ref, Ref, "str"]);
const LLVMAddIncoming = lib.func("LLVMAddIncoming", "void", [Ref, RefArr, RefArr, "uint"]);

const LLVMBuildExtractValue = lib.func("LLVMBuildExtractValue", Ref, [Ref, Ref, "uint", "str"]);
const LLVMBuildInsertValue = lib.func("LLVMBuildInsertValue", Ref, [Ref, Ref, Ref, "uint", "str"]);
const LLVMBuildTrunc = lib.func("LLVMBuildTrunc", Ref, [Ref, Ref, Ref, "str"]);
const LLVMBuildZExt = lib.func("LLVMBuildZExt", Ref, [Ref, Ref, Ref, "str"]);
const LLVMBuildSExt = lib.func("LLVMBuildSExt", Ref, [Ref, Ref, Ref, "str"]);
const LLVMBuildFPToSI = lib.func("LLVMBuildFPToSI", Ref, [Ref, Ref, Ref, "str"]);
const LLVMBuildSIToFP = lib.func("LLVMBuildSIToFP", Ref, [Ref, Ref, Ref, "str"]);

const LLVMGetEnumAttributeKindForName = lib.func("LLVMGetEnumAttributeKindForName", "uint", [
  "str",
  "size_t",
]);
const LLVMCreateEnumAttribute = lib.func("LLVMCreateEnumAttribute", Ref, [Ref, "uint", "uint64"]);
const LLVMAddAttributeAtIndex = lib.func("LLVMAddAttributeAtIndex", "void", [Ref, "uint", Ref]);

const LLVMPrintModuleToFile = lib.func("LLVMPrintModuleToFile", Bool, [
  Ref,
  "str",
  koffi.out(koffi.pointer("char")),
]);
const LLVMDisposeMessage = lib.func("LLVMDisposeMessage", "void", [Ref]);
const LLVMVerifyModule = lib.func("LLVMVerifyModule", Bool, [
  Ref,
  "int",
  koffi.out(koffi.pointer("char *")),
]);

const LLVMGetDefaultTargetTriple = lib.func("LLVMGetDefaultTargetTriple", "char *", []);
const LLVMGetHostCPUName = lib.func("LLVMGetHostCPUName", "char *", []);
const LLVMGetHostCPUFeatures = lib.func("LLVMGetHostCPUFeatures", "char *", []);
const LLVMGetTargetFromTriple = lib.func("LLVMGetTargetFromTriple", Bool, [
  "str",
  koffi.out(koffi.pointer(Ref)),
  koffi.out(koffi.pointer("char")),
]);
const LLVMCreateTargetMachine = lib.func("LLVMCreateTargetMachine", Ref, [
  Ref,
  "str",
  "str",
  "str",
  "int",
  "int",
  "int",
]);
const LLVMCreateTargetDataLayout = lib.func("LLVMCreateTargetDataLayout", Ref, [Ref]);
const LLVMDisposeTargetMachine = lib.func("LLVMDisposeTargetMachine", "void", [Ref]);
const LLVMDisposeTargetData = lib.func("LLVMDisposeTargetData", "void", [Ref]);
const LLVMTargetMachineEmitToFile = lib.func("LLVMTargetMachineEmitToFile", Bool, [
  Ref,
  Ref,
  "str",
  "int",
  koffi.out(koffi.pointer("char")),
]);

const LLVMCreatePassBuilderOptions = lib.func("LLVMCreatePassBuilderOptions", Ref, []);
const LLVMDisposePassBuilderOptions = lib.func("LLVMDisposePassBuilderOptions", "void", [Ref]);
const LLVMRunPasses = lib.func("LLVMRunPasses", Ref, [Ref, "str", Ref, Ref]);
const LLVMGetErrorMessage = lib.func("LLVMGetErrorMessage", "char *", [Ref]);
const LLVMConsumeError = lib.func("LLVMConsumeError", "void", [Ref]);

const LLVMInitializeAArch64TargetInfo = lib.func("LLVMInitializeAArch64TargetInfo", "void", []);
const LLVMInitializeAArch64Target = lib.func("LLVMInitializeAArch64Target", "void", []);
const LLVMInitializeAArch64TargetMC = lib.func("LLVMInitializeAArch64TargetMC", "void", []);
const LLVMInitializeAArch64AsmPrinter = lib.func("LLVMInitializeAArch64AsmPrinter", "void", []);
const LLVMInitializeX86TargetInfo = lib.func("LLVMInitializeX86TargetInfo", "void", []);
const LLVMInitializeX86Target = lib.func("LLVMInitializeX86Target", "void", []);
const LLVMInitializeX86TargetMC = lib.func("LLVMInitializeX86TargetMC", "void", []);
const LLVMInitializeX86AsmPrinter = lib.func("LLVMInitializeX86AsmPrinter", "void", []);

const LLVMCreateDIBuilder = lib.func("LLVMCreateDIBuilder", Ref, [Ref]);
const LLVMDisposeDIBuilder = lib.func("LLVMDisposeDIBuilder", "void", [Ref]);
const LLVMDIBuilderFinalize = lib.func("LLVMDIBuilderFinalize", "void", [Ref]);
const LLVMDIBuilderCreateFile = lib.func("LLVMDIBuilderCreateFile", Ref, [
  Ref,
  "str",
  "size_t",
  "str",
  "size_t",
]);
const LLVMDIBuilderCreateCompileUnit = lib.func("LLVMDIBuilderCreateCompileUnit", Ref, [
  Ref,
  "uint",
  Ref,
  "str",
  "size_t",
  Bool,
  "str",
  "size_t",
  "uint",
  "str",
  "size_t",
  "uint",
  Bool,
  Bool,
  "str",
  "size_t",
  "str",
  "size_t",
]);
const LLVMDIBuilderCreateSubroutineType = lib.func("LLVMDIBuilderCreateSubroutineType", Ref, [
  Ref,
  Ref,
  RefArr,
  "uint",
  "uint",
]);
const LLVMDIBuilderCreateFunction = lib.func("LLVMDIBuilderCreateFunction", Ref, [
  Ref,
  Ref,
  "str",
  "size_t",
  "str",
  "size_t",
  Ref,
  "uint",
  Ref,
  Bool,
  Bool,
  "uint",
  "uint",
  Bool,
]);
const LLVMSetSubprogram = lib.func("LLVMSetSubprogram", "void", [Ref, Ref]);
const LLVMDIBuilderCreateDebugLocation = lib.func("LLVMDIBuilderCreateDebugLocation", Ref, [
  Ref,
  "uint",
  "uint",
  Ref,
  Ref,
]);
const LLVMSetCurrentDebugLocation2 = lib.func("LLVMSetCurrentDebugLocation2", "void", [Ref, Ref]);
const LLVMAddModuleFlag = lib.func("LLVMAddModuleFlag", "void", [Ref, "uint", "str", "uint", Ref]);
const LLVMValueAsMetadata = lib.func("LLVMValueAsMetadata", Ref, [Ref]);
const LLVMMDStringInContext2 = lib.func("LLVMMDStringInContext2", Ref, [Ref, "str", "size_t"]);

export const LLVMIntEQ = 32;
export const LLVMIntNE = 33;
export const LLVMIntSLT = 40;
export const LLVMIntSLE = 41;
export const LLVMIntSGT = 38;
export const LLVMIntSGE = 39;
export const LLVMIntULT = 36;
export const LLVMIntULE = 37;
export const LLVMIntUGT = 34;
export const LLVMIntUGE = 35;

export const LLVMRealOEQ = 1;
export const LLVMRealONE = 6;
export const LLVMRealOLT = 4;
export const LLVMRealOLE = 5;
export const LLVMRealOGT = 2;
export const LLVMRealOGE = 3;
export const LLVMRealORD = 7;
export const LLVMRealUNO = 8;

export const LLVMInternalLinkage = 8;
export const LLVMPrivateLinkage = 9;
export const LLVMCodeGenLevelDefault = 2;
export const LLVMCodeGenLevelAggressive = 3;
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

export class LLVMModule {
  readonly ctx: any;
  readonly mod: any;
  readonly builder: any;
  readonly i1: any;
  readonly i8: any;
  readonly i32: any;
  readonly i64: any;
  readonly f64: any;
  readonly voidTy: any;
  readonly ptr: any;
  private functions = new Map<string, any>();
  private globals = new Map<string, any>();

  private targetMachine: any;
  private dataLayout: any;

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
    this.ptr = LLVMPointerTypeInContext(this.ctx, 0);

    const triple = LLVMGetDefaultTargetTriple();
    LLVMSetTarget(this.mod, triple);

    const targetArr = [null];
    const errArr = [null];
    if (LLVMGetTargetFromTriple(triple, targetArr, errArr) === 0) {
      this.targetMachine = LLVMCreateTargetMachine(
        targetArr[0],
        triple,
        "",
        "",
        LLVMCodeGenLevelAggressive,
        LLVMRelocPIC,
        LLVMCodeModelDefault,
      );
      this.dataLayout = LLVMCreateTargetDataLayout(this.targetMachine);
      LLVMSetModuleDataLayout(this.mod, this.dataLayout);
    }
  }

  dispose(): void {
    if (this.diBuilder) LLVMDisposeDIBuilder(this.diBuilder);
    LLVMDisposeBuilder(this.builder);
    LLVMDisposeModule(this.mod);
    if (this.dataLayout) LLVMDisposeTargetData(this.dataLayout);
    if (this.targetMachine) LLVMDisposeTargetMachine(this.targetMachine);
    LLVMContextDispose(this.ctx);
  }

  functionType(ret: any, params: any[], isVarArg = false): any {
    return LLVMFunctionType(
      ret,
      params.length > 0 ? params : null,
      params.length,
      isVarArg ? 1 : 0,
    );
  }

  addFunction(name: string, type: any): any {
    const fn = LLVMAddFunction(this.mod, name, type);
    this.functions.set(name, fn);
    return fn;
  }

  getFunction(name: string): any {
    return this.functions.get(name);
  }

  getParam(fn: any, index: number): any {
    return LLVMGetParam(fn, index);
  }

  addGlobal(name: string, type: any): any {
    const g = LLVMAddGlobal(this.mod, type, name);
    this.globals.set(name, g);
    return g;
  }

  getGlobal(name: string): any {
    return this.globals.get(name);
  }

  setInitializer(global: any, value: any): void {
    LLVMSetInitializer(global, value);
  }

  setLinkage(value: any, linkage: number): void {
    LLVMSetLinkage(value, linkage);
  }

  appendBlock(fn: any, name: string): any {
    return LLVMAppendBasicBlockInContext(this.ctx, fn, name);
  }

  positionAtEnd(block: any): void {
    LLVMPositionBuilderAtEnd(this.builder, block);
  }

  getInsertBlock(): any {
    return LLVMGetInsertBlock(this.builder);
  }

  currentBlockHasTerminator(): boolean {
    const block = LLVMGetInsertBlock(this.builder);
    if (!block) return false;
    const term = LLVMGetBasicBlockTerminator(block);
    return !!term;
  }

  constInt(type: any, val: number | bigint, signExtend = false): any {
    return LLVMConstInt(type, typeof val === "bigint" ? val : BigInt(val), signExtend ? 1 : 0);
  }

  constBigInt(type: any, hexStr: string): any {
    return LLVMConstInt(type, BigInt("0x" + hexStr), 0);
  }

  constReal(type: any, val: number): any {
    return LLVMConstReal(type, val);
  }

  constNull(type: any): any {
    return LLVMConstNull(type);
  }

  getUndef(type: any): any {
    return LLVMGetUndef(type);
  }

  constArray(elemType: any, values: any[]): any {
    return LLVMConstArray2(elemType, values, BigInt(values.length));
  }

  constNamedStruct(structTy: any, values: any[]): any {
    return LLVMConstNamedStruct(structTy, values, values.length);
  }

  arrayType(elemType: any, count: number): any {
    return LLVMArrayType2(elemType, BigInt(count));
  }

  structCreateNamed(name: string): any {
    return LLVMStructCreateNamed(this.ctx, name);
  }

  structSetBody(structTy: any, elementTypes: any[], packed = false): void {
    LLVMStructSetBody(structTy, elementTypes, elementTypes.length, packed ? 1 : 0);
  }

  sizeOf(type: any): any {
    return LLVMSizeOf(type);
  }

  buildBitCast(val: any, destTy: any, name = ""): any {
    return LLVMBuildBitCast(this.builder, val, destTy, name);
  }

  buildAdd(lhs: any, rhs: any, name = ""): any {
    return LLVMBuildAdd(this.builder, lhs, rhs, name);
  }
  buildSub(lhs: any, rhs: any, name = ""): any {
    return LLVMBuildSub(this.builder, lhs, rhs, name);
  }
  buildMul(lhs: any, rhs: any, name = ""): any {
    return LLVMBuildMul(this.builder, lhs, rhs, name);
  }
  buildSDiv(lhs: any, rhs: any, name = ""): any {
    return LLVMBuildSDiv(this.builder, lhs, rhs, name);
  }
  buildSRem(lhs: any, rhs: any, name = ""): any {
    return LLVMBuildSRem(this.builder, lhs, rhs, name);
  }
  buildFAdd(lhs: any, rhs: any, name = ""): any {
    return LLVMBuildFAdd(this.builder, lhs, rhs, name);
  }
  buildFSub(lhs: any, rhs: any, name = ""): any {
    return LLVMBuildFSub(this.builder, lhs, rhs, name);
  }
  buildFMul(lhs: any, rhs: any, name = ""): any {
    return LLVMBuildFMul(this.builder, lhs, rhs, name);
  }
  buildFDiv(lhs: any, rhs: any, name = ""): any {
    return LLVMBuildFDiv(this.builder, lhs, rhs, name);
  }
  buildFRem(lhs: any, rhs: any, name = ""): any {
    return LLVMBuildFRem(this.builder, lhs, rhs, name);
  }

  buildICmp(pred: number, lhs: any, rhs: any, name = ""): any {
    return LLVMBuildICmp(this.builder, pred, lhs, rhs, name);
  }
  buildFCmp(pred: number, lhs: any, rhs: any, name = ""): any {
    return LLVMBuildFCmp(this.builder, pred, lhs, rhs, name);
  }

  buildAnd(lhs: any, rhs: any, name = ""): any {
    return LLVMBuildAnd(this.builder, lhs, rhs, name);
  }
  buildOr(lhs: any, rhs: any, name = ""): any {
    return LLVMBuildOr(this.builder, lhs, rhs, name);
  }
  buildXor(lhs: any, rhs: any, name = ""): any {
    return LLVMBuildXor(this.builder, lhs, rhs, name);
  }
  buildShl(lhs: any, rhs: any, name = ""): any {
    return LLVMBuildShl(this.builder, lhs, rhs, name);
  }
  buildAShr(lhs: any, rhs: any, name = ""): any {
    return LLVMBuildAShr(this.builder, lhs, rhs, name);
  }
  buildLShr(lhs: any, rhs: any, name = ""): any {
    return LLVMBuildLShr(this.builder, lhs, rhs, name);
  }

  buildNeg(val: any, name = ""): any {
    return LLVMBuildNeg(this.builder, val, name);
  }
  buildFNeg(val: any, name = ""): any {
    return LLVMBuildFNeg(this.builder, val, name);
  }
  buildNot(val: any, name = ""): any {
    return LLVMBuildNot(this.builder, val, name);
  }

  buildAlloca(type: any, name = ""): any {
    return LLVMBuildAlloca(this.builder, type, name);
  }
  buildLoad(type: any, ptr: any, name = ""): any {
    return LLVMBuildLoad2(this.builder, type, ptr, name);
  }
  buildStore(val: any, ptr: any): any {
    return LLVMBuildStore(this.builder, val, ptr);
  }

  buildGEP(type: any, ptr: any, indices: any[], name = ""): any {
    return LLVMBuildInBoundsGEP2(this.builder, type, ptr, indices, indices.length, name);
  }

  buildGlobalStringPtr(str: string, name = ""): any {
    return LLVMBuildGlobalStringPtr(this.builder, str, name);
  }

  buildBr(dest: any): any {
    return LLVMBuildBr(this.builder, dest);
  }
  buildCondBr(cond: any, then: any, els: any): any {
    return LLVMBuildCondBr(this.builder, cond, then, els);
  }
  buildRet(val: any): any {
    return LLVMBuildRet(this.builder, val);
  }
  buildRetVoid(): any {
    return LLVMBuildRetVoid(this.builder);
  }

  buildUnreachable(): any {
    return LLVMBuildUnreachable(this.builder);
  }

  buildCall(fnType: any, fn: any, args: any[], name = ""): any {
    return LLVMBuildCall2(
      this.builder,
      fnType,
      fn,
      args.length > 0 ? args : null,
      args.length,
      name,
    );
  }

  buildExtractValue(agg: any, index: number, name = ""): any {
    return LLVMBuildExtractValue(this.builder, agg, index, name);
  }

  buildInsertValue(agg: any, val: any, index: number, name = ""): any {
    return LLVMBuildInsertValue(this.builder, agg, val, index, name);
  }

  buildSelect(cond: any, then: any, els: any, name = ""): any {
    return LLVMBuildSelect(this.builder, cond, then, els, name);
  }

  buildPhi(type: any, name = ""): any {
    return LLVMBuildPhi(this.builder, type, name);
  }

  addIncoming(phi: any, values: any[], blocks: any[]): void {
    LLVMAddIncoming(phi, values, blocks, values.length);
  }

  buildTrunc(val: any, destTy: any, name = ""): any {
    return LLVMBuildTrunc(this.builder, val, destTy, name);
  }
  buildZExt(val: any, destTy: any, name = ""): any {
    return LLVMBuildZExt(this.builder, val, destTy, name);
  }
  buildSExt(val: any, destTy: any, name = ""): any {
    return LLVMBuildSExt(this.builder, val, destTy, name);
  }
  buildFPToSI(val: any, destTy: any, name = ""): any {
    return LLVMBuildFPToSI(this.builder, val, destTy, name);
  }
  buildSIToFP(val: any, destTy: any, name = ""): any {
    return LLVMBuildSIToFP(this.builder, val, destTy, name);
  }

  printToFile(path: string): void {
    const errArr = [null];
    if (LLVMPrintModuleToFile(this.mod, path, errArr) !== 0) {
      throw new Error("Failed to print LLVM module to file");
    }
  }

  private diBuilder: any = null;
  private diFile: any = null;
  private diCU: any = null;
  private diScopes: any[] = [];

  initDebugInfo(filename: string, directory: string): void {
    this.diBuilder = LLVMCreateDIBuilder(this.mod);
    this.diFile = LLVMDIBuilderCreateFile(
      this.diBuilder,
      filename,
      filename.length,
      directory,
      directory.length,
    );
    this.diCU = LLVMDIBuilderCreateCompileUnit(
      this.diBuilder,
      1,
      this.diFile,
      "chadscript",
      10,
      0,
      "",
      0,
      0,
      "",
      0,
      1,
      0,
      0,
      "",
      0,
      "",
      0,
    );

    const dwarfVal = LLVMValueAsMetadata(LLVMConstInt(this.i32, 4, 0));
    const diVerVal = LLVMValueAsMetadata(LLVMConstInt(this.i32, 3, 0));
    LLVMAddModuleFlag(this.mod, 1, "Dwarf Version", 13, dwarfVal);
    LLVMAddModuleFlag(this.mod, 1, "Debug Info Version", 18, diVerVal);
  }

  createDebugFunction(fn: any, name: string, line: number): any {
    if (!this.diBuilder) return null;
    const subroutineType = LLVMDIBuilderCreateSubroutineType(
      this.diBuilder,
      this.diFile,
      null,
      0,
      0,
    );
    const sp = LLVMDIBuilderCreateFunction(
      this.diBuilder,
      this.diFile,
      name,
      name.length,
      name,
      name.length,
      this.diFile,
      line,
      subroutineType,
      0,
      1,
      line,
      0,
      0,
    );
    LLVMSetSubprogram(fn, sp);
    return sp;
  }

  setDebugLocation(line: number, col: number, scope: any): void {
    if (!this.diBuilder || !scope) return;
    const loc = LLVMDIBuilderCreateDebugLocation(this.ctx, line, col, scope, null);
    LLVMSetCurrentDebugLocation2(this.builder, loc);
  }

  clearDebugLocation(): void {
    LLVMSetCurrentDebugLocation2(this.builder, null);
  }

  finalizeDebugInfo(): void {
    if (this.diBuilder) {
      LLVMDIBuilderFinalize(this.diBuilder);
    }
    if (process.env.CHAD2_VERIFY) {
      const errArr = [null];
      const failed = LLVMVerifyModule(this.mod, 2, errArr);
      if (failed !== 0) {
        const msg = errArr[0] ? String(errArr[0]) : "(no message)";
        throw new Error(`LLVM module verification failed:\n${msg}`);
      }
    }
  }

  emitObjectFile(path: string): void {
    if (!this.targetMachine) {
      throw new Error("Failed to create target machine");
    }

    const passOpts = LLVMCreatePassBuilderOptions();
    const passErr = LLVMRunPasses(this.mod, "default<O3>", this.targetMachine, passOpts);
    LLVMDisposePassBuilderOptions(passOpts);
    if (passErr !== null) {
      const msg = LLVMGetErrorMessage(passErr);
      LLVMConsumeError(passErr);
      throw new Error(`LLVM optimization passes failed: ${msg}`);
    }

    const emitErr = [null];
    if (LLVMTargetMachineEmitToFile(this.targetMachine, this.mod, path, LLVMObjectFileType, emitErr) !== 0) {
      throw new Error("Failed to emit object file");
    }
  }
}
