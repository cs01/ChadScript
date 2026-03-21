import { Expression } from "../../ast/types.js";
import { classifyTerminator } from "./terminator-classifier.js";
import {
  SymbolTable,
  SymbolKind,
  SymbolMetadata,
  SymbolKind_Number,
  SymbolKind_String,
  SymbolKind_Boolean,
  SymbolKind_Array,
  SymbolKind_StringArray,
  SymbolKind_BooleanArray,
  SymbolKind_ObjectArray,
  SymbolKind_Object,
  SymbolKind_Map,
  SymbolKind_Set,
  SymbolKind_Class,
  SymbolKind_Regex,
  SymbolKind_JSON,
  SymbolKind_ProcessArgv,
  SymbolKind_Closure,
  SymbolKind_Pointer,
  SymbolKind_Uint8Array,
  SymbolKind_Url,
  SymbolKind_UrlSearchParams,
} from "./symbol-table.js";
import type { ResolvedType } from "./type-system.js";

export {
  SymbolTable,
  SymbolKind,
  SymbolKind_Number,
  SymbolKind_String,
  SymbolKind_Boolean,
  SymbolKind_Array,
  SymbolKind_StringArray,
  SymbolKind_BooleanArray,
  SymbolKind_ObjectArray,
  SymbolKind_Object,
  SymbolKind_Map,
  SymbolKind_Set,
  SymbolKind_Class,
  SymbolKind_Regex,
  SymbolKind_JSON,
  SymbolKind_ProcessArgv,
  SymbolKind_Closure,
  SymbolKind_Pointer,
  SymbolKind_Uint8Array,
  SymbolKind_Url,
  SymbolKind_UrlSearchParams,
};

// ============================================
// BASE GENERATOR - Shared state and utilities
// ============================================

export class BaseGenerator {
  public tempCounter: number = 0;
  public allocaCounter: number = 0;
  public labelCounter: number = 0;
  public stringCounter: number = 0;
  public output: string[];
  public outputIsTerminator: number[] = [];
  public outputCount: number = 0;
  public allocaInstructions: string[]; // Collected allocas to hoist to entry block
  public globalStrings: string[];
  public globalStringsCount: number = 0;
  public currentLabel: string = "entry"; // Track current basic block label

  // Unified symbol table for named variables
  public symbolTable: SymbolTable;

  // Temporary register type tracking (for LLVM registers like %0, %1, etc)
  // Named variables use SymbolTable instead
  public variableTypes: Map<string, string>;

  // Expression type cache - maps expressions to their resolved types
  public expressionTypes: Map<Expression, ResolvedType>;

  // Actual class type tracking - when an interface-typed variable holds a class instance,
  // this maps the variable/register to its actual concrete class name for correct struct access
  public actualClassTypes: Map<string, string>;

  public thisPointer: string | null = null; // Current 'this' pointer (i32*)
  public currentClassName: string | null = null; // Current class name (for super resolution)
  public expectedArrayElementType: "string" | "number" | "boolean" | "pointer" | null = null; // Expected array element type for context-aware generation
  public expectedCallbackParamType: string | null = null;
  public expectedCallbackReturnType: string | null = null;
  public expectedCallbackParamTypes: string[] | null = null;
  public currentFunctionReturnType: string = "double"; // Current function/method return type for return statements

  public debugInfoEnabled: boolean = false;
  public currentDebugLocId: number = -1;

  // IMPORTANT: These fields must be at the END of the class field list to avoid
  // shifting GEP indices for existing fields in the native compiler.
  public lastInlineLambdaEnvPtr: string | null = null;
  public lastTypeAssertionSourceVar: string | null = null;
  public useBuilderAPI: boolean = false;

  constructor() {
    this.output = [];
    this.allocaInstructions = [];
    this.globalStrings = [];
    this.symbolTable = new SymbolTable();
    this.variableTypes = new Map();
    this.expressionTypes = new Map();
    this.actualClassTypes = new Map();
  }

  protected emitError(message: string): never {
    console.log("error: " + message);
    process.exit(1);
  }

  // Reset state for new function generation
  reset(): void {
    this.tempCounter = 0;
    this.allocaCounter = 0;
    this.labelCounter = 0;
    this.currentLabel = "entry";
    this.output.length = 0;
    this.outputIsTerminator.length = 0;
    this.outputCount = 0;
    this.allocaInstructions.length = 0;
    this.thisPointer = null;
    this.currentClassName = null;
    this.currentFunctionReturnType = "double";
    this.symbolTable.clearLocals();
    this.variableTypes.clear();
    this.expressionTypes.clear();
    this.actualClassTypes.clear();
    this.currentDebugLocId = -1;
  }

  // Helper to get next temp register (can be overridden)
  nextTemp(): string {
    return `%${this.tempCounter++}`;
  }

  // Helper to get a named alloca register for a variable
  // Named registers don't need to be in order like numbered ones
  // Include counter to handle same-name variables in different scopes
  nextAllocaReg(varName: string): string {
    const safeName = varName.replace(/[^a-zA-Z0-9_]/g, "_");
    const counter = this.allocaCounter++;
    return `%${safeName}.addr.${counter}`;
  }

  // Helper to get next label (can be overridden)
  nextLabel(prefix: string): string {
    const label = `${prefix}${this.labelCounter++}`;
    return label;
  }

  // Get the current label (basic block we're in)
  getCurrentLabel(): string {
    return this.currentLabel;
  }

  // Set the current label (call when emitting a new label)
  setCurrentLabel(label: string): void {
    this.currentLabel = label;
  }

  getThisPointer(): string | null {
    return this.thisPointer;
  }

  setThisPointer(ptr: string | null): void {
    this.thisPointer = ptr;
  }

  getCurrentClassName(): string | null {
    return this.currentClassName;
  }

  setCurrentClassName(name: string | null): void {
    this.currentClassName = name;
  }

  // Helper to get next string constant number (can be overridden)
  nextString(): string {
    return `@.str.${this.stringCounter++}`;
  }

  private byteToHex(b: number): string {
    const hexChars = "0123456789ABCDEF";
    const hi = hexChars.charAt((b >> 4) & 0xf);
    const lo = hexChars.charAt(b & 0xf);
    return hi + lo;
  }

  createStringConstant(value: string): string {
    const strId = this.nextString();
    let escaped = "";
    let byteCount = 0;
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      const code = value.charCodeAt(i);
      if (ch === "\\") {
        escaped += "\\\\";
        byteCount += 1;
      } else if (ch === "\n") {
        escaped += "\\0A";
        byteCount += 1;
      } else if (ch === "\r") {
        escaped += "\\0D";
        byteCount += 1;
      } else if (ch === "\t") {
        escaped += "\\09";
        byteCount += 1;
      } else if (ch === '"') {
        escaped += "\\22";
        byteCount += 1;
      } else if (code < 32 || code > 126) {
        if (code < 128) {
          escaped += "\\" + this.byteToHex(code);
          byteCount += 1;
        } else if (code < 0x800) {
          escaped += "\\" + this.byteToHex(0xc0 | (code >> 6));
          escaped += "\\" + this.byteToHex(0x80 | (code & 0x3f));
          byteCount += 2;
        } else if (code < 0x10000) {
          escaped += "\\" + this.byteToHex(0xe0 | (code >> 12));
          escaped += "\\" + this.byteToHex(0x80 | ((code >> 6) & 0x3f));
          escaped += "\\" + this.byteToHex(0x80 | (code & 0x3f));
          byteCount += 3;
        } else {
          escaped += "\\" + this.byteToHex(0xf0 | (code >> 18));
          escaped += "\\" + this.byteToHex(0x80 | ((code >> 12) & 0x3f));
          escaped += "\\" + this.byteToHex(0x80 | ((code >> 6) & 0x3f));
          escaped += "\\" + this.byteToHex(0x80 | (code & 0x3f));
          byteCount += 4;
        }
      } else {
        escaped += ch;
        byteCount += 1;
      }
    }
    const len = byteCount + 1;
    this.globalStrings.push(
      strId + " = private unnamed_addr constant [" + len + ' x i8] c"' + escaped + '\\00", align 1',
    );
    return strId;
  }

  // Helper to get size of double in i64 (platform-independent)
  getDoubleSize(): string {
    const sizePtr = this.nextTemp();
    this.emit(`${sizePtr} = getelementptr double, double* null, i32 1`);
    const size = this.nextTemp();
    this.emit(`${size} = ptrtoint double* ${sizePtr} to i64`);
    return size;
  }

  // Add instruction to output
  emit(instruction: string) {
    if (instruction.startsWith("store ")) {
      this.validateStoreInstruction(instruction);
    } else if (instruction.includes(" = phi ")) {
      this.validatePhiInstruction(instruction);
    } else if (instruction.includes(" = load ")) {
      this.validateLoadInstruction(instruction);
    } else if (instruction.includes(" = getelementptr ")) {
      this.validateGepInstruction(instruction);
    }
    const dbgInstruction = this.maybeAppendDbg(instruction);
    const allocaIdx = dbgInstruction.indexOf(" = alloca ");
    if (allocaIdx > 0) {
      const regName = dbgInstruction.substring(0, allocaIdx).trim();
      const isNamedReg = regName.length > 1 && regName.charAt(1) >= "A";
      if (isNamedReg) {
        this.allocaInstructions.push(dbgInstruction);
      } else {
        this.output.push(dbgInstruction);
        this.outputIsTerminator.push(0);
        this.outputCount++;
      }
    } else {
      this.output.push(dbgInstruction);
      this.outputIsTerminator.push(this.classifyTerminator(dbgInstruction));
      this.outputCount++;
    }
    const trimmedInstruction = dbgInstruction.trim();
    if (trimmedInstruction.endsWith(":")) {
      const label = trimmedInstruction.slice(0, trimmedInstruction.length - 1);
      this.currentLabel = label;
    }
  }

  private maybeAppendDbg(instruction: string): string {
    if (!this.debugInfoEnabled || this.currentDebugLocId < 0) return instruction;
    const trimmed = instruction.trim();
    if (trimmed.length === 0) return instruction;
    if (trimmed.endsWith(":")) return instruction;
    if (trimmed.startsWith(";")) return instruction;
    if (trimmed.indexOf("!dbg") !== -1) return instruction;
    if (trimmed.indexOf(" = alloca ") !== -1) return instruction;
    return instruction + `, !dbg !${this.currentDebugLocId}`;
  }

  private validateStoreInstruction(instruction: string): void {
    const afterStore = instruction.substring(6);
    const firstSpace = afterStore.indexOf(" ");
    if (firstSpace <= 0) return;

    const valueType = afterStore.substring(0, firstSpace);
    const commaPos = instruction.indexOf(",");
    if (commaPos <= 0) return;

    const afterComma = instruction.substring(commaPos + 2);
    const ptrTypeEnd = afterComma.indexOf(" ");
    if (ptrTypeEnd <= 0) return;

    const ptrType = afterComma.substring(0, ptrTypeEnd);
    if (!ptrType.endsWith("*")) return;

    const expectedType = ptrType.substring(0, ptrType.length - 1);
    if (valueType !== expectedType) {
      this.emitError(
        `LLVM type mismatch in store: value type is '${valueType}' but pointer expects '${expectedType}'. Instruction: ${instruction}`,
      );
    }
  }

  private validatePhiInstruction(instruction: string): void {
    const phiIdx = instruction.indexOf(" = phi ");
    if (phiIdx < 0) return;

    const afterPhi = instruction.substring(phiIdx + 7);
    const typeEnd = afterPhi.indexOf(" ");
    if (typeEnd <= 0) return;

    const declaredType = afterPhi.substring(0, typeEnd);
    const branches = afterPhi.substring(typeEnd);
    const bracketParts = branches.split("[");

    for (let i = 1; i < bracketParts.length; i++) {
      const part = bracketParts[i];
      const closeBracket = part.indexOf("]");
      if (closeBracket <= 0) continue;

      const content = part.substring(0, closeBracket).trim();
      const commaPos = content.indexOf(",");
      if (commaPos <= 0) continue;

      const value = content.substring(0, commaPos).trim();

      if (declaredType === "double") {
        if (value.startsWith("@") || (value.startsWith("%") && !this.looksLikeDouble(value))) {
          const lookupType = this.variableTypes.get(value);
          if (lookupType && lookupType !== "double") {
            this.emitError(
              `LLVM phi type mismatch: declared type is '${declaredType}' but branch value '${value}' has type '${lookupType}'. Instruction: ${instruction}`,
            );
          }
        }
      } else if (declaredType.endsWith("*")) {
        if (this.looksLikeDoubleValue(value)) {
          this.emitError(
            `LLVM phi type mismatch: declared type is '${declaredType}' but branch value '${value}' looks like a double. Instruction: ${instruction}`,
          );
        }
      }
    }
  }

  private looksLikeDouble(value: string): boolean {
    if (!value.startsWith("%")) return false;
    const regType = this.variableTypes.get(value);
    return regType === "double" || regType === undefined;
  }

  private looksLikeDoubleValue(value: string): boolean {
    if (value === "0.0" || value === "1.0") return true;
    if (value.includes(".") && !value.includes("%")) {
      for (let i = 0; i < value.length; i++) {
        const ch = value.charAt(i);
        if (ch !== "." && ch !== "-" && (ch < "0" || ch > "9")) {
          return false;
        }
      }
      return value.length > 0;
    }
    return false;
  }

  private findTopLevelComma(str: string): number {
    let depth = 0;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charAt(i);
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === "," && depth === 0) return i;
    }
    return -1;
  }

  private validateLoadInstruction(instruction: string): void {
    const loadIdx = instruction.indexOf(" = load ");
    if (loadIdx < 0) return;

    const afterLoad = instruction.substring(loadIdx + 8);
    const commaPos = this.findTopLevelComma(afterLoad);
    if (commaPos <= 0) return;

    const loadType = afterLoad.substring(0, commaPos).trim();
    const afterComma = afterLoad.substring(commaPos + 1).trim();
    const ptrTypeEnd = afterComma.indexOf(" ");
    if (ptrTypeEnd <= 0) return;

    const ptrType = afterComma.substring(0, ptrTypeEnd).trim();
    if (!ptrType.endsWith("*")) return;

    const expectedType = ptrType.substring(0, ptrType.length - 1);
    if (loadType !== expectedType) {
      this.emitError(
        `LLVM type mismatch in load: loading type '${loadType}' but pointer has type '${ptrType}' (expects '${expectedType}'). Instruction: ${instruction}`,
      );
    }
  }

  private validateGepInstruction(instruction: string): void {
    const gepIdx = instruction.indexOf(" = getelementptr ");
    if (gepIdx < 0) return;

    const afterGep = instruction.substring(gepIdx + 17);
    const parts = afterGep.split(",");
    if (parts.length < 2) return;

    for (let i = 2; i < parts.length; i++) {
      const part = parts[i].trim();
      const spaceIdx = part.indexOf(" ");
      if (spaceIdx <= 0) continue;

      const indexValue = part.substring(spaceIdx + 1).trim();
      if (indexValue.startsWith("-")) {
        this.emitError(
          `LLVM GEP with negative index: '${indexValue}'. Instruction: ${instruction}`,
        );
      }
      const numIndex = parseInt(indexValue, 10);
      if (!isNaN(numIndex) && numIndex > 500) {
        this.emitError(
          `LLVM GEP with suspiciously large index: '${indexValue}'. Instruction: ${instruction}`,
        );
      }
    }
  }

  // Get all output
  getOutput(): string[] {
    return this.output;
  }

  // Get collected alloca instructions (hoisted to entry block)
  getAllocaInstructions(): string[] {
    return this.allocaInstructions;
  }

  // Get global strings
  getGlobalStrings(): string[] {
    return this.globalStrings;
  }

  // Push a global string constant
  pushGlobalString(str: string): void {
    this.globalStrings.push(str);
  }

  protected classifyTerminator(instruction: string): number {
    return classifyTerminator(instruction);
  }

  lastInstructionIsTerminator(): boolean {
    const len = this.outputIsTerminator.length;
    if (len === 0) return false;
    return this.outputIsTerminator[len - 1] !== 0;
  }

  emitRet(type: string, value: string): void {
    this.emit(`ret ${type} ${value}`);
  }

  emitRetVoid(): void {
    this.emit("ret void");
  }

  emitBr(label: string): void {
    this.emit(`br label %${label}`);
  }

  emitBrCond(cond: string, thenLabel: string, elseLabel: string): void {
    this.emit(`br i1 ${cond}, label %${thenLabel}, label %${elseLabel}`);
  }

  emitUnreachable(): void {
    this.emit("unreachable");
  }

  emitLabel(name: string): void {
    this.emit(`${name}:`);
  }

  emitCall(retType: string, func: string, args: string): string {
    const temp = this.nextTemp();
    this.emit(`${temp} = call ${retType} ${func}(${args})`);
    this.setVariableType(temp, retType);
    return temp;
  }

  emitCallVoid(func: string, args: string): void {
    this.emit(`call void ${func}(${args})`);
  }

  emitLoad(type: string, ptr: string): string {
    const temp = this.nextTemp();
    this.emit(`${temp} = load ${type}, ${type}* ${ptr}`);
    this.setVariableType(temp, type);
    return temp;
  }

  emitStore(type: string, value: string, ptr: string): void {
    this.emit(`store ${type} ${value}, ${type}* ${ptr}`);
  }

  emitGep(baseType: string, ptr: string, indices: string): string {
    const temp = this.nextTemp();
    this.emit(`${temp} = getelementptr ${baseType}, ${baseType}* ${ptr}, ${indices}`);
    return temp;
  }

  emitIcmp(pred: string, type: string, lhs: string, rhs: string): string {
    const temp = this.nextTemp();
    this.emit(`${temp} = icmp ${pred} ${type} ${lhs}, ${rhs}`);
    this.setVariableType(temp, "i1");
    return temp;
  }

  emitBitcast(value: string, fromType: string, toType: string): string {
    const temp = this.nextTemp();
    this.emit(`${temp} = bitcast ${fromType} ${value} to ${toType}`);
    this.setVariableType(temp, toType);
    return temp;
  }

  // ============================================
  // Symbol table convenience methods
  // ============================================

  /**
   * Define a variable in the symbol table
   */
  defineVariable(name: string, allocaReg: string, llvmType: string, kind: number, scope: string) {
    this.symbolTable.define(name, kind, llvmType, allocaReg, scope);
  }

  defineVariableWithMetadata(
    name: string,
    allocaReg: string,
    llvmType: string,
    kind: number,
    scope: string,
    metadata: SymbolMetadata,
  ) {
    this.symbolTable.defineWithMetadata(name, kind, llvmType, allocaReg, scope, metadata);
  }

  /**
   * Lookup variable type
   * Checks SymbolTable for named variables, then variableTypes for temporary registers
   */
  getVariableType(name: string): string | undefined {
    if (!name) return undefined;
    // Check named variables in SymbolTable first
    const symbolType = this.symbolTable.getType(name);
    if (symbolType) return symbolType;

    // Fall back to temporary register types
    return this.variableTypes.get(name);
  }

  /**
   * Check if a variable type exists
   */
  hasVariableType(name: string): boolean {
    return this.getVariableType(name) !== undefined;
  }

  /**
   * Set type for a temporary register
   */
  setVariableType(name: string, type: string): void {
    if (type === "unknown") {
      this.emitError(
        `Cannot set type 'unknown' for register '${name}'. Type inference failed in the codegen pipeline.`,
      );
    }
    this.variableTypes.set(name, type);
  }

  setActualClassType(name: string, className: string): void {
    this.actualClassTypes.set(name, className);
  }

  getActualClassType(name: string): string | undefined {
    return this.actualClassTypes.get(name);
  }

  /**
   * Get cached type for an expression
   */
  getExpressionType(expr: Expression): ResolvedType | undefined {
    return this.expressionTypes.get(expr);
  }

  /**
   * Cache type for an expression
   */
  setExpressionType(expr: Expression, type: ResolvedType): void {
    if (type.base === "unknown") {
      this.emitError(
        `Cannot cache 'unknown' type for expression of type '${expr.type}'. Type resolution failed.`,
      );
    }
    this.expressionTypes.set(expr, type);
  }

  /**
   * Lookup variable alloca
   */
  getVariableAlloca(name: string): string | undefined {
    return this.symbolTable.getAlloca(name);
  }

  /**
   * Check if variable is a string
   */
  isStringVariable(name: string): boolean {
    return this.symbolTable.isString(name);
  }

  /**
   * Check if variable is an array
   */
  isArrayVariable(name: string): boolean {
    return this.symbolTable.isArray(name);
  }

  ensureDouble(value: string): string {
    const vt = this.getVariableType(value);
    if (vt === "i64") {
      const temp = this.nextTemp();
      this.emit(`${temp} = sitofp i64 ${value} to double`);
      this.setVariableType(temp, "double");
      return temp;
    }
    return value;
  }

  ensureI64(value: string): string {
    const vt = this.getVariableType(value);
    if (vt === "double") {
      const temp = this.nextTemp();
      this.emit(`${temp} = fptosi double ${value} to i64`);
      this.setVariableType(temp, "i64");
      return temp;
    }
    return value;
  }
}
