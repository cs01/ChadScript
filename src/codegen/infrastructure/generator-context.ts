/**
 * Generator Context - Explicit interface for sub-generator dependencies
 *
 * Replaces callback binding pattern with explicit dependency injection.
 * Sub-generators receive a context object that provides access to parent
 * generator capabilities without tight coupling through .bind().
 *
 * Before (callback binding):
 * ```typescript
 * this.arrayGen.generateExpression = this.generateExpression.bind(this);
 * this.arrayGen.nextTemp = this.nextTemp.bind(this);
 * ```
 *
 * After (explicit context):
 * ```typescript
 * const context: IGeneratorContext = this;
 * this.arrayGen = new ArrayGenerator(context);
 * ```
 */

import { Expression, BlockStatement, AST, CallNode } from '../../ast/types.js';
import { SymbolTable, SymbolKind, SymbolMetadata } from './symbol-table.js';
import type { TypeChecker } from '../../typescript/type-checker.js';
import type { TypeResolver } from './type-resolver/index.js';
import type { ResolvedType } from './type-system.js';
import type { InterfaceStructGenerator } from '../types/interface-struct-generator.js';

interface ExprBase { type: string; }

export interface IClassGenContext {
  getFieldInfo(className: string, fieldName: string): { index: number; type: string; tsType?: string } | null;
  getClassFields(className: string): { name: string; fieldType: string }[];
  thisPointer?: string | null;
  currentClassName?: string | null;
}

export interface IStringGenerator {
  createStringConstant(value: string): string;
  convertNumberToString(numValue: string): string;
  generateStringConcat(left: Expression, right: Expression, params: string[]): string;
  generateStringConcatDirect(left: string, right: string): string;
}

export interface IStringMapGenerator {
  generateStringMapEntries(mapPtr: string): string;
}

/**
 * Interface defining what sub-generators need from parent generator.
 * This makes dependencies explicit and testable.
 */
export interface IGeneratorContext {
  // ============================================
  // Expression and Block Generation
  // ============================================

  /**
   * Generate LLVM IR for an expression.
   * Sub-generators call this to recursively generate nested expressions.
   */
  generateExpression(expr: Expression, params: string[]): string;

  /**
   * Generate LLVM IR for a block statement.
   * Used by control flow generators for if/while/for bodies.
   */
  generateBlock(block: BlockStatement, params: string[]): string | null;

  // ============================================
  // Type Checking Predicates
  // ============================================

  /**
   * Check if expression evaluates to a string
   */
  isStringExpression(expr: Expression): boolean;

  /**
   * Check if expression evaluates to an array
   */
  isArrayExpression(expr: Expression): boolean;

  /**
   * Check if expression evaluates to a string array
   */
  isStringArrayExpression(expr: Expression): boolean;

  /**
   * Check if expression evaluates to an object array (like InterfaceField[])
   */
  isObjectArrayExpression(expr: Expression): boolean;

  /**
   * Check if expression evaluates to an object
   */
  isObjectExpression(expr: Expression): boolean;

  // ============================================
  // Register and Label Allocation
  // ============================================

  /**
   * Allocate a new temporary register
   * Returns: %0, %1, %2, etc.
   */
  nextTemp(): string;

  /**
   * Allocate a named register for a variable alloca
   * Returns: %varname.addr.0, %varname.addr.1, etc.
   * Named allocas don't need to follow sequential ordering
   */
  nextAllocaReg(varName: string): string;

  /**
   * Allocate a new label
   * Returns: prefix0, prefix1, prefix2, etc.
   */
  nextLabel(prefix: string): string;

  /**
   * Allocate a new string constant
   * Returns: @.str.0, @.str.1, etc.
   */
  nextString(): string;

  /**
   * Get the size of a double in bytes (generates LLVM IR)
   * Used for array memory allocation
   */
  getDoubleSize(): string;

  /**
   * Create a string constant and add it to global strings
   * Returns: @.str.N (the string ID)
   *
   * @example
   * ```typescript
   * const formatStr = ctx.createStringConstant('%s\n');
   * ctx.emit(`call i32 @printf(i8* ${formatStr}, i8* %arg)`);
   * ```
   */
  createStringConstant(value: string): string;

  // ============================================
  // Variable Definition
  // ============================================

  /**
   * Define a variable in both legacy maps and new SymbolTable
   * This method updates all tracking structures for a variable
   */
  defineVariable(
    name: string,
    allocaReg: string,
    llvmType: string,
    kind: import('./symbol-table.js').SymbolKind,
    scope?: 'local' | 'global',
    metadata?: SymbolMetadata
  ): void;

  /**
   * Lookup variable type (checks SymbolTable first, falls back to legacy)
   */
  getVariableType(name: string): string | undefined;

  /**
   * Lookup variable alloca (checks SymbolTable first, falls back to legacy)
   */
  getVariableAlloca(name: string): string | undefined;

  /**
   * Set type for a temporary register (used for LLVM registers like %0, %1, etc)
   */
  setVariableType(name: string, type: string): void;

  // ============================================
  // Output Buffer
  // ============================================

  /**
   * Emit an LLVM instruction to the output buffer
   */
  emit(instruction: string): void;

  /**
   * Get current basic block label
   */
  getCurrentLabel(): string;

  /**
   * Set current basic block label
   */
  setCurrentLabel(label: string): void;

  // ============================================
  // State Access
  // ============================================

  /**
   * Access to symbol table for variable lookups
   */
  readonly symbolTable: SymbolTable;

  /**
   * Access to global string constants
   */
  readonly globalStrings: string[];

  /**
   * Current function return type (for return statement generation)
   */
  currentFunctionReturnType: string;

  /**
   * Current function TypeScript return type (for inline interface object generation)
   */
  currentFunctionTsReturnType: string | undefined;

  /**
   * Expected array element type (for type-aware array generation)
   */
  expectedArrayElementType: 'string' | 'number' | 'boolean' | 'pointer' | null;

  /**
   * Expected callback parameter type (for type-aware lambda generation)
   */
  expectedCallbackParamType: string | null;

  /**
   * Expected callback return type (for type-aware lambda generation)
   */
  expectedCallbackReturnType: string | null;

  /**
   * Current 'this' pointer for class methods
   */
  thisPointer: string | null;

  /**
   * Current class name for super resolution
   */
  currentClassName: string | null;

  // ============================================
  // Variable Type Tracking
  // ============================================

  /**
   * Temporary register type tracking (for LLVM registers like %0, %1, etc)
   * Named variables use SymbolTable instead
   */
  readonly variableTypes: Map<string, string>;

  /**
   * Actual class type tracking - maps interface-typed variables to their concrete class type
   */
  readonly actualClassTypes: Map<string, string>;

  /**
   * Expression type cache - maps expressions to their resolved types
   * Caches type inference results to avoid repeated computation
   */
  readonly expressionTypes: Map<Expression, ResolvedType>;

  /**
   * Get or compute the type of an expression
   * Returns undefined if type cannot be determined
   */
  getExpressionType(expr: Expression): ResolvedType | undefined;

  /**
   * Cache an expression's type for future lookups
   */
  setExpressionType(expr: Expression, type: ResolvedType): void;

  setActualClassType(name: string, className: string): void;

  getActualClassType(name: string): string | undefined;

  /**
   * LLVM IR output buffer
   * Used to check for terminators and other instruction analysis
   */
  readonly output: string[];

  /**
   * Collected alloca instructions to be hoisted to entry block
   * Allocas inside loops cause stack overflow - they must be at function start
   */
  readonly allocaInstructions: string[];

  /**
   * Current label for tracking control flow position
   * Accessed via getCurrentLabel/setCurrentLabel methods
   */
  currentLabel: string;

  // ============================================
  // AST Access
  // ============================================

  /**
   * Access to full AST (needed for class/function lookups)
   */
  readonly ast?: AST;

  /**
   * Get the cached count of classes in the AST
   */
  getClassesCount(): number;

  /**
   * Cached count of classes in the AST (for safe access without method call)
   */
  readonly classesCount?: number;

  /**
   * Access to interface struct generator (for interface type lookups)
   */
  readonly interfaceStructGen?: InterfaceStructGenerator;

  // ============================================
  // Extended Context (for sub-generators)
  // ============================================

  /**
   * TypeScript type checker for compile-time type analysis
   */
  readonly typeChecker?: TypeChecker | null;

  /**
   * Consolidated type resolution (interfaces, unions, type guards)
   */
  readonly typeResolver?: TypeResolver;

  /**
   * Whether the current compilation uses Promises
   */
  usesPromises: boolean;

  /**
   * Whether the current compilation uses timers (setTimeout/setInterval)
   */
  usesTimers: boolean;

  /**
   * Current function name for type resolution
   */
  currentFunction: string | null;

  /**
   * Sync state from parent generator to all sub-generators.
   * Called before operations that need current variable tracking state.
   */
  syncStateToGenerators(): void;

  /**
   * String generator for string operations
   */
  readonly stringGen: IStringGenerator;

  /**
   * Generate HTTP server setup code
   */
  generateHttpServe(expr: CallNode, params: string[]): string;

  /**
   * Look up an interface definition by name from the AST
   */
  getInterfaceFromAST(name: string): { name: string; fields: { name: string; type: string }[] } | null;

  /**
   * Resolve an import alias to its original function name.
   * For example, if 'tsTypeToLlvm as tsTypeToLlvmUtil' was imported,
   * resolveImportAlias('tsTypeToLlvmUtil') returns 'tsTypeToLlvm'.
   * Returns the input name if no alias mapping exists.
   */
  resolveImportAlias(localName: string): string;

  /**
   * Access to class generator for field type lookups
   */
  readonly classGen: IClassGenContext;

  /**
   * Access to string map generator for Map<string, *> operations
   */
  readonly stringMapGen: IStringMapGenerator;
}

/**
 * Minimal context for testing sub-generators in isolation.
 * Provides mock implementations of all IGeneratorContext methods.
 *
 * @example
 * ```typescript
 * const ctx = new MockGeneratorContext();
 * const gen = new ArrayGenerator(ctx);
 * const result = gen.generateArrayLiteral(expr, []);
 * expect(ctx.output).toContain('call i8* @malloc');
 * ```
 */
export class MockGeneratorContext implements IGeneratorContext {
  private tempCount = 0;
  private labelCount = 0;
  private stringCount = 0;
  public output: string[] = [];
  public allocaInstructions: string[] = [];
  public symbolTable = new SymbolTable();
  public variableTypes: Map<string, string> = new Map();
  public actualClassTypes: Map<string, string> = new Map();
  public expressionTypes: Map<Expression, ResolvedType> = new Map();
  public globalStrings: string[] = [];
  public currentFunctionReturnType: string = 'double';
  public currentFunctionTsReturnType: string | undefined = undefined;
  public expectedArrayElementType: 'string' | 'number' | 'boolean' | 'pointer' | null = null;
  public expectedCallbackParamType: string | null = null;
  public expectedCallbackReturnType: string | null = null;
  public thisPointer: string | null = null;
  public currentClassName: string | null = null;
  public ast?: AST;
  public interfaceStructGen?: InterfaceStructGenerator;
  public currentLabel: string = 'entry';
  public typeChecker: TypeChecker | null = null;
  public typeResolver?: TypeResolver;
  public usesPromises = false;
  public usesTimers = false;
  public currentFunction: string | null = null;

  getClassesCount(): number {
    if (!this.ast || !this.ast.classes) return 0;
    return this.ast.classes.length;
  }

  getExpressionType(expr: Expression): ResolvedType | undefined {
    return this.expressionTypes.get(expr);
  }

  setExpressionType(expr: Expression, type: ResolvedType): void {
    this.expressionTypes.set(expr, type);
  }

  setActualClassType(name: string, className: string): void {
    this.actualClassTypes.set(name, className);
  }

  getActualClassType(name: string): string | undefined {
    return this.actualClassTypes.get(name);
  }

  generateExpression(_expr: Expression, _params: string[]): string {
    // Mock implementation - returns a dummy register
    return this.nextTemp();
  }

  generateBlock(_block: BlockStatement, _params: string[]): string | null {
    // Mock implementation - returns success
    return null;
  }

  isStringExpression(expr: Expression): boolean {
    const e = expr as ExprBase;
    return e.type === 'string';
  }

  isArrayExpression(expr: Expression): boolean {
    const e = expr as ExprBase;
    return e.type === 'array';
  }

  isStringArrayExpression(_expr: Expression): boolean {
    return false; // Simplified mock
  }

  isObjectArrayExpression(_expr: Expression): boolean {
    return false; // Simplified mock
  }

  isObjectExpression(expr: Expression): boolean {
    const e = expr as ExprBase;
    return e.type === 'object';
  }

  nextTemp(): string {
    return `%${this.tempCount++}`;
  }

  nextAllocaReg(varName: string): string {
    const safeName = varName.replace(/[^a-zA-Z0-9_]/g, '_');
    return `%${safeName}.addr.${this.tempCount++}`;
  }

  nextLabel(prefix: string): string {
    return `${prefix}${this.labelCount++}`;
  }

  nextString(): string {
    return `@.str.${this.stringCount++}`;
  }

  getDoubleSize(): string {
    const sizePtr = this.nextTemp();
    this.emit(`${sizePtr} = getelementptr double, double* null, i32 1`);
    const size = this.nextTemp();
    this.emit(`${size} = ptrtoint double* ${sizePtr} to i64`);
    return size;
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

  defineVariable(
    name: string,
    allocaReg: string,
    llvmType: string,
    kind: SymbolKind,
    scope: 'local' | 'global' = 'local',
    metadata?: SymbolMetadata
  ): void {
    this.symbolTable.define(name, kind, llvmType, allocaReg, scope, metadata);
  }

  getVariableType(name: string): string | undefined {
    // Check named variables in SymbolTable first
    const symbolType = this.symbolTable.getType(name);
    if (symbolType) return symbolType;

    // Fall back to temporary register types
    return this.variableTypes.get(name);
  }

  setVariableType(name: string, type: string): void {
    this.variableTypes.set(name, type);
  }

  getVariableAlloca(name: string): string | undefined {
    return this.symbolTable.getAlloca(name);
  }

  emit(instruction: string): void {
    // Quick validation for store instructions
    if (instruction.startsWith('store ')) {
      // Parse: "store <valueType> <value>, <ptrType> <ptr>"
      // Find first space after "store "
      const afterStore = instruction.substring(6);
      const firstSpace = afterStore.indexOf(' ');
      if (firstSpace > 0) {
        const valueType = afterStore.substring(0, firstSpace);
        const commaPos = instruction.indexOf(',');
        if (commaPos > 0) {
          // Skip ", " (comma + space)
          const afterComma = instruction.substring(commaPos + 2);
          const ptrTypeEnd = afterComma.indexOf(' ');
          if (ptrTypeEnd > 0) {
            const ptrType = afterComma.substring(0, ptrTypeEnd);
            if (ptrType.endsWith('*')) {
              const expectedType = ptrType.substring(0, ptrType.length - 1);
              if (valueType !== expectedType) {
                const msg = 'Type mismatch: value=' + valueType + ' ptr=' + ptrType + ' in: ' + instruction;
                throw new Error(msg);
              }
            }
          }
        }
      }
    }
    this.output.push(instruction);
  }


  getCurrentLabel(): string {
    return this.currentLabel;
  }

  setCurrentLabel(label: string): void {
    this.currentLabel = label;
  }

  syncStateToGenerators(): void {
  }

  stringGen = {
    createStringConstant: (_value: string): string => '%0',
    convertNumberToString: (_numValue: string): string => '%0',
    generateStringConcat: (_left: Expression, _right: Expression, _params: string[]): string => '%0',
    generateStringConcatDirect: (_left: string, _right: string): string => '%0',
  };

  generateHttpServe(_expr: CallNode, _params: string[]): string {
    return this.nextTemp();
  }

  getInterfaceFromAST(name: string): { name: string; fields: { name: string; type: string }[] } | null {
    if (!this.ast) return null;
    for (let i = 0; i < this.ast.interfaces.length; i++) {
      const iface = this.ast.interfaces[i] as { name: string; fields: { name: string; type: string }[] };
      if (iface.name === name) {
        return iface;
      }
    }
    return null;
  }

  classGen = {
    getFieldInfo: (_className: string, _fieldName: string): { index: number; type: string; tsType?: string } | null => null,
    getClassFields: (_className: string): { name: string; fieldType: string }[] => [],
  };

  stringMapGen = {
    generateStringMapEntries: (_mapPtr: string): string => '%mock_entries',
  };

  resolveImportAlias(localName: string): string {
    return localName;
  }

  reset(): void {
    this.tempCount = 0;
    this.labelCount = 0;
    this.stringCount = 0;
    this.output = [];
    this.variableTypes.clear();
    this.currentLabel = 'entry';
  }
}
