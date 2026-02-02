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
   * Temporary register type tracking (for LLVM registers like %0, %1, etc)
   * Named variables use SymbolTable instead
   */
  readonly variableTypes: Map<string, string>;

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
  readonly stringGen: {
    createStringConstant(value: string): string;
    generateStringConcat(left: Expression, right: Expression, params: string[]): string;
    generateStringConcatDirect(left: string, right: string): string;
  };

  /**
   * Generate HTTP server setup code
   */
  generateHttpServe(expr: CallNode, params: string[]): string;

  /**
   * Look up an interface definition by name from the AST
   */
  getInterfaceFromAST(name: string): { name: string; fields: { name: string; type: string }[] } | null;

  /**
   * Access to class generator for field type lookups
   */
  readonly classGen: {
    getFieldInfo(className: string, fieldName: string): { index: number; type: string; tsType?: string } | null;
    getClassFields(className: string): { name: string; fieldType: string }[];
  };
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
  public variableTypes: Map<string, string> = new Map();
  public globalStrings: string[] = [];
  public currentFunctionReturnType = 'double';
  public expectedArrayElementType: 'string' | 'number' | 'boolean' | null = null;
  public thisPointer: string | null = null;
  public currentClassName: string | null = null;
  public ast?: AST;
  public currentLabel = 'entry';
  public typeChecker: TypeChecker | null = null;
  public typeResolver?: TypeResolver;
  public usesPromises = false;
  public usesTimers = false;
  public currentFunction: string | null = null;

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

  getVariableAlloca(name: string): string | undefined {
    return this.symbolTable.getAlloca(name);
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

  syncStateToGenerators(): void {
  }

  stringGen = {
    createStringConstant: (_value: string): string => this.nextTemp(),
    generateStringConcat: (_left: Expression, _right: Expression, _params: string[]): string => this.nextTemp(),
    generateStringConcatDirect: (_left: string, _right: string): string => this.nextTemp(),
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

  reset(): void {
    this.tempCount = 0;
    this.labelCount = 0;
    this.stringCount = 0;
    this.output = [];
    this.variableTypes.clear();
    this.currentLabel = 'entry';
  }
}
