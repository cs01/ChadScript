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

import { Expression, BlockStatement, AST } from '../../ast/types.js';
import { SymbolTable, SymbolKind } from './symbol-table.js';

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
    metadata?: any
  ): void;

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
   * Expected array element type (for type-aware array generation)
   */
  expectedArrayElementType: 'string' | 'number' | 'boolean' | null;

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
   * Track string variables (legacy - prefer variableTypes)
   * Maps variable name -> alloca register for i8* strings
   */
  readonly stringVariables: Map<string, string>;

  /**
   * Track string array variables (e.g., %StringArray pointers)
   * Needed to determine array element types for operations
   */
  readonly stringArrayVariables: Map<string, string>;

  /**
   * Track variable types (double, i8*, etc.)
   * Used for type-aware code generation
   */
  readonly variableTypes: Map<string, string>;

  /**
   * Track variable allocations (variable name -> alloca register)
   * Used for storing and loading variable values
   */
  readonly variables: Map<string, string>;

  /**
   * LLVM IR output buffer
   * Used to check for terminators and other instruction analysis
   */
  readonly output: string[];

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
  public symbolTable = new SymbolTable();
  public globalStrings: string[] = [];
  public currentFunctionReturnType = 'double';
  public expectedArrayElementType: 'string' | 'number' | 'boolean' | null = null;
  public thisPointer: string | null = null;
  public currentClassName: string | null = null;
  public ast?: AST;
  public currentLabel = 'entry';
  public stringVariables: Map<string, string> = new Map();
  public stringArrayVariables: Map<string, string> = new Map();
  public variableTypes: Map<string, string> = new Map();
  public variables: Map<string, string> = new Map();

  generateExpression(expr: Expression, params: string[]): string {
    // Mock implementation - returns a dummy register
    return this.nextTemp();
  }

  generateBlock(block: BlockStatement, params: string[]): string | null {
    // Mock implementation - returns success
    return null;
  }

  isStringExpression(expr: Expression): boolean {
    return expr.type === 'string';
  }

  isArrayExpression(expr: Expression): boolean {
    return expr.type === 'array';
  }

  isStringArrayExpression(expr: Expression): boolean {
    return false; // Simplified mock
  }

  isObjectExpression(expr: Expression): boolean {
    return expr.type === 'object';
  }

  nextTemp(): string {
    return `%${this.tempCount++}`;
  }

  nextLabel(prefix: string): string {
    return `${prefix}${this.labelCount++}`;
  }

  nextString(): string {
    return `@.str.${this.stringCount++}`;
  }

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

  defineVariable(
    name: string,
    allocaReg: string,
    llvmType: string,
    kind: SymbolKind,
    scope: 'local' | 'global' = 'local',
    metadata?: any
  ): void {
    this.variables.set(name, allocaReg);
    this.variableTypes.set(name, llvmType);
    this.symbolTable.define(name, kind, llvmType, allocaReg, scope, metadata);
  }

  emit(instruction: string): void {
    this.output.push(instruction);
  }

  getCurrentLabel(): string {
    return this.currentLabel;
  }

  setCurrentLabel(label: string): void {
    this.currentLabel = label;
  }

  reset(): void {
    this.tempCount = 0;
    this.labelCount = 0;
    this.stringCount = 0;
    this.output = [];
    this.currentLabel = 'entry';
  }
}
