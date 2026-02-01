import { Expression } from '../../ast/types.js';
import { SymbolTable, SymbolKind, SymbolMetadata } from './symbol-table.js';

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

  public thisPointer: string | null = null; // Current 'this' pointer (i32*)
  public currentClassName: string | null = null; // Current class name (for super resolution)
  public expectedArrayElementType: 'string' | 'number' | 'boolean' | null = null; // Expected array element type for context-aware generation
  public currentFunctionReturnType: string = 'double'; // Current function/method return type for return statements

  constructor() {}

  // Reset state for new function generation
  reset() {
    this.tempCounter = 0;
    this.labelCounter = 0;
    this.currentLabel = 'entry';
    this.output = [];

    // Clear unified symbol table
    this.symbolTable.clear();

    // Clear temporary register types
    this.variableTypes.clear();

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

  // Create a string constant and add it to global strings
  createStringConstant(value: string): string {
    const strId = this.nextString();
    // Escape special characters for LLVM string constants
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\0A')
      .replace(/"/g, '\\"')
      .replace(/\r/g, '\\0D')
      .replace(/\t/g, '\\09');
    const len = value.length + 1; // +1 for null terminator
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
    this.output.push(instruction);
    // If this is a label definition, update current label
    if (instruction.trim().endsWith(':')) {
      const label = instruction.trim().slice(0, -1);
      this.currentLabel = label;
    }
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
