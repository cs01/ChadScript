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

import { Expression, BlockStatement, AST, CallNode, MethodCallNode, ArrayNode, MapNode, SetNode } from '../../ast/types.js';
import { SymbolTable, SymbolKind, SymbolMetadata, ClosureMetadata } from './symbol-table.js';
import type { TypeChecker } from '../../typescript/type-checker.js';
import type { TypeResolver } from './type-resolver/index.js';
import type { ResolvedType } from './type-system.js';
import type { InterfaceStructGenerator } from '../types/interface-struct-generator.js';
import type { TypeGuardInfo } from './type-resolver/types.js';

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
    kind: SymbolKind,
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

  // ============================================
  // SymbolTable Wrapper Methods (avoid method chaining issues)
  // ============================================

  symbolTableLookup(name: string): SymbolMetadata | undefined;
  symbolTableIsClass(name: string): boolean;
  symbolTableIsJSON(name: string): boolean;
  symbolTableIsObject(name: string): boolean;
  symbolTableIsMap(name: string): boolean;
  symbolTableIsSet(name: string): boolean;
  symbolTableIsNumberArray(name: string): boolean;
  symbolTableIsStringArray(name: string): boolean;
  symbolTableIsObjectArray(name: string): boolean;
  symbolTableIsString(name: string): boolean;
  symbolTableIsRegex(name: string): boolean;
  symbolTableGetType(name: string): string | undefined;
  symbolTableGetClassName(name: string): string | undefined;
  symbolTableGetClassInfo(name: string): { ptr: string; className: string } | undefined;
  symbolTableGetObjectInfo(name: string): { ptr: string; keys: string[]; types: string[]; tsTypes?: string[] } | undefined;
  symbolTableGetMapMetadata(name: string): { keyType: string; valueType: string } | undefined;
  symbolTableGetSetMetadata(name: string): { valueType: string } | undefined;
  symbolTableGetInterfaceType(name: string): string | undefined;
  symbolTableGetAlloca(name: string): string | undefined;
  symbolTableGetObjectArrayMetadata(name: string): { elementInterfaceName: string; elementKeys: string[]; elementTypes: string[]; elementTsTypes?: string[] } | undefined;
  symbolTableIsPointerAlloca(name: string): boolean;
  symbolTableNarrowType(name: string, narrowedMetadata: { keys: string[]; types: string[]; tsTypes?: string[] }): void;
  symbolTableRestoreType(name: string): void;
  symbolTableGetScopeVarsArraysForClosure(): { names: string[]; types: string[] };
  symbolTableIsClosure(name: string): boolean;
  symbolTableGetClosureMetadata(name: string): ClosureMetadata | undefined;
  symbolTableGetObjectPropertyType(varName: string, propertyName: string): string | null;
  symbolTableGetObjectMetadata(name: string): { keys: string[]; types: string[]; tsTypes?: string[] } | undefined;
  symbolTableGetArrayAlloca(name: string): string | undefined;
  symbolTableSetObjectArrayMetadata(name: string, metadata: { elementInterfaceName: string; elementKeys: string[]; elementTypes: string[]; elementTsTypes?: string[] }): void;
  symbolTableGetResolvedType(name: string): ResolvedType | undefined;
  symbolTableSetResolvedType(name: string, resolvedType: ResolvedType): void;

  /**
   * Access to global string constants
   */
  readonly globalStrings: string[];

  /**
   * Push a global string constant to the output
   */
  pushGlobalString(str: string): void;

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

  getThisPointer(): string | null;
  setThisPointer(ptr: string | null): void;
  getCurrentClassName(): string | null;
  setCurrentClassName(name: string | null): void;

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
   * Get the last instruction in the output buffer
   * Safe method access that avoids interface struct layout issues
   */
  getLastInstruction(): string;

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
   * Get AST safely via method call (avoids interface struct layout issues)
   */
  getAst(): AST | undefined;

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
   * ClassGen delegate methods (avoid struct layout mismatch)
   */
  classGenGetFieldInfo(className: string | null, fieldName: string | null): { index: number; type: string; tsType?: string } | null;
  classGenGetClassFields(className: string): { name: string; fieldType: string }[];
  classGenGetFieldType(className: string, fieldName: string): string | null;
  classGenGetFieldTsType(className: string, fieldName: string): string | null;
  classGenGenerateNewExpression(className: string, args: Expression[], params: string[]): string;
  classGenGenerateMethodCall(instancePtr: string, className: string, method: string, args: Expression[], params: string[]): string;

  /**
   * TypeResolver delegate methods (avoid chained field access in native code)
   */
  typeResolverGetUnionCommonFields(memberNames: string[]): { keys: string[]; types: string[] };
  typeResolverAreTypesCompatible(type1: string, type2: string): boolean;
  typeResolverNormalizeType(type: string): string;
  typeResolverDetectTypeGuard(condition: Expression): TypeGuardInfo | null;
  typeResolverFindInterfaceByDiscriminant(discriminantValue: string): string | null;
  typeResolverGetThisFieldMapKeyType(expr: Expression): string | null;
  typeResolverGetThisFieldSetValueType(expr: Expression): string | null;

  /**
   * StringGen delegate methods (avoid struct layout mismatch)
   */
  stringGenCreateStringConstant(value: string): string;
  stringGenGenerateSubstr(strPtr: string, startIndex: string, length: string | null): string;
  stringGenGenerateStringConcatDirect(left: string, right: string): string;
  stringGenGenerateRepeat(strPtr: string, count: string): string;
  stringGenGeneratePadStart(strPtr: string, targetLength: string, padString: string): string;
  stringGenGenerateSplit(strPtr: string, delimiter: string): string;
  stringGenGenerateStartsWith(strPtr: string, prefix: string): string;
  stringGenGenerateEndsWith(strPtr: string, suffix: string): string;
  stringGenGenerateTrim(strPtr: string): string;
  stringGenGenerateToUpperCase(strPtr: string): string;
  stringGenGenerateToLowerCase(strPtr: string): string;
  stringGenGenerateIndexOf(strPtr: string, substring: string): string;
  stringGenGenerateIncludes(strPtr: string, substring: string): string;
  stringGenGenerateSlice(strPtr: string, start: string, end: string | null): string;
  stringGenGenerateCharAt(strPtr: string, index: string): string;
  stringGenGenerateCharCodeAt(strPtr: string, index: string): string;
  stringGenGenerateReplace(strPtr: string, search: string, replace: string): string;
  stringGenGenerateReplaceAll(strPtr: string, search: string, replace: string): string;
  stringGenGenerateGlobalString(value: string): string;
  stringGenGenerateStringConcat(left: Expression, right: Expression, params: string[]): string;
  stringGenConvertNumberToString(numValue: string): string;

  /**
   * InterfaceStructGen delegate methods (avoid struct layout mismatch)
   */
  interfaceStructGenHasInterface(name: string): boolean;
  interfaceStructGenGetInterfaceStruct(name: string): { name: string; llvmType: string; fields: { name: string; tsType: string; llvmType: string }[]; isBuiltinConflict: boolean } | undefined;
  interfaceStructGenGetStructSize(interfaceName: string): number;

  /**
   * Access to string map generator for Map<string, *> operations
   */
  readonly stringMapGen: IStringMapGenerator;

  /**
   * StringMapGen delegate methods (avoid struct layout mismatch)
   */
  stringMapGenGenerateEmptyStringMap(): string;
  stringMapGenGenerateStringMapSet(mapPtr: string, keyValue: string, valueValue: string): string;
  stringMapGenGenerateStringMapGet(mapPtr: string, keyToFind: string): string;
  stringMapGenGenerateStringMapHas(mapPtr: string, keyToFind: string): string;
  stringMapGenGenerateStringMapClear(mapPtr: string): string;
  stringMapGenGenerateStringMapDelete(mapPtr: string, keyToFind: string): string;
  stringMapGenGenerateStringMapEntries(mapPtr: string): string;
  stringMapGenGenerateStringMapValues(mapPtr: string): string;
  stringMapGenGenerateStringMapKeys(mapPtr: string): string;

  /**
   * ArrayGen delegate methods (avoid struct layout mismatch)
   */
  arrayGenGenerateArrayLiteral(expr: ArrayNode, params: string[]): string;
  arrayGenGenerateArrayPush(expr: MethodCallNode, params: string[]): string;
  arrayGenGenerateArrayPop(expr: MethodCallNode, params: string[]): string;
  arrayGenGenerateArrayIncludes(expr: MethodCallNode, params: string[]): string;
  arrayGenGenerateArrayMap(expr: MethodCallNode, params: string[]): string;
  arrayGenGenerateStringArrayMap(expr: MethodCallNode, params: string[]): string;
  arrayGenGenerateArrayJoin(expr: MethodCallNode, params: string[]): string;
  arrayGenGenerateArrayFind(expr: MethodCallNode, params: string[]): string;
  arrayGenGenerateArraySome(expr: MethodCallNode, params: string[]): string;
  arrayGenGenerateArrayEvery(expr: MethodCallNode, params: string[]): string;
  arrayGenGenerateArrayFilter(expr: MethodCallNode, params: string[]): string;
  arrayGenGenerateArrayForEach(expr: MethodCallNode, params: string[]): string;
  arrayGenGenerateArraySlice(expr: MethodCallNode, params: string[]): string;
  arrayGenGenerateArrayConcat(expr: MethodCallNode, params: string[]): string;

  /**
   * MapGen delegate methods (avoid struct layout mismatch)
   */
  mapGenGenerateMapLiteral(expr: MapNode, params: string[]): string;
  mapGenGenerateMapSet(expr: MethodCallNode, params: string[]): string;
  mapGenGenerateMapGet(expr: MethodCallNode, params: string[]): string;
  mapGenGenerateMapHas(expr: MethodCallNode, params: string[]): string;
  mapGenGenerateMapDelete(expr: MethodCallNode, params: string[]): string;
  mapGenGenerateMapClear(expr: MethodCallNode, params: string[]): string;
  mapGenGenerateMapSize(mapPtr: string): string;

  /**
   * SetGen delegate methods (avoid struct layout mismatch)
   */
  setGenGenerateSetLiteral(expr: SetNode, params: string[]): string;
  setGenGenerateSetAdd(expr: MethodCallNode, params: string[]): string;
  setGenGenerateSetHas(expr: MethodCallNode, params: string[]): string;
  setGenGenerateSetDelete(expr: MethodCallNode, params: string[]): string;
  setGenGenerateSetSize(setPtr: string): string;

  /**
   * StringSetGen delegate methods (avoid struct layout mismatch)
   */
  stringSetGenGenerateEmptyStringSet(): string;
  stringSetGenGenerateStringSetAdd(setAlloca: string, valueValue: string): string;
  stringSetGenGenerateStringSetHas(setAlloca: string, valueValue: string): string;
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

  getAst(): AST | undefined {
    return this.ast;
  }

  getLastInstruction(): string {
    if (this.output.length === 0) return '';
    const last = this.output[this.output.length - 1];
    return last ? last.trim() : '';
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

  // SymbolTable wrapper methods (mock implementations)
  symbolTableLookup(name: string) { return this.symbolTable.lookup(name); }
  symbolTableIsClass(name: string): boolean { return this.symbolTable.isClass(name); }
  symbolTableIsJSON(name: string): boolean { return this.symbolTable.isJSON(name); }
  symbolTableIsObject(name: string): boolean { return this.symbolTable.isObject(name); }
  symbolTableIsMap(name: string): boolean { return this.symbolTable.isMap(name); }
  symbolTableIsSet(name: string): boolean { return this.symbolTable.isSet(name); }
  symbolTableIsNumberArray(name: string): boolean { return this.symbolTable.isNumberArray(name); }
  symbolTableIsStringArray(name: string): boolean { return this.symbolTable.isStringArray(name); }
  symbolTableIsObjectArray(name: string): boolean { return this.symbolTable.isObjectArray(name); }
  symbolTableIsString(name: string): boolean { return this.symbolTable.isString(name); }
  symbolTableIsRegex(name: string): boolean { return this.symbolTable.isRegex(name); }
  symbolTableGetType(name: string) { return this.symbolTable.getType(name); }
  symbolTableGetClassName(name: string) { return this.symbolTable.getClassName(name); }
  symbolTableGetClassInfo(name: string) { return this.symbolTable.getClassInfo(name); }
  symbolTableGetObjectInfo(name: string) { return this.symbolTable.getObjectInfo(name); }
  symbolTableGetMapMetadata(name: string) { return this.symbolTable.getMapMetadata(name); }
  symbolTableGetSetMetadata(name: string) { return this.symbolTable.getSetMetadata(name); }
  symbolTableGetInterfaceType(name: string) { return this.symbolTable.getInterfaceType(name); }
  symbolTableGetAlloca(name: string) { return this.symbolTable.getAlloca(name); }
  symbolTableGetObjectArrayMetadata(name: string) { return this.symbolTable.getObjectArrayMetadata(name); }
  symbolTableIsPointerAlloca(name: string) { return this.symbolTable.isPointerAlloca(name); }
  symbolTableNarrowType(name: string, narrowedMetadata: { keys: string[]; types: string[]; tsTypes?: string[] }) { this.symbolTable.narrowType(name, narrowedMetadata); }
  symbolTableRestoreType(name: string) { this.symbolTable.restoreType(name); }
  symbolTableGetScopeVarsArraysForClosure() { return this.symbolTable.getScopeVarsArraysForClosure(); }
  symbolTableIsClosure(name: string) { return this.symbolTable.isClosure(name); }
  symbolTableGetClosureMetadata(name: string) { return this.symbolTable.getClosureMetadata(name); }
  symbolTableGetObjectPropertyType(varName: string, propertyName: string) { return this.symbolTable.getObjectPropertyType(varName, propertyName); }
  symbolTableGetObjectMetadata(name: string) { return this.symbolTable.getObjectMetadata(name); }
  symbolTableGetArrayAlloca(name: string) { return this.symbolTable.getArrayAlloca(name); }
  symbolTableSetObjectArrayMetadata(name: string, metadata: { elementInterfaceName: string; elementKeys: string[]; elementTypes: string[]; elementTsTypes?: string[] }) { this.symbolTable.setObjectArrayMetadata(name, metadata); }
  symbolTableGetResolvedType(name: string): ResolvedType | undefined { return this.symbolTable.getResolvedType(name); }
  symbolTableSetResolvedType(name: string, resolvedType: ResolvedType) { this.symbolTable.setResolvedType(name, resolvedType); }

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

  pushGlobalString(str: string): void {
    this.globalStrings.push(str);
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

  stringGenCreateStringConstant(_value: string): string { return '%0'; }
  stringGenGenerateSubstr(_strPtr: string, _startIndex: string, _length: string | null): string { return '%0'; }
  stringGenGenerateStringConcatDirect(_left: string, _right: string): string { return '%0'; }
  stringGenGenerateRepeat(_strPtr: string, _count: string): string { return '%0'; }
  stringGenGeneratePadStart(_strPtr: string, _targetLength: string, _padString: string): string { return '%0'; }
  stringGenGenerateSplit(_strPtr: string, _delimiter: string): string { return '%0'; }
  stringGenGenerateStartsWith(_strPtr: string, _prefix: string): string { return '%0'; }
  stringGenGenerateEndsWith(_strPtr: string, _suffix: string): string { return '%0'; }
  stringGenGenerateTrim(_strPtr: string): string { return '%0'; }
  stringGenGenerateToUpperCase(_strPtr: string): string { return '%0'; }
  stringGenGenerateToLowerCase(_strPtr: string): string { return '%0'; }
  stringGenGenerateIndexOf(_strPtr: string, _substring: string): string { return '%0'; }
  stringGenGenerateIncludes(_strPtr: string, _substring: string): string { return '%0'; }
  stringGenGenerateSlice(_strPtr: string, _start: string, _end: string | null): string { return '%0'; }
  stringGenGenerateCharAt(_strPtr: string, _index: string): string { return '%0'; }
  stringGenGenerateCharCodeAt(_strPtr: string, _index: string): string { return '%0'; }
  stringGenGenerateReplace(_strPtr: string, _search: string, _replace: string): string { return '%0'; }
  stringGenGenerateReplaceAll(_strPtr: string, _search: string, _replace: string): string { return '%0'; }
  stringGenGenerateGlobalString(_value: string): string { return '%0'; }
  stringGenGenerateStringConcat(_left: Expression, _right: Expression, _params: string[]): string { return '%0'; }
  stringGenConvertNumberToString(_numValue: string): string { return '%0'; }

  interfaceStructGenHasInterface(_name: string): boolean { return false; }
  interfaceStructGenGetInterfaceStruct(_name: string): { name: string; llvmType: string; fields: { name: string; tsType: string; llvmType: string }[]; isBuiltinConflict: boolean } | undefined { return undefined; }
  interfaceStructGenGetStructSize(_interfaceName: string): number { return 0; }

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
  classGenGetFieldInfo(_className: string, _fieldName: string): { index: number; type: string; tsType?: string } | null {
    return null;
  }
  classGenGetClassFields(_className: string): { name: string; fieldType: string }[] {
    return [];
  }
  classGenGetFieldType(_className: string, _fieldName: string): string | null {
    return null;
  }
  classGenGetFieldTsType(_className: string, _fieldName: string): string | null {
    return null;
  }
  classGenGenerateNewExpression(_className: string, _args: Expression[], _params: string[]): string {
    return '%mock_new_result';
  }
  classGenGenerateMethodCall(_instancePtr: string, _className: string, _method: string, _args: Expression[], _params: string[]): string {
    return '%mock_method_result';
  }

  stringMapGen = {
    generateStringMapEntries: (_mapPtr: string): string => '%mock_entries',
  };

  stringMapGenGenerateEmptyStringMap(): string { return '%mock_empty_map'; }
  stringMapGenGenerateStringMapSet(_mapPtr: string, _keyValue: string, _valueValue: string): string { return '%mock_set_result'; }
  stringMapGenGenerateStringMapGet(_mapPtr: string, _keyToFind: string): string { return '%mock_get_result'; }
  stringMapGenGenerateStringMapHas(_mapPtr: string, _keyToFind: string): string { return '%mock_has_result'; }
  stringMapGenGenerateStringMapClear(_mapPtr: string): string { return '%mock_clear_result'; }
  stringMapGenGenerateStringMapDelete(_mapPtr: string, _keyToFind: string): string { return '%mock_delete_result'; }
  stringMapGenGenerateStringMapEntries(_mapPtr: string): string { return '%mock_entries'; }
  stringMapGenGenerateStringMapValues(_mapPtr: string): string { return '%mock_values'; }
  stringMapGenGenerateStringMapKeys(_mapPtr: string): string { return '%mock_keys'; }

  arrayGenGenerateArrayLiteral(_expr: ArrayNode, _params: string[]): string { return '%mock_array_literal'; }
  arrayGenGenerateArrayPush(_expr: MethodCallNode, _params: string[]): string { return '%mock_array_push'; }
  arrayGenGenerateArrayPop(_expr: MethodCallNode, _params: string[]): string { return '%mock_array_pop'; }
  arrayGenGenerateArrayIncludes(_expr: MethodCallNode, _params: string[]): string { return '%mock_array_includes'; }
  arrayGenGenerateArrayMap(_expr: MethodCallNode, _params: string[]): string { return '%mock_array_map'; }
  arrayGenGenerateStringArrayMap(_expr: MethodCallNode, _params: string[]): string { return '%mock_string_array_map'; }
  arrayGenGenerateArrayJoin(_expr: MethodCallNode, _params: string[]): string { return '%mock_array_join'; }
  arrayGenGenerateArrayFind(_expr: MethodCallNode, _params: string[]): string { return '%mock_array_find'; }
  arrayGenGenerateArraySome(_expr: MethodCallNode, _params: string[]): string { return '%mock_array_some'; }
  arrayGenGenerateArrayEvery(_expr: MethodCallNode, _params: string[]): string { return '%mock_array_every'; }
  arrayGenGenerateArrayFilter(_expr: MethodCallNode, _params: string[]): string { return '%mock_array_filter'; }
  arrayGenGenerateArrayForEach(_expr: MethodCallNode, _params: string[]): string { return '%mock_array_foreach'; }
  arrayGenGenerateArraySlice(_expr: MethodCallNode, _params: string[]): string { return '%mock_array_slice'; }
  arrayGenGenerateArrayConcat(_expr: MethodCallNode, _params: string[]): string { return '%mock_array_concat'; }

  mapGenGenerateMapLiteral(_expr: MapNode, _params: string[]): string { return '%mock_map_literal'; }
  mapGenGenerateMapSet(_expr: MethodCallNode, _params: string[]): string { return '%mock_map_set'; }
  mapGenGenerateMapGet(_expr: MethodCallNode, _params: string[]): string { return '%mock_map_get'; }
  mapGenGenerateMapHas(_expr: MethodCallNode, _params: string[]): string { return '%mock_map_has'; }
  mapGenGenerateMapDelete(_expr: MethodCallNode, _params: string[]): string { return '%mock_map_delete'; }
  mapGenGenerateMapClear(_expr: MethodCallNode, _params: string[]): string { return '%mock_map_clear'; }
  mapGenGenerateMapSize(_mapPtr: string): string { return '%mock_map_size'; }

  setGenGenerateSetLiteral(_expr: SetNode, _params: string[]): string { return '%mock_set_literal'; }
  setGenGenerateSetAdd(_expr: MethodCallNode, _params: string[]): string { return '%mock_set_add'; }
  setGenGenerateSetHas(_expr: MethodCallNode, _params: string[]): string { return '%mock_set_has'; }
  setGenGenerateSetDelete(_expr: MethodCallNode, _params: string[]): string { return '%mock_set_delete'; }
  setGenGenerateSetSize(_setPtr: string): string { return '%mock_set_size'; }

  stringSetGenGenerateEmptyStringSet(): string { return '%mock_empty_string_set'; }
  stringSetGenGenerateStringSetAdd(_setAlloca: string, _valueValue: string): string { return '%mock_string_set_add'; }
  stringSetGenGenerateStringSetHas(_setAlloca: string, _valueValue: string): string { return '%mock_string_set_has'; }

  resolveImportAlias(localName: string): string {
    return localName;
  }

  typeResolverGetUnionCommonFields(_memberNames: string[]): { keys: string[]; types: string[] } {
    return { keys: [], types: [] };
  }
  typeResolverAreTypesCompatible(_type1: string, _type2: string): boolean {
    return false;
  }
  typeResolverNormalizeType(type: string): string {
    return type;
  }
  typeResolverDetectTypeGuard(_condition: Expression): TypeGuardInfo | null {
    return null;
  }
  typeResolverFindInterfaceByDiscriminant(_discriminantValue: string): string | null {
    return null;
  }
  typeResolverGetThisFieldMapKeyType(_expr: Expression): string | null {
    return null;
  }
  typeResolverGetThisFieldSetValueType(_expr: Expression): string | null {
    return null;
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
