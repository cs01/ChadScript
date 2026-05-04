import { writeFileSync } from "fs";
import { execSync } from "child_process";

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

const ICMP_NAMES: Record<number, string> = {
  [LLVMIntEQ]: "eq", [LLVMIntNE]: "ne",
  [LLVMIntSLT]: "slt", [LLVMIntSLE]: "sle",
  [LLVMIntSGT]: "sgt", [LLVMIntSGE]: "sge",
  [LLVMIntULT]: "ult", [LLVMIntULE]: "ule",
  [LLVMIntUGT]: "ugt", [LLVMIntUGE]: "uge",
};
const FCMP_NAMES: Record<number, string> = {
  [LLVMRealOEQ]: "oeq", [LLVMRealONE]: "one",
  [LLVMRealOLT]: "olt", [LLVMRealOLE]: "ole",
  [LLVMRealOGT]: "ogt", [LLVMRealOGE]: "oge",
  [LLVMRealORD]: "ord", [LLVMRealUNO]: "uno",
};

interface FnTypeInfo {
  ret: string;
  params: string[];
  isVarArg: boolean;
}

interface FnInfo {
  name: string;
  typeInfo: FnTypeInfo;
  ref: string;
  blocks: BlockInfo[];
}

interface PhiInfo {
  ref: string;
  ty: string;
  incoming: { val: string; block: string }[];
}

interface BlockInfo {
  name: string;
  fn: FnInfo;
  lines: string[];
  hasTerminator: boolean;
  phis: PhiInfo[];
}

const LLVM_PATH = "/opt/homebrew/opt/llvm/bin";

function joinStrs(arr: string[], sep: string): string {
  if (arr.length === 0) return "";
  let out = arr[0];
  for (let i = 1; i < arr.length; i++) {
    out = out + sep + arr[i];
  }
  return out;
}

export class LLVMModule {
  i1: string;
  i8: string;
  i32: string;
  i64: string;
  f64: string;
  voidTy: string;
  ptr: string;

  private _nextId: number;
  private _globals: string[];
  private _structs: Map<string, { fields: string[] }>;
  private _functions: Map<string, FnInfo>;
  private _fnTypes: Map<string, FnTypeInfo>;
  private _globalTypes: Map<string, string>;
  private _globalLinkage: Map<string, string>;
  private _globalInit: Map<string, string>;
  private _valueTypes: Map<string, string>;
  private _curBlock: BlockInfo | null;
  private _stringCounter: number;
  private _blockNameCounters: Map<string, number>;

  constructor(_name: string) {
    this.i1 = "i1";
    this.i8 = "i8";
    this.i32 = "i32";
    this.i64 = "i64";
    this.f64 = "double";
    this.voidTy = "void";
    this.ptr = "ptr";
    this._nextId = 0;
    this._globals = [];
    this._structs = new Map<string, { fields: string[] }>();
    this._functions = new Map<string, FnInfo>();
    this._fnTypes = new Map<string, FnTypeInfo>();
    this._globalTypes = new Map<string, string>();
    this._globalLinkage = new Map<string, string>();
    this._globalInit = new Map<string, string>();
    this._valueTypes = new Map<string, string>();
    this._curBlock = null;
    this._stringCounter = 0;
    this._blockNameCounters = new Map<string, number>();
  }

  dispose(): void {}

  private _fresh(prefix = ""): string {
    return "%" + (prefix || "v") + "." + this._nextId++;
  }

  private _emit(line: string): void {
    if (this._curBlock) this._curBlock.lines.push("  " + line);
  }

  private _tyStr(t: any): string {
    if (typeof t === "string") return t;
    if (t && typeof t === "object" && "ty" in t) return t.ty;
    return "ptr";
  }

  private _tyOf(val: any): string {
    if (val && typeof val === "object" && "ty" in val) return val.ty;
    if (typeof val === "string") return this._valueTypes.get(val) || "ptr";
    return "ptr";
  }

  private _refOf(val: any): string {
    if (val && typeof val === "object" && "ref" in val) return val.ref;
    return String(val);
  }

  private _v(ref: string, ty: string): any {
    this._valueTypes.set(ref, ty);
    return { ref, ty };
  }

  private _autocast(ref: string, fromTy: string, toTy: string): string {
    if (fromTy === toTy) return ref;
    if (ref === "null" || ref === "zeroinitializer") {
      if (toTy === "i1") return "0";
      if (toTy === "i32") return "0";
      if (toTy === "i64") return "0";
      if (toTy === "double") return "0.0";
      return ref;
    }
    const r = this._fresh("cast");
    if (toTy === "ptr" && fromTy === "i64") {
      this._emit(r + " = inttoptr i64 " + ref + " to ptr");
    } else if (toTy === "i64" && fromTy === "ptr") {
      this._emit(r + " = ptrtoint ptr " + ref + " to i64");
    } else if (toTy === "double" && fromTy === "ptr") {
      const tmp = this._fresh("pti");
      this._emit(tmp + " = ptrtoint ptr " + ref + " to i64");
      this._emit(r + " = bitcast i64 " + tmp + " to double");
    } else if (toTy === "ptr" && fromTy === "double") {
      const tmp = this._fresh("dti");
      this._emit(tmp + " = bitcast double " + ref + " to i64");
      this._emit(r + " = inttoptr i64 " + tmp + " to ptr");
    } else if (toTy === "double" && fromTy === "i64") {
      this._emit(r + " = bitcast i64 " + ref + " to double");
    } else if (toTy === "i64" && fromTy === "double") {
      this._emit(r + " = bitcast double " + ref + " to i64");
    } else if (toTy === "i32" && fromTy === "i64") {
      this._emit(r + " = trunc i64 " + ref + " to i32");
    } else if (toTy === "i64" && fromTy === "i32") {
      this._emit(r + " = sext i32 " + ref + " to i64");
    } else if (toTy === "double" && fromTy === "i32") {
      this._emit(r + " = sitofp i32 " + ref + " to double");
    } else if (toTy === "i32" && fromTy === "double") {
      this._emit(r + " = fptosi double " + ref + " to i32");
    } else if (toTy === "i64" && fromTy === "i1") {
      this._emit(r + " = zext i1 " + ref + " to i64");
    } else if (toTy === "i32" && fromTy === "i1") {
      this._emit(r + " = zext i1 " + ref + " to i32");
    } else if (toTy === "double" && fromTy === "i1") {
      const tmp = this._fresh("zext");
      this._emit(tmp + " = zext i1 " + ref + " to i64");
      this._emit(r + " = sitofp i64 " + tmp + " to double");
    } else if (toTy === "i1" && fromTy === "i64") {
      this._emit(r + " = trunc i64 " + ref + " to i1");
    } else if (toTy === "i1" && fromTy === "i32") {
      this._emit(r + " = trunc i32 " + ref + " to i1");
    } else {
      return ref;
    }
    this._valueTypes.set(r, toTy);
    return r;
  }

  functionType(ret: any, params: any[], isVarArg = false): any {
    const key = "fty." + this._nextId++;
    const paramStrs: string[] = [];
    for (let i = 0; i < params.length; i++) {
      paramStrs.push(this._tyStr(params[i]));
    }
    this._fnTypes.set(key, {
      ret: this._tyStr(ret),
      params: paramStrs,
      isVarArg,
    });
    return key;
  }

  private _fnTypeStr(info: FnTypeInfo): string {
    let s = info.ret + " (";
    s = s + joinStrs(info.params, ", ");
    if (info.isVarArg) s = s + (info.params.length > 0 ? ", ..." : "...");
    s = s + ")";
    return s;
  }

  addFunction(name: string, type: any): any {
    const info = this._fnTypes.get(type)!;
    const fnInfo: FnInfo = { name, typeInfo: info, ref: "@" + name, blocks: [] };
    this._functions.set(name, fnInfo);
    return fnInfo;
  }

  getFunction(name: string): any {
    return this._functions.get(name) || null;
  }

  getParam(fn: any, index: number): any {
    const fnInfo = fn as FnInfo;
    const ty = fnInfo.typeInfo.params[index] || "ptr";
    return this._v("%" + index, ty);
  }

  addGlobal(name: string, type: any): any {
    const ty = this._tyStr(type);
    this._globalTypes.set(name, ty);
    return this._v("@" + name, "ptr");
  }

  getGlobal(name: string): any {
    return this._v("@" + name, "ptr");
  }

  setInitializer(global: any, value: any): void {
    const gName = this._refOf(global).slice(1);
    const ty = this._globalTypes.get(gName) || "ptr";
    const valRef = this._refOf(value);
    const valTy = this._tyOf(value);
    let initStr: string;
    if (valRef === "null" || valRef === "zeroinitializer") {
      initStr = "zeroinitializer";
    } else if (valRef.startsWith("{") || valRef.startsWith("[")) {
      initStr = valRef;
    } else {
      initStr = valRef;
    }
    this._globalInit.set(gName, initStr);
  }

  setLinkage(value: any, linkage: number): void {
    const ref = this._refOf(value).slice(1);
    this._globalLinkage.set(ref, linkage === LLVMPrivateLinkage ? "private" : "internal");
  }

  appendBlock(fn: any, name: string): any {
    const fnInfo = fn as FnInfo;
    const count = this._blockNameCounters.get(fnInfo.name + ":" + name) || 0;
    this._blockNameCounters.set(fnInfo.name + ":" + name, count + 1);
    const blockName = count === 0 && name === "entry" ? "entry" : name + "." + count;
    const block: BlockInfo = { name: blockName, fn: fnInfo, lines: [], hasTerminator: false, phis: [] };
    fnInfo.blocks.push(block);
    return block;
  }

  positionAtEnd(block: any): void {
    this._curBlock = block as BlockInfo;
  }

  getInsertBlock(): any {
    return this._curBlock;
  }

  currentBlockHasTerminator(): boolean {
    return this._curBlock?.hasTerminator || false;
  }

  constInt(type: any, val: number | bigint, signExtend = false): any {
    const ty = this._tyStr(type);
    const s = String(val);
    if (ty === "double") {
      if (s.indexOf(".") === -1 && s.indexOf("e") === -1) return this._v(s + ".0", ty);
    }
    return this._v(s, ty);
  }

  constBigInt(type: any, hexStr: string): any {
    const ty = this._tyStr(type);
    if (ty === "double") {
      return this._v("0x" + hexStr.toUpperCase(), ty);
    }
    let decimal = this._hexToDecimal(hexStr);
    return this._v(decimal, ty);
  }

  private _hexToDecimal(hex: string): string {
    let result: number[] = [0];
    for (let i = 0; i < hex.length; i++) {
      const digit = parseInt(hex[i], 16);
      let carry = 0;
      for (let j = result.length - 1; j >= 0; j--) {
        const val = result[j] * 16 + carry;
        result[j] = val % 10;
        carry = (val - result[j]) / 10;
      }
      while (carry > 0) {
        result.unshift(carry % 10);
        carry = (carry - carry % 10) / 10;
      }
      carry = digit;
      for (let j = result.length - 1; j >= 0; j--) {
        const val = result[j] + carry;
        result[j] = val % 10;
        carry = (val - result[j]) / 10;
      }
      while (carry > 0) {
        result.unshift(carry % 10);
        carry = (carry - carry % 10) / 10;
      }
    }
    let s = "";
    for (let i = 0; i < result.length; i++) s = s + String(result[i]);
    return s;
  }

  constReal(type: any, val: number): any {
    const ty = this._tyStr(type);
    let s: string;
    if (val === 0 && 1 / val < 0) {
      s = "0x8000000000000000";
    } else if (val !== val) {
      s = "0x7FF8000000000000";
    } else if (!isFinite(val)) {
      s = val > 0 ? "0x7FF0000000000000" : "0xFFF0000000000000";
    } else if (val === 0) {
      s = "0.0";
    } else {
      const str = String(val);
      if (str.indexOf(".") === -1 && str.indexOf("e") === -1) {
        s = str + ".0";
      } else {
        s = str;
      }
    }
    return this._v(s, ty);
  }

  constNull(type: any): any {
    const ty = this._tyStr(type);
    return this._v(ty === "ptr" ? "null" : "zeroinitializer", ty);
  }

  getUndef(type: any): any {
    return this._v("undef", this._tyStr(type));
  }

  constArray(elemType: any, values: any[]): any {
    const ety = this._tyStr(elemType);
    const parts: string[] = [];
    for (let i = 0; i < values.length; i++) {
      parts.push(ety + " " + this._refOf(values[i]));
    }
    const items = joinStrs(parts, ", ");
    const arrTy = "[" + values.length + " x " + ety + "]";
    return this._v("[" + items + "]", arrTy);
  }

  constNamedStruct(structTy: any, values: any[]): any {
    const sName = this._tyStr(structTy);
    const info = this._structs.get(sName.startsWith("%") ? sName.slice(1) : sName);
    const parts: string[] = [];
    for (let i = 0; i < values.length; i++) {
      const fty = info && i < info.fields.length ? info.fields[i] : this._tyOf(values[i]);
      parts.push(fty + " " + this._refOf(values[i]));
    }
    const items = joinStrs(parts, ", ");
    return this._v("{ " + items + " }", sName);
  }

  arrayType(elemType: any, count: number): any {
    return "[" + count + " x " + this._tyStr(elemType) + "]";
  }

  structCreateNamed(name: string): any {
    this._structs.set(name, { fields: [] });
    return "%" + name;
  }

  structSetBody(structTy: any, elementTypes: any[], packed = false): void {
    const raw = this._tyStr(structTy);
    const sName = raw.startsWith("%") ? raw.slice(1) : raw;
    const info = this._structs.get(sName);
    if (info) {
      const fields: string[] = [];
      for (let i = 0; i < elementTypes.length; i++) {
        fields.push(this._tyStr(elementTypes[i]));
      }
      info.fields = fields;
    }
  }

  sizeOf(type: any): any {
    const ty = this._tyStr(type);
    return this._v("ptrtoint (ptr getelementptr (" + ty + ", ptr null, i32 1) to i64)", "i64");
  }

  buildBitCast(val: any, destTy: any, name = ""): any {
    const fromTy = this._tyOf(val);
    const toTy = this._tyStr(destTy);
    if (fromTy === toTy) return { ref: this._refOf(val), ty: toTy };
    const r = this._fresh(name);
    this._emit(r + " = bitcast " + fromTy + " " + this._refOf(val) + " to " + toTy);
    return this._v(r, toTy);
  }

  buildPtrToInt(val: any, destTy: any, name = ""): any {
    const toTy = this._tyStr(destTy);
    const r = this._fresh(name);
    this._emit(r + " = ptrtoint " + this._tyOf(val) + " " + this._refOf(val) + " to " + toTy);
    return this._v(r, toTy);
  }

  buildIntToPtr(val: any, destTy: any, name = ""): any {
    const toTy = this._tyStr(destTy);
    const r = this._fresh(name);
    this._emit(r + " = inttoptr " + this._tyOf(val) + " " + this._refOf(val) + " to " + toTy);
    return this._v(r, toTy);
  }

  private _binOp(op: string, lhs: any, rhs: any, name: string): any {
    const ty = this._tyOf(lhs);
    const r = this._fresh(name);
    this._emit(r + " = " + op + " " + ty + " " + this._refOf(lhs) + ", " + this._refOf(rhs));
    return this._v(r, ty);
  }

  buildAdd(lhs: any, rhs: any, name = ""): any { return this._binOp("add", lhs, rhs, name); }
  buildSub(lhs: any, rhs: any, name = ""): any { return this._binOp("sub", lhs, rhs, name); }
  buildMul(lhs: any, rhs: any, name = ""): any { return this._binOp("mul", lhs, rhs, name); }
  buildSDiv(lhs: any, rhs: any, name = ""): any { return this._binOp("sdiv", lhs, rhs, name); }
  buildSRem(lhs: any, rhs: any, name = ""): any { return this._binOp("srem", lhs, rhs, name); }
  buildFAdd(lhs: any, rhs: any, name = ""): any { return this._binOp("fadd", lhs, rhs, name); }
  buildFSub(lhs: any, rhs: any, name = ""): any { return this._binOp("fsub", lhs, rhs, name); }
  buildFMul(lhs: any, rhs: any, name = ""): any { return this._binOp("fmul", lhs, rhs, name); }
  buildFDiv(lhs: any, rhs: any, name = ""): any { return this._binOp("fdiv", lhs, rhs, name); }
  buildFRem(lhs: any, rhs: any, name = ""): any { return this._binOp("frem", lhs, rhs, name); }
  buildAnd(lhs: any, rhs: any, name = ""): any { return this._binOp("and", lhs, rhs, name); }
  buildOr(lhs: any, rhs: any, name = ""): any { return this._binOp("or", lhs, rhs, name); }
  buildXor(lhs: any, rhs: any, name = ""): any { return this._binOp("xor", lhs, rhs, name); }
  buildShl(lhs: any, rhs: any, name = ""): any { return this._binOp("shl", lhs, rhs, name); }
  buildAShr(lhs: any, rhs: any, name = ""): any { return this._binOp("ashr", lhs, rhs, name); }
  buildLShr(lhs: any, rhs: any, name = ""): any { return this._binOp("lshr", lhs, rhs, name); }

  buildNeg(val: any, name = ""): any {
    const ty = this._tyOf(val);
    const r = this._fresh(name);
    this._emit(r + " = sub " + ty + " 0, " + this._refOf(val));
    return this._v(r, ty);
  }

  buildFNeg(val: any, name = ""): any {
    const ty = this._tyOf(val);
    const r = this._fresh(name);
    this._emit(r + " = fneg " + ty + " " + this._refOf(val));
    return this._v(r, ty);
  }

  buildNot(val: any, name = ""): any {
    const ty = this._tyOf(val);
    const r = this._fresh(name);
    this._emit(r + " = xor " + ty + " " + this._refOf(val) + ", -1");
    return this._v(r, ty);
  }

  buildAlloca(type: any, name = ""): any {
    const ty = this._tyStr(type);
    const r = this._fresh(name);
    this._emit(r + " = alloca " + ty);
    return this._v(r, "ptr");
  }

  buildLoad(type: any, ptr: any, name = ""): any {
    const ty = this._tyStr(type);
    const r = this._fresh(name);
    this._emit(r + " = load " + ty + ", ptr " + this._refOf(ptr));
    return this._v(r, ty);
  }

  buildStore(val: any, ptr: any): any {
    const ty = this._tyOf(val);
    this._emit("store " + ty + " " + this._refOf(val) + ", ptr " + this._refOf(ptr));
    return null;
  }

  buildGEP(type: any, ptr: any, indices: any[], name = ""): any {
    const ty = this._tyStr(type);
    const r = this._fresh(name);
    const parts: string[] = [];
    for (let i = 0; i < indices.length; i++) {
      parts.push(this._tyOf(indices[i]) + " " + this._refOf(indices[i]));
    }
    const idxStr = joinStrs(parts, ", ");
    this._emit(r + " = getelementptr inbounds " + ty + ", ptr " + this._refOf(ptr) + ", " + idxStr);
    return this._v(r, "ptr");
  }

  buildGlobalStringPtr(str: string, name = ""): any {
    if (str === undefined || str === null) str = "";
    const id = this._stringCounter++;
    const gName = "@.str." + id;
    const escaped = this._escapeString(str);
    const len = this._utf8ByteLength(str) + 1;
    this._globals.push(gName + " = private unnamed_addr constant [" + len + " x i8] c\"" + escaped + "\\00\"");
    const r = this._fresh(name);
    this._emit(r + " = getelementptr inbounds [" + len + " x i8], ptr " + gName + ", i64 0, i64 0");
    return this._v(r, "ptr");
  }

  private _utf8ByteLength(str: string): number {
    let len = 0;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c < 0x80) len = len + 1;
      else if (c < 0x800) len = len + 2;
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
        len = len + 4;
        i++;
      } else len = len + 3;
    }
    return len;
  }

  private _escapeString(str: string): string {
    let out = "";
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c >= 32 && c < 127 && c !== 34 && c !== 92) {
        out = out + str[i];
      } else if (c < 0x80) {
        out = out + "\\" + this._hexByte(c);
      } else if (c < 0x800) {
        out = out + "\\" + this._hexByte(0xC0 | (c >> 6));
        out = out + "\\" + this._hexByte(0x80 | (c & 0x3F));
      } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
        const lo = str.charCodeAt(i + 1);
        const cp = ((c - 0xD800) << 10) + (lo - 0xDC00) + 0x10000;
        out = out + "\\" + this._hexByte(0xF0 | (cp >> 18));
        out = out + "\\" + this._hexByte(0x80 | ((cp >> 12) & 0x3F));
        out = out + "\\" + this._hexByte(0x80 | ((cp >> 6) & 0x3F));
        out = out + "\\" + this._hexByte(0x80 | (cp & 0x3F));
        i++;
      } else {
        out = out + "\\" + this._hexByte(0xE0 | (c >> 12));
        out = out + "\\" + this._hexByte(0x80 | ((c >> 6) & 0x3F));
        out = out + "\\" + this._hexByte(0x80 | (c & 0x3F));
      }
    }
    return out;
  }

  private _hexByte(b: number): string {
    const HEX = "0123456789ABCDEF";
    return HEX[(b >> 4) & 0xF] + HEX[b & 0xF];
  }

  buildBr(dest: any): any {
    const block = dest as BlockInfo;
    this._emit("br label %" + block.name);
    if (this._curBlock) this._curBlock.hasTerminator = true;
    return null;
  }

  buildCondBr(cond: any, then: any, els: any): any {
    this._emit("br i1 " + this._refOf(cond) + ", label %" + (then as BlockInfo).name + ", label %" + (els as BlockInfo).name);
    if (this._curBlock) this._curBlock.hasTerminator = true;
    return null;
  }

  buildRet(val: any): any {
    let ref = this._refOf(val);
    let ty = this._tyOf(val);
    if (this._curBlock) {
      const retTy = this._curBlock.fn.typeInfo.ret;
      if (retTy !== ty) {
        ref = this._autocast(ref, ty, retTy);
        ty = retTy;
      }
    }
    this._emit("ret " + ty + " " + ref);
    if (this._curBlock) this._curBlock.hasTerminator = true;
    return null;
  }

  buildRetVoid(): any {
    this._emit("ret void");
    if (this._curBlock) this._curBlock.hasTerminator = true;
    return null;
  }

  buildUnreachable(): any {
    this._emit("unreachable");
    if (this._curBlock) this._curBlock.hasTerminator = true;
    return null;
  }

  terminateAllBlocks(fn: any): void {
    const fnInfo = fn as FnInfo;
    for (const block of fnInfo.blocks) {
      if (!block.hasTerminator) {
        block.lines.push("  unreachable");
        block.hasTerminator = true;
      }
    }
  }

  buildCall(fnType: any, fn: any, args: any[], name = ""): any {
    const typeInfo = this._fnTypes.get(fnType);
    let fnRef: string;
    if (fn && typeof fn === "object" && "ref" in fn) {
      fnRef = fn.ref;
    } else {
      fnRef = "@" + String(fn);
    }
    const retTy = typeInfo ? typeInfo.ret : "ptr";
    const argParts: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const aty = typeInfo && i < typeInfo.params.length ? typeInfo.params[i] : this._tyOf(args[i]);
      const actualTy = this._tyOf(args[i]);
      let argRef = this._refOf(args[i]);
      if (aty !== actualTy) {
        argRef = this._autocast(argRef, actualTy, aty);
      }
      argParts.push(aty + " " + argRef);
    }
    const argStrs = joinStrs(argParts, ", ");

    if (retTy === "void") {
      this._emit("call void " + fnRef + "(" + argStrs + ")");
      return null;
    }
    const r = this._fresh(name);
    this._emit(r + " = call " + retTy + " " + fnRef + "(" + argStrs + ")");
    return this._v(r, retTy);
  }

  buildExtractValue(agg: any, index: number, name = ""): any {
    const r = this._fresh(name);
    this._emit(r + " = extractvalue " + this._tyOf(agg) + " " + this._refOf(agg) + ", " + index);
    return this._v(r, "ptr");
  }

  buildInsertValue(agg: any, val: any, index: number, name = ""): any {
    const aggTy = this._tyOf(agg);
    const r = this._fresh(name);
    this._emit(r + " = insertvalue " + aggTy + " " + this._refOf(agg) + ", " + this._tyOf(val) + " " + this._refOf(val) + ", " + index);
    return this._v(r, aggTy);
  }

  buildSelect(cond: any, then: any, els: any, name = ""): any {
    const ty = this._tyOf(then);
    const r = this._fresh(name);
    this._emit(r + " = select i1 " + this._refOf(cond) + ", " + ty + " " + this._refOf(then) + ", " + ty + " " + this._refOf(els));
    return this._v(r, ty);
  }

  buildPhi(type: any, name = ""): any {
    const ty = this._tyStr(type);
    const r = this._fresh(name);
    const phi: PhiInfo = { ref: r, ty, incoming: [] };
    if (this._curBlock) this._curBlock.phis.push(phi);
    return this._v(r, ty);
  }

  addIncoming(phi: any, values: any[], blocks: any[]): void {
    const phiRef = this._refOf(phi);
    const phiTy = this._tyOf(phi);
    for (const [, fnInfo] of this._functions) {
      for (const block of fnInfo.blocks) {
        for (const p of block.phis) {
          if (p.ref === phiRef) {
            for (let i = 0; i < values.length; i++) {
              let valRef = this._refOf(values[i]);
              const valTy = this._tyOf(values[i]);
              if (valTy !== phiTy) {
                const incBlock = blocks[i] as BlockInfo;
                const saved = this._curBlock;
                this._curBlock = incBlock;
                const termLine = incBlock.hasTerminator ? incBlock.lines.pop()! : null;
                valRef = this._autocast(valRef, valTy, phiTy);
                if (termLine !== null) incBlock.lines.push(termLine);
                this._curBlock = saved;
              }
              p.incoming.push({
                val: valRef,
                block: (blocks[i] as BlockInfo).name,
              });
            }
            return;
          }
        }
      }
    }
  }

  private _cast(op: string, val: any, destTy: any, name: string): any {
    const fromTy = this._tyOf(val);
    const toTy = this._tyStr(destTy);
    const r = this._fresh(name);
    this._emit(r + " = " + op + " " + fromTy + " " + this._refOf(val) + " to " + toTy);
    return this._v(r, toTy);
  }

  buildTrunc(val: any, destTy: any, name = ""): any { return this._cast("trunc", val, destTy, name); }
  buildZExt(val: any, destTy: any, name = ""): any { return this._cast("zext", val, destTy, name); }
  buildSExt(val: any, destTy: any, name = ""): any { return this._cast("sext", val, destTy, name); }
  buildFPToSI(val: any, destTy: any, name = ""): any { return this._cast("fptosi", val, destTy, name); }
  buildSIToFP(val: any, destTy: any, name = ""): any { return this._cast("sitofp", val, destTy, name); }

  buildICmp(pred: number, lhs: any, rhs: any, name = ""): any {
    const ty = this._tyOf(lhs);
    let rhsRef = this._refOf(rhs);
    const rhsTy = this._tyOf(rhs);
    if (rhsTy !== ty) rhsRef = this._autocast(rhsRef, rhsTy, ty);
    const r = this._fresh(name);
    if (ty === "double") {
      const fPred = pred === LLVMIntEQ ? "oeq" : pred === LLVMIntNE ? "one" : "oeq";
      this._emit(r + " = fcmp " + fPred + " " + ty + " " + this._refOf(lhs) + ", " + rhsRef);
    } else {
      this._emit(r + " = icmp " + (ICMP_NAMES[pred] || "eq") + " " + ty + " " + this._refOf(lhs) + ", " + rhsRef);
    }
    return this._v(r, "i1");
  }

  buildFCmp(pred: number, lhs: any, rhs: any, name = ""): any {
    const ty = this._tyOf(lhs);
    let rhsRef = this._refOf(rhs);
    const rhsTy = this._tyOf(rhs);
    if (rhsTy !== ty) rhsRef = this._autocast(rhsRef, rhsTy, ty);
    const r = this._fresh(name);
    this._emit(r + " = fcmp " + (FCMP_NAMES[pred] || "oeq") + " " + ty + " " + this._refOf(lhs) + ", " + rhsRef);
    return this._v(r, "i1");
  }

  addEnumAttr(_fn: any, _name: string): void {}
  initDebugInfo(_filename: string, _directory: string): void {}
  createDebugFunction(_fn: any, _name: string, _line: number): any { return null; }
  setDebugLocation(_line: number, _col: number, _scope: any): void {}
  clearDebugLocation(): void {}
  finalizeDebugInfo(): void {}

  printToFile(outPath: string): void {
    writeFileSync(outPath, this._buildIR());
  }

  emitObjectFile(outPath: string): void {
    const base = outPath.endsWith(".o") ? outPath.slice(0, outPath.length - 2) : outPath;
    const irPath = base + ".ll";
    const bcPath = base + ".bc";
    writeFileSync(irPath, this._buildIR());
    if (process.env.CHAD2_VERIFY) {
      try {
        execSync(LLVM_PATH + "/opt -passes=verify -disable-output " + irPath, { stdio: "inherit" });
      } catch {
        throw new Error("LLVM IR verification failed");
      }
    }
    try {
      execSync(
        LLVM_PATH + "/opt -O3 -o " + bcPath + " " + irPath +
        " && " + LLVM_PATH + "/llc -O3 -relocation-model=pic -filetype=obj -o " + outPath + " " + bcPath,
        { stdio: "pipe" },
      );
    } catch {
      throw new Error("LLVM compilation failed");
    }
  }

  private _buildIR(): string {
    const out: string[] = [];
    out.push('source_filename = "chadscript"');
    out.push('target triple = "arm64-apple-darwin25.3.0"');
    out.push("");

    for (const [name, info] of this._structs) {
      const fieldsStr = info.fields.length > 0 ? joinStrs(info.fields, ", ") : "";
      out.push("%" + name + " = type { " + fieldsStr + " }");
    }
    if (this._structs.size > 0) out.push("");

    for (let gi = 0; gi < this._globals.length; gi++) {
      out.push(this._globals[gi]);
    }
    for (const [name, ty] of this._globalTypes) {
      let found = false;
      const prefix = "@" + name + " =";
      for (let gi = 0; gi < this._globals.length; gi++) {
        if (this._globals[gi].startsWith(prefix)) { found = true; break; }
      }
      if (!found) {
        const linkage = this._globalLinkage.get(name) || "internal";
        const init = this._globalInit.get(name) || "zeroinitializer";
        out.push("@" + name + " = " + linkage + " global " + ty + " " + init);
      }
    }
    if (this._globalTypes.size > 0 || this._globals.length > 0) out.push("");

    const definedFns = new Set<string>();
    for (const [name, fnInfo] of this._functions) {
      if (fnInfo.blocks.length > 0) {
        definedFns.add(name);
      }
    }

    for (const [name, fnInfo] of this._functions) {
      if (!definedFns.has(name)) {
        const info = fnInfo.typeInfo;
        const paramList = joinStrs(info.params, ", ");
        const va = info.isVarArg ? (info.params.length > 0 ? ", ..." : "...") : "";
        out.push("declare " + info.ret + " @" + name + "(" + paramList + va + ")");
      }
    }
    out.push("");

    for (const [, fnInfo] of this._functions) {
      if (fnInfo.blocks.length === 0) continue;
      const info = fnInfo.typeInfo;
      const paramParts: string[] = [];
      for (let pi = 0; pi < info.params.length; pi++) {
        paramParts.push(info.params[pi] + " %" + pi);
      }
      const paramList = joinStrs(paramParts, ", ");
      const va = info.isVarArg ? (info.params.length > 0 ? ", ..." : "...") : "";
      out.push("define " + info.ret + " @" + fnInfo.name + "(" + paramList + va + ") {");
      for (const block of fnInfo.blocks) {
        out.push(block.name + ":");
        for (const phi of block.phis) {
          const incParts: string[] = [];
          for (let ii = 0; ii < phi.incoming.length; ii++) {
            const e = phi.incoming[ii];
            incParts.push("[ " + e.val + ", %" + e.block + " ]");
          }
          const inc = joinStrs(incParts, ", ");
          out.push("  " + phi.ref + " = phi " + phi.ty + " " + inc);
        }
        for (const line of block.lines) {
          out.push(line);
        }
        if (!block.hasTerminator) {
          out.push("  unreachable");
        }
      }
      out.push("}");
      out.push("");
    }

    return joinStrs(out, "\n") + "\n";
  }
}
