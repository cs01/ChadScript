import { Expression } from '../../ast/types.js';
import { SymbolTable, SymbolKind, SymbolMetadata } from './symbol-table.js';
import type { ResolvedType } from './type-system.js';

// Re-export for convenience
export { SymbolTable, SymbolKind };

// ============================================
// BASE GENERATOR - Shared state and utilities
// ============================================

export class BaseGenerator {
  public tempCounter: number = 0;
  public labelCounter: number = 0;
  public stringCounter: number = 0;
  public output: string[] = [];
  public globalStrings: string[] = [];
  public currentLabel: string = 'entry'; // Track current basic block label

  // Unified symbol table for named variables
  public symbolTable: SymbolTable = new SymbolTable();

  // Temporary register type tracking (for LLVM registers like %0, %1, etc)
  // Named variables use SymbolTable instead
  public variableTypes: Map<string, string> = new Map();

  // Expression type cache - maps expressions to their resolved types
  public expressionTypes: Map<Expression, ResolvedType> = new Map();

  public thisPointer: string | null = null; // Current 'this' pointer (i32*)
  public currentClassName: string | null = null; // Current class name (for super resolution)
  public expectedArrayElementType: 'string' | 'number' | 'boolean' | null = null; // Expected array element type for context-aware generation
  public expectedCallbackParamType: string | null = null; // Expected callback parameter type for lambda generation
  public currentFunctionReturnType: string = 'double'; // Current function/method return type for return statements

  constructor() {}

  // Reset state for new function generation
  reset() {
    this.tempCounter = 0;
    this.labelCounter = 0;
    this.currentLabel = 'entry';
    this.output = [];

    // Clear unified symbol table (preserve globals)
    this.symbolTable.clearLocals();

    // Clear temporary register types
    this.variableTypes.clear();

    // Clear expression type cache
    this.expressionTypes.clear();

    this.thisPointer = null;
    this.currentClassName = null;
    this.currentFunctionReturnType = 'double';
  }

  // Helper to get next temp register (can be overridden)
  nextTemp(): string {
    return `%${this.tempCounter++}`;
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
  setCurrentLabel(label: string) {
    this.currentLabel = label;
  }

  // Helper to get next string constant number (can be overridden)
  nextString(): string {
    return `@.str.${this.stringCounter++}`;
  }

  private byteToHex(b: number): string {
    const hexChars = '0123456789ABCDEF';
    const hi = hexChars.charAt((b >> 4) & 0xF);
    const lo = hexChars.charAt(b & 0xF);
    return hi + lo;
  }

  createStringConstant(value: string): string {
    const strId = this.nextString();
    let escaped = '';
    let byteCount = 0;
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      const code = value.charCodeAt(i);
      if (ch === '\\') {
        escaped += '\\\\';
        byteCount += 1;
      } else if (ch === '\n') {
        escaped += '\\0A';
        byteCount += 1;
      } else if (ch === '\r') {
        escaped += '\\0D';
        byteCount += 1;
      } else if (ch === '\t') {
        escaped += '\\09';
        byteCount += 1;
      } else if (ch === '"') {
        escaped += '\\"';
        byteCount += 1;
      } else if (code < 32 || code > 126) {
        if (code < 128) {
          escaped += '\\' + this.byteToHex(code);
          byteCount += 1;
        } else if (code < 0x800) {
          escaped += '\\' + this.byteToHex(0xC0 | (code >> 6));
          escaped += '\\' + this.byteToHex(0x80 | (code & 0x3F));
          byteCount += 2;
        } else if (code < 0x10000) {
          escaped += '\\' + this.byteToHex(0xE0 | (code >> 12));
          escaped += '\\' + this.byteToHex(0x80 | ((code >> 6) & 0x3F));
          escaped += '\\' + this.byteToHex(0x80 | (code & 0x3F));
          byteCount += 3;
        } else {
          escaped += '\\' + this.byteToHex(0xF0 | (code >> 18));
          escaped += '\\' + this.byteToHex(0x80 | ((code >> 12) & 0x3F));
          escaped += '\\' + this.byteToHex(0x80 | ((code >> 6) & 0x3F));
          escaped += '\\' + this.byteToHex(0x80 | (code & 0x3F));
          byteCount += 4;
        }
      } else {
        escaped += ch;
        byteCount += 1;
      }
    }
    const len = byteCount + 1;
    this.globalStrings.push(`${strId} = private unnamed_addr constant [${len} x i8] c"${escaped}\\00", align 1`);
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
    if (instruction.startsWith('store ')) {
      this.validateStoreInstruction(instruction);
    } else if (instruction.includes(' = phi ')) {
      this.validatePhiInstruction(instruction);
    }
    this.output.push(instruction);
    if (instruction.trim().endsWith(':')) {
      const label = instruction.trim().slice(0, -1);
      this.currentLabel = label;
    }
  }

  private validateStoreInstruction(instruction: string): void {
    const afterStore = instruction.substring(6);
    const firstSpace = afterStore.indexOf(' ');
    if (firstSpace <= 0) return;

    const valueType = afterStore.substring(0, firstSpace);
    const commaPos = instruction.indexOf(',');
    if (commaPos <= 0) return;

    const afterComma = instruction.substring(commaPos + 2);
    const ptrTypeEnd = afterComma.indexOf(' ');
    if (ptrTypeEnd <= 0) return;

    const ptrType = afterComma.substring(0, ptrTypeEnd);
    if (!ptrType.endsWith('*')) return;

    const expectedType = ptrType.substring(0, ptrType.length - 1);
    if (valueType !== expectedType) {
      throw new Error(
        `LLVM type mismatch in store: value type is '${valueType}' but pointer expects '${expectedType}'\n` +
        `  Instruction: ${instruction}\n` +
        `  This usually means an expression returned a wrong type (e.g., ptr instead of double)`
      );
    }
  }

  private validatePhiInstruction(instruction: string): void {
    const phiIdx = instruction.indexOf(' = phi ');
    if (phiIdx < 0) return;

    const afterPhi = instruction.substring(phiIdx + 7);
    const typeEnd = afterPhi.indexOf(' ');
    if (typeEnd <= 0) return;

    const declaredType = afterPhi.substring(0, typeEnd);
    const branches = afterPhi.substring(typeEnd);
    const bracketParts = branches.split('[');

    for (let i = 1; i < bracketParts.length; i++) {
      const part = bracketParts[i];
      const closeBracket = part.indexOf(']');
      if (closeBracket <= 0) continue;

      const content = part.substring(0, closeBracket).trim();
      const commaPos = content.indexOf(',');
      if (commaPos <= 0) continue;

      const value = content.substring(0, commaPos).trim();

      if (declaredType === 'double') {
        if (value.startsWith('@') || (value.startsWith('%') && !this.looksLikeDouble(value))) {
          const lookupType = this.variableTypes.get(value);
          if (lookupType && lookupType !== 'double') {
            throw new Error(
              `LLVM phi type mismatch: declared type is '${declaredType}' but branch value '${value}' has type '${lookupType}'\n` +
              `  Instruction: ${instruction}\n` +
              `  This usually means a conditional expression has mismatched branch types`
            );
          }
        }
      } else if (declaredType.endsWith('*')) {
        if (this.looksLikeDoubleValue(value)) {
          throw new Error(
            `LLVM phi type mismatch: declared type is '${declaredType}' but branch value '${value}' looks like a double\n` +
            `  Instruction: ${instruction}\n` +
            `  This usually means a conditional expression has mismatched branch types`
          );
        }
      }
    }
  }

  private looksLikeDouble(value: string): boolean {
    if (!value.startsWith('%')) return false;
    const regType = this.variableTypes.get(value);
    return regType === 'double' || regType === undefined;
  }

  private looksLikeDoubleValue(value: string): boolean {
    if (value === '0.0' || value === '1.0') return true;
    if (value.includes('.') && !value.includes('%')) {
      const num = parseFloat(value);
      return !isNaN(num);
    }
    return false;
  }

  // Get all output
  getOutput(): string[] {
    return this.output;
  }

  // Get global strings
  getGlobalStrings(): string[] {
    return this.globalStrings;
  }

  // ============================================
  // Symbol table convenience methods
  // ============================================

  /**
   * Define a variable in the symbol table
   */
  defineVariable(name: string, allocaReg: string, llvmType: string, kind: SymbolKind, scope: 'local' | 'global' = 'local', metadata?: SymbolMetadata) {
    this.symbolTable.define(name, kind, llvmType, allocaReg, scope, metadata);
  }

  /**
   * Lookup variable type
   * Checks SymbolTable for named variables, then variableTypes for temporary registers
   */
  getVariableType(name: string): string | undefined {
    // Check named variables in SymbolTable first
    const symbolType = this.symbolTable.getType(name);
    if (symbolType) return symbolType;

    // Fall back to temporary register types
    return this.variableTypes.get(name);
  }

  /**
   * Set type for a temporary register
   */
  setVariableType(name: string, type: string): void {
    this.variableTypes.set(name, type);
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
}
