import { Expression } from '../../ast/types.js';
import { SymbolTable, SymbolKind } from '../symbol-table.js';

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

  // Unified symbol table (NEW - replaces all 12 maps below)
  public symbolTable: SymbolTable = new SymbolTable();

  // Variable tracking (LEGACY - kept for backward compatibility during migration)
  public variables: Map<string, string> = new Map(); // Variable name -> alloca register
  public variableTypes: Map<string, string> = new Map(); // Variable name -> LLVM type (e.g., 'i32', 'i8*', '%Array*')
  public stringVariables: Map<string, string> = new Map(); // i8* variables (deprecated - use symbolTable)
  public arrayVariables: Map<string, string> = new Map(); // %Array variables (deprecated - use symbolTable)
  public stringArrayVariables: Map<string, string> = new Map(); // %StringArray variables (deprecated - use symbolTable)
  public objectVariables: Map<string, { ptr: string; keys: string[]; types: string[] }> = new Map();
  public mapVariables: Map<string, string> = new Map(); // %Map variables
  public setVariables: Map<string, string> = new Map(); // %Set variables
  public classInstanceVariables: Map<string, { ptr: string; className: string }> = new Map(); // i32* class instances
  public regexVariables: Map<string, string> = new Map(); // i8* regex pointers
  public jsonObjectVariables: Map<string, string> = new Map(); // i8* cJSON object pointers
  public processArgvVariables: Set<string> = new Set(); // i8** process.argv pointers
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

    // Clear legacy maps (for backward compatibility during migration)
    this.variables = new Map();
    this.variableTypes = new Map();  // CRITICAL: Clear type tracking!
    this.stringVariables = new Map();
    this.arrayVariables = new Map();
    this.stringArrayVariables = new Map();
    this.objectVariables = new Map();
    this.mapVariables = new Map();
    this.setVariables = new Map();
    this.classInstanceVariables = new Map();
    this.regexVariables = new Map();
    this.jsonObjectVariables = new Map();
    this.processArgvVariables = new Set();
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
  // Adapter methods for gradual SymbolTable migration
  // These methods update BOTH old maps and new SymbolTable
  // ============================================

  /**
   * Define a variable in both legacy maps and new SymbolTable
   */
  defineVariable(name: string, allocaReg: string, llvmType: string, kind: SymbolKind, scope: 'local' | 'global' = 'local', metadata?: any) {
    // Update legacy maps
    this.variables.set(name, allocaReg);
    this.variableTypes.set(name, llvmType);

    // Update specific legacy maps based on kind
    if (kind === SymbolKind.String) {
      this.stringVariables.set(name, allocaReg);
    } else if (kind === SymbolKind.Array) {
      this.arrayVariables.set(name, allocaReg);
    } else if (kind === SymbolKind.StringArray) {
      this.stringArrayVariables.set(name, allocaReg);
    } else if (kind === SymbolKind.Object && metadata?.objectMetadata) {
      this.objectVariables.set(name, {
        ptr: allocaReg,
        keys: metadata.objectMetadata.keys,
        types: metadata.objectMetadata.types
      });
    } else if (kind === SymbolKind.Map) {
      this.mapVariables.set(name, allocaReg);
    } else if (kind === SymbolKind.Set) {
      this.setVariables.set(name, allocaReg);
    } else if (kind === SymbolKind.Class && metadata?.classMetadata) {
      this.classInstanceVariables.set(name, {
        ptr: allocaReg,
        className: metadata.classMetadata.className
      });
    } else if (kind === SymbolKind.Regex) {
      this.regexVariables.set(name, allocaReg);
    } else if (kind === SymbolKind.JSON) {
      this.jsonObjectVariables.set(name, allocaReg);
    } else if (kind === SymbolKind.ProcessArgv) {
      this.processArgvVariables.add(name);
    }

    // Update new SymbolTable
    this.symbolTable.define(name, kind, llvmType, allocaReg, scope, metadata);
  }

  /**
   * Lookup variable type (checks SymbolTable first, falls back to legacy)
   */
  getVariableType(name: string): string | undefined {
    return this.symbolTable.getType(name) || this.variableTypes.get(name);
  }

  /**
   * Lookup variable alloca (checks SymbolTable first, falls back to legacy)
   */
  getVariableAlloca(name: string): string | undefined {
    return this.symbolTable.getAlloca(name) || this.variables.get(name);
  }

  /**
   * Check if variable is a string (checks SymbolTable first)
   */
  isStringVariable(name: string): boolean {
    return this.symbolTable.isString(name) || this.stringVariables.has(name);
  }

  /**
   * Check if variable is an array (checks SymbolTable first)
   */
  isArrayVariable(name: string): boolean {
    return this.symbolTable.isArray(name) || this.arrayVariables.has(name) || this.stringArrayVariables.has(name);
  }
}
