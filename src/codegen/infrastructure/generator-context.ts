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

import {
  Expression,
  BlockStatement,
  AST,
  CallNode,
  MethodCallNode,
  ArrayNode,
  MapNode,
  SetNode,
  InterfaceDeclaration,
  InterfaceField,
  FunctionNode,
  ClassNode,
  TypeAliasDeclaration,
  SourceLocation,
  VariableDeclaration,
} from "../../ast/types.js";
import { SymbolTable, SymbolKind, SymbolMetadata } from "./symbol-table.js";
import type { TypeChecker } from "../../typescript/type-checker.js";
import type { TypeResolver } from "./type-resolver/index.js";
import type { ResolvedType } from "./type-system.js";
import type {
  InterfaceStructGenerator,
  InterfaceStructInfo,
  InterfaceFieldInfo,
} from "../types/interface-struct-generator.js";
import type { TypeGuardInfo, FieldInfo } from "./type-resolver/types.js";
import type { JsonObjectMeta } from "../expressions/access/member.js";
import type { DiagnosticEngine } from "../../diagnostics/engine.js";
import { TypeContext } from "./type-context.js";

interface ExprBase {
  type: string;
}

export interface IClassGenContext {
  getFieldInfo(className: string, fieldName: string): FieldInfo | null;
  getClassFields(className: string): { name: string; fieldType: string }[];
  getFieldType(className: string, fieldName: string): string | null;
  getFieldTsType(className: string, fieldName: string): string | null;
  generateNewExpression(className: string, args: Expression[], params: string[]): string;
  generateMethodCall(
    instancePtr: string,
    className: string,
    method: string,
    args: Expression[],
    params: string[],
  ): string;
  thisPointer?: string | null;
  currentClassName?: string | null;
}

export interface IStringGenerator {
  doCreateStringConstant(value: string): string;
  doConvertNumberToString(numValue: string): string;
  doConvertNumberToFixed(numValue: string, precisionValue: string): string;
  doGenerateStringConcat(left: Expression, right: Expression, params: string[]): string;
  doGenerateStringConcatDirect(left: string, right: string): string;
  doGenerateSubstr(strPtr: string, startIndex: string, length: string | null): string;
  doGenerateRepeat(strPtr: string, count: string): string;
  doGeneratePadStart(strPtr: string, targetLength: string, padString: string): string;
  doGeneratePadEnd(strPtr: string, targetLength: string, padString: string): string;
  doGenerateSplit(strPtr: string, delimiter: string): string;
  doGenerateStartsWith(strPtr: string, prefix: string): string;
  doGenerateEndsWith(strPtr: string, suffix: string): string;
  doGenerateTrim(strPtr: string): string;
  doGenerateTrimStart(strPtr: string): string;
  doGenerateTrimEnd(strPtr: string): string;
  doGenerateToUpperCase(strPtr: string): string;
  doGenerateToLowerCase(strPtr: string): string;
  doGenerateIndexOf(strPtr: string, substring: string): string;
  doGenerateLastIndexOf(strPtr: string, substring: string): string;
  doGenerateIncludes(strPtr: string, substring: string): string;
  doGenerateSlice(strPtr: string, start: string, end: string | null): string;
  doGenerateCharAt(strPtr: string, index: string): string;
  doGenerateCharCodeAt(strPtr: string, index: string): string;
  doGenerateReplace(strPtr: string, search: string, replace: string): string;
  doGenerateReplaceAll(strPtr: string, search: string, replace: string): string;
  doGenerateGlobalString(value: string): string;
}

export interface IResponseGenerator {
  generateText(responsePtr: string): string;
  generateJson(responsePtr: string): string;
  generateTypedJson(
    responsePtr: string,
    typeName: string,
    interfaceDef: { properties: { name: string; type: string }[] },
  ): string;
  generateStatus(responsePtr: string): string;
  generateOk(responsePtr: string): string;
  generateUrl(responsePtr: string): string;
  generateHeaders(responsePtr: string): string;
  generateRedirected(responsePtr: string): string;
  generateStatusText(responsePtr: string): string;
}

export interface IRegexGenerator {
  generateRegexCompile(pattern: string, flags: string): string;
  generateRegexTest(regexPtr: string, testStr: string): string;
  generateRegexMatch(regexPtr: string, testStr: string, numGroups: number): string;
  generateRegexCompileRuntime(patternPtr: string, cflags: number): string;
  generateRegexExecDyn(regexPtr: string, testStr: string): string;
}

export interface IControlFlowGenerator {
  generateLogicalOp(op: string, left: Expression, right: Expression, params: string[]): string;
}

export interface IObjectGenerator {
  generateObjectLiteral(expr: Expression, params: string[]): string;
}

export interface IMathGenerator {
  canHandle(expr: MethodCallNode): boolean;
  generateMathMethod(expr: MethodCallNode, params: string[]): string;
}

export interface IPathGenerator {
  generateResolve(expr: MethodCallNode, params: string[]): string;
  generateDirname(expr: MethodCallNode, params: string[]): string;
  generateBasename(expr: MethodCallNode, params: string[]): string;
  generateJoin(expr: MethodCallNode, params: string[]): string;
  generateExtname(expr: MethodCallNode, params: string[]): string;
  generateIsAbsolute(expr: MethodCallNode, params: string[]): string;
  generateNormalize(expr: MethodCallNode, params: string[]): string;
  generateRelative(expr: MethodCallNode, params: string[]): string;
  generateParse(expr: MethodCallNode, params: string[]): string;
}

export interface IFsGenerator {
  canHandle(expr: MethodCallNode): boolean;
  generateReadFileSync(expr: MethodCallNode, params: string[]): string;
  generateWriteFileSync(expr: MethodCallNode, params: string[]): string;
  generateAppendFileSync(expr: MethodCallNode, params: string[]): string;
  generateExistsSync(expr: MethodCallNode, params: string[]): string;
  generateUnlinkSync(expr: MethodCallNode, params: string[]): string;
  generateReaddirSync(expr: MethodCallNode, params: string[]): string;
  generateStatSync(expr: MethodCallNode, params: string[]): string;
  generateMkdirSync(expr: MethodCallNode, params: string[]): string;
  generateRenameSync(expr: MethodCallNode, params: string[]): string;
  generateCopyFileSync(expr: MethodCallNode, params: string[]): string;
  generateReadFile(expr: MethodCallNode, params: string[]): string;
  generateWriteFile(expr: MethodCallNode, params: string[]): string;
  generateAppendFile(expr: MethodCallNode, params: string[]): string;
  generateReaddir(expr: MethodCallNode, params: string[]): string;
  generateStat(expr: MethodCallNode, params: string[]): string;
  generateUnlink(expr: MethodCallNode, params: string[]): string;
  generateMkdir(expr: MethodCallNode, params: string[]): string;
  generateRename(expr: MethodCallNode, params: string[]): string;
  generateCopyFile(expr: MethodCallNode, params: string[]): string;
  generateReadFileSyncBinary(expr: MethodCallNode, params: string[]): string;
  generateWriteFileSyncBinary(expr: MethodCallNode, params: string[]): string;
}

export interface IJsonGenerator {
  canHandle(expr: MethodCallNode): boolean;
  generateParse(expr: MethodCallNode, params: string[], typeParam?: string): string;
  generateStringify(expr: MethodCallNode, params: string[]): string;
  generateStringifyExpr(arg: Expression, params: string[]): string;
}

export interface IDateGenerator {
  canHandle(expr: MethodCallNode): boolean;
  generateNow(): string;
  generateDateMethod(datePtr: string, method: string): string;
}

export interface ICryptoGenerator {
  canHandle(expr: MethodCallNode): boolean;
  generateSha256(expr: MethodCallNode, params: string[]): string;
  generateMd5(expr: MethodCallNode, params: string[]): string;
  generateSha512(expr: MethodCallNode, params: string[]): string;
  generateRandomBytes(expr: MethodCallNode, params: string[]): string;
  generateRandomUUID(expr: MethodCallNode, params: string[]): string;
  generateHmacSha256(expr: MethodCallNode, params: string[]): string;
  generatePbkdf2(expr: MethodCallNode, params: string[]): string;
}

export interface ISqliteGenerator {
  canHandle(expr: MethodCallNode): boolean;
  generateOpen(expr: MethodCallNode, params: string[]): string;
  generateExec(expr: MethodCallNode, params: string[]): string;
  generateGet(expr: MethodCallNode, params: string[]): string;
  generateGetRow(expr: MethodCallNode, params: string[]): string;
  generateAll(expr: MethodCallNode, params: string[]): string;
  generateQuery(expr: MethodCallNode, params: string[]): string;
  generateClose(expr: MethodCallNode, params: string[]): string;
}

export interface IChildProcessGenerator {
  canHandle(expr: MethodCallNode): boolean;
  generateExecSync(expr: MethodCallNode, params: string[]): string;
  generateBareExecSync(expr: CallNode, params: string[]): string;
  generateSpawnSync(expr: MethodCallNode, params: string[]): string;
  generateExec(expr: MethodCallNode, params: string[]): string;
  generateSpawn(expr: MethodCallNode, params: string[]): string;
}

export interface IEmbedGenerator {
  generateEmbedFile(expr: MethodCallNode, params: string[]): string;
  generateEmbedDir(expr: MethodCallNode, params: string[]): string;
  generateGetEmbeddedFile(expr: MethodCallNode, params: string[]): string;
  generateGetEmbeddedFileAsUint8Array(expr: MethodCallNode, params: string[]): string;
  generateServeEmbedded(expr: MethodCallNode, params: string[]): string;
  generateLookupFunction(): string;
  generateLengthLookupFunction(): string;
  hasEmbeddedFiles(): boolean;
}

export interface IArrowFunctionGenerator {
  generateArrowFunction(
    expr: Expression,
    params: string[],
    typeHints: { paramTypes?: string[]; returnType?: string } | undefined,
    scopeVarNames: string[] | undefined,
    scopeVarTypes: string[] | undefined,
  ): string;
  getClosureInfoForLambda(
    lambdaName: string,
  ): { captures: { name: string; llvmType: string }[]; envStructName: string } | undefined;
}

export interface IStringMapGenerator {
  generateStringMapSet(mapPtr: string, keyValue: string, valueValue: string): string;
  generateStringMapGet(mapPtr: string, keyToFind: string): string;
  generateStringMapHas(mapPtr: string, keyToFind: string): string;
  generateStringMapClear(mapPtr: string): string;
  generateStringMapDelete(mapPtr: string, keyToFind: string): string;
  generateStringMapEntries(mapPtr: string): string;
  generateStringMapValues(mapPtr: string): string;
  generateStringMapKeys(mapPtr: string): string;
  generateEmptyStringMap(): string;
}

export interface IMapGenerator {
  generateMapLiteral(expr: MapNode, params: string[]): string;
  generateMapSet(expr: MethodCallNode, params: string[]): string;
  generateMapGet(expr: MethodCallNode, params: string[]): string;
  generateMapHas(expr: MethodCallNode, params: string[]): string;
  generateMapDelete(expr: MethodCallNode, params: string[]): string;
  generateMapClear(expr: MethodCallNode, params: string[]): string;
  generateMapSize(mapPtr: string): string;
}

export interface ISetGenerator {
  generateSetLiteral(expr: SetNode, params: string[]): string;
  generateSetAdd(expr: MethodCallNode, params: string[]): string;
  generateSetHas(expr: MethodCallNode, params: string[]): string;
  generateSetDelete(expr: MethodCallNode, params: string[]): string;
  generateSetSize(setPtr: string): string;
}

export interface IStringSetGenerator {
  generateEmptyStringSet(): string;
  generateStringSetAdd(setAlloca: string, valueValue: string): string;
  generateStringSetHas(setAlloca: string, valueValue: string): string;
  generateStringSetDelete(setAlloca: string, valueValue: string): string;
}

export interface IPointerMapGenerator {
  generatePointerMapSet(mapPtr: string, keyValue: string, valueValue: string): string;
  generatePointerMapGet(mapPtr: string, keyValue: string, valueType: string): string;
  generatePointerMapClear(mapPtr: string): string;
}

export interface IArrayGenerator {
  generateArrayLiteral(expr: ArrayNode, params: string[]): string;
  generateArrayPush(expr: MethodCallNode, params: string[]): string;
  generateArrayPop(expr: MethodCallNode, params: string[]): string;
  generateArrayIncludes(expr: MethodCallNode, params: string[]): string;
  generateArrayMap(expr: MethodCallNode, params: string[]): string;
  generateStringArrayMap(expr: MethodCallNode, params: string[]): string;
  generateArrayJoin(expr: MethodCallNode, params: string[]): string;
  generateArrayFind(expr: MethodCallNode, params: string[]): string;
  generateArraySome(expr: MethodCallNode, params: string[]): string;
  generateArrayEvery(expr: MethodCallNode, params: string[]): string;
  generateArrayFilter(expr: MethodCallNode, params: string[]): string;
  generateArrayForEach(expr: MethodCallNode, params: string[]): string;
  generateArrayReduce(expr: MethodCallNode, params: string[]): string;
  generateArraySlice(expr: MethodCallNode, params: string[]): string;
  generateArrayConcat(expr: MethodCallNode, params: string[]): string;
  generateArrayReverse(expr: MethodCallNode, params: string[]): string;
  generateArrayShift(expr: MethodCallNode, params: string[]): string;
  generateArrayUnshift(expr: MethodCallNode, params: string[]): string;
  generateArrayIndexOf(expr: MethodCallNode, params: string[]): string;
  generateArrayFindIndex(expr: MethodCallNode, params: string[]): string;
  generateArraySort(expr: MethodCallNode, params: string[]): string;
  generateArraySplice(expr: MethodCallNode, params: string[]): string;
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
    kind: number,
    scope: string,
  ): void;

  defineVariableWithMetadata(
    name: string,
    allocaReg: string,
    llvmType: string,
    kind: number,
    scope: string,
    metadata: SymbolMetadata,
  ): void;

  /**
   * Lookup variable type (checks SymbolTable first, falls back to legacy)
   */
  getVariableType(name: string): string | undefined;

  /**
   * Check if a variable type exists
   */
  hasVariableType(name: string): boolean;

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
   * Diagnostic engine for structured error/warning reporting
   */
  readonly diagnostics?: DiagnosticEngine;

  /**
   * Emit a structured codegen error with optional source location and suggestion.
   * Always throws — return type is `never` so callers can write `return ctx.emitError(...)`.
   */
  emitError(message: string, loc?: SourceLocation, suggestion?: string): never;

  /**
   * Emit a structured codegen warning with optional source location and suggestion.
   */
  emitWarning(message: string, loc?: SourceLocation, suggestion?: string): void;

  /**
   * Type context for canonical interned type objects
   */
  readonly typeContext: TypeContext;

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
  setCurrentFunctionReturnType(type: string): void;
  getCurrentFunctionReturnType(): string;

  /**
   * Current function TypeScript return type (for inline interface object generation)
   */
  currentFunctionTsReturnType: string | undefined;
  setCurrentFunctionTsReturnType(type: string | undefined): void;
  getCurrentFunctionTsReturnType(): string | undefined;

  /**
   * Expected array element type (for type-aware array generation)
   */
  expectedArrayElementType: "string" | "number" | "boolean" | "pointer" | null;
  setExpectedArrayElementType(type: "string" | "number" | "boolean" | "pointer" | null): void;
  getExpectedArrayElementType(): "string" | "number" | "boolean" | "pointer" | null;

  /**
   * When true, methods like readFileSync should return %Uint8Array* instead of i8*.
   * Set by the variable allocator before generating Uint8Array-typed variable initializers.
   */
  wantsBinaryReturn: boolean;
  setWantsBinaryReturn(value: boolean): void;
  getWantsBinaryReturn(): boolean;

  /**
   * Current declared map type (for type-aware map generation)
   */
  currentDeclaredMapType: string | undefined;
  setCurrentDeclaredMapType(type: string | undefined): void;
  getCurrentDeclaredMapType(): string | undefined;

  /**
   * Expected callback parameter type (for type-aware lambda generation)
   */
  expectedCallbackParamType: string | null;
  setExpectedCallbackParamType(type: string | null): void;
  getExpectedCallbackParamType(): string | null;

  /**
   * Expected callback return type (for type-aware lambda generation)
   */
  expectedCallbackReturnType: string | null;
  setExpectedCallbackReturnType(type: string | null): void;
  getExpectedCallbackReturnType(): string | null;

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

  readonly jsonObjectMetadata: Map<string, JsonObjectMeta>;
  setJsonObjectMetadata(key: string, value: JsonObjectMeta): void;
  getJsonObjectMetadata(key: string): JsonObjectMeta | undefined;
  hasJsonObjectMetadata(key: string): boolean;
  getJsonObjectMetadataKeys(key: string): string[] | undefined;
  getJsonObjectMetadataTypes(key: string): string[] | undefined;
  getJsonObjectMetadataTsTypes(key: string): string[] | undefined;
  getJsonObjectMetadataInterfaceType(key: string): string | undefined;
  getParameterTypeFromAST(paramName: string): string | null;
  findClassImplementingInterface(interfaceName: string): string | null;
  getInterfaceProperties(
    name: string,
  ): { keys: string[]; types: string[]; tsTypes: string[] } | null;
  getInterfaceDeclByName(name: string): InterfaceDeclaration | null;
  findInterfaceForFields(fieldNames: string[]): string | null;
  getAllInterfaceFields(iface: InterfaceDeclaration): InterfaceField[];
  isTypeAlias(name: string): boolean;
  getTypeAliasCommonProperties(
    name: string,
  ): { keys: string[]; types: string[]; tsTypes: string[] } | null;
  getInterfaceFieldType(interfaceName: string, fieldName: string): string | null;
  getMethodReturnType(className: string, methodName: string): string | null;
  isEnumType(name: string): boolean;
  getEnumMemberValue(enumName: string, memberName: string): number;
  getEnumMemberStringValue(enumName: string, memberName: string): string | null;

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

  lastInstructionIsTerminator(): boolean;

  emitRet(type: string, value: string): void;
  emitRetVoid(): void;
  emitBr(label: string): void;
  emitBrCond(cond: string, thenLabel: string, elseLabel: string): void;
  emitUnreachable(): void;
  emitLabel(name: string): void;

  emitCall(retType: string, func: string, args: string): string;
  emitCallVoid(func: string, args: string): void;
  emitLoad(type: string, ptr: string): string;
  emitStore(type: string, value: string, ptr: string): void;
  emitGep(baseType: string, ptr: string, indices: string): string;
  emitIcmp(pred: string, type: string, lhs: string, rhs: string): string;
  emitBitcast(value: string, fromType: string, toType: string): string;

  getOutput(): string[];
  clearOutput(): void;
  pushOutput(line: string): void;
  getOutputLength(): number;
  getOutputLine(index: number): string;
  setOutputLine(index: number, line: string): void;
  getGlobalStringsLength(): number;
  getGlobalStringAt(index: number): string;
  clearGlobalStrings(): void;
  getOutputAsIndentedString(indent: string): string;

  /**
   * Collected alloca instructions to be hoisted to entry block
   * Allocas inside loops cause stack overflow - they must be at function start
   */
  readonly allocaInstructions: string[];
  getAllocaInstructions(): string[];
  clearAllocaInstructions(): void;

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

  getAstInterfacesLength(): number;
  getAstInterfaceAt(index: number): InterfaceDeclaration | null;
  getAstInterfaceNameAt(index: number): string | null;
  getAstFunctionsLength(): number;
  getAstFunctionAt(index: number): FunctionNode | null;
  getAstFunctionNameAt(index: number): string | null;
  getAstClassesLength(): number;
  getAstClassAt(index: number): ClassNode | null;
  getAstClassNameAt(index: number): string | null;
  getAstTypeAliasesLength(): number;
  getAstTypeAliasAt(index: number): TypeAliasDeclaration | null;
  getAstTypeAliasNameAt(index: number): string | null;
  getAstTypeAliasMembersAt(index: number): string[] | null;

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

  getTargetOS?(): string;
  getTargetArch?(): string;

  /**
   * Consolidated type resolution (interfaces, unions, type guards)
   */
  readonly typeResolver?: TypeResolver;

  /**
   * Whether the current compilation uses Promises
   */
  usesPromises: number;
  setUsesPromises(value: boolean): void;
  getUsesPromises(): boolean;

  /**
   * Whether the current compilation uses timers (setTimeout/setInterval)
   */
  usesTimers: number;
  setUsesTimers(value: boolean): void;
  getUsesTimers(): boolean;
  setUsesTreeSitter(value: boolean): void;
  setUsesSqlite(value: boolean): void;
  setUsesCurl(value: boolean): void;
  setUsesOs(value: boolean): void;
  setUsesUvHrtime(value: boolean): void;
  setUsesConsoleTime(value: boolean): void;
  setUsesArraySort(value: boolean): void;
  setUsesCrypto(value: boolean): void;
  setUsesJson(value: boolean): void;
  setUsesHttpServer(value: boolean): void;
  setUsesMultipart(value: boolean): void;
  setUsesRegex(value: boolean): void;
  setUsesTestRunner(value: boolean): void;
  getUsesTestRunner(): boolean;
  setUsesChildProcess(value: boolean): void;
  setUsesSpawn(value: boolean): void;
  setUsesAsyncFs(value: boolean): void;
  getUsesGC(): boolean;
  setUsesGC(value: boolean): void;
  getUsesMathRandom(): boolean;
  setUsesMathRandom(value: boolean): void;

  currentDeclaredInterfaceType: string | undefined;
  setCurrentDeclaredInterfaceType(type: string | undefined): void;
  getCurrentDeclaredInterfaceType(): string | undefined;

  /**
   * Current function name for type resolution
   */
  currentFunction: string | null;
  setCurrentFunction(name: string | null): void;
  getCurrentFunction(): string | null;

  /**
   * String generator for string operations
   */
  readonly stringGen: IStringGenerator;

  /**
   * Generate HTTP server setup code
   */
  generateHttpServe(expr: CallNode, params: string[]): string;

  /**
   * Generate WebSocket broadcast call
   */
  generateWsBroadcast(expr: CallNode, params: string[]): string;

  /**
   * Generate WebSocket targeted send to a specific connection
   */
  generateWsSend(expr: CallNode, params: string[]): string;

  generateParseMultipart(expr: CallNode, params: string[]): string;

  /**
   * Look up an interface definition by name from the AST
   */
  getInterfaceFromAST(
    name: string,
  ): { name: string; fields: { name: string; type: string }[] } | null;

  /**
   * Resolve an import alias to its original function name.
   * For example, if 'tsTypeToLlvm as tsTypeToLlvmUtil' was imported,
   * resolveImportAlias('tsTypeToLlvmUtil') returns 'tsTypeToLlvm'.
   * Returns the input name if no alias mapping exists.
   */
  resolveImportAlias(localName: string): string;

  mangleUserName(name: string): string;

  /**
   * Access to class generator for field type lookups
   */
  readonly classGen: IClassGenContext;
  classGenGetFieldInfo(className: string | null, fieldName: string | null): FieldInfo | null;
  classGenGetFieldType(className: string, fieldName: string): string | null;
  classGenGetFieldTsType(className: string, fieldName: string): string | null;
  classGenGetClassFields(className: string): { name: string; fieldType: string }[];
  classGenGenerateNewExpression(className: string, args: Expression[], params: string[]): string;
  classGenGenerateMethodCall(
    instancePtr: string,
    className: string,
    method: string,
    args: Expression[],
    params: string[],
  ): string;
  classGenGenerateStaticMethodCall(
    className: string,
    method: string,
    args: Expression[],
    params: string[],
  ): string;
  classGenIsStaticMethod(className: string, methodName: string): boolean;
  classGenIsStaticField(className: string, fieldName: string): boolean;
  classGenGetStaticFieldType(className: string, fieldName: string): string;

  /**
   * TypeResolver delegate methods (avoid chained field access in native code)
   */
  typeResolverGetUnionCommonFields(memberNames: string[]): {
    keys: string[];
    types: string[];
    tsTypes: string[];
  };
  typeResolverAreTypesCompatible(type1: string, type2: string): boolean;
  typeResolverNormalizeType(type: string): string;
  typeResolverDetectTypeGuard(condition: Expression): TypeGuardInfo | null;
  typeResolverFindInterfaceByDiscriminant(discriminantValue: string): string | null;
  typeResolverGetThisFieldMapKeyType(expr: Expression): string | null;
  typeResolverGetThisFieldSetValueType(expr: Expression): string | null;
  typeResolverGetClassFieldMapType(
    className: string,
    fieldName: string,
  ): { keyType: string; valueType: string } | null;
  typeResolverGetInterfaceMetadata(
    name: string,
  ): { keys: string[]; types: string[]; tsTypes?: string[] } | null;
  typeResolverGetInterface(name: string): InterfaceDeclaration | null;

  /**
   * InterfaceStructGen delegate methods (avoid struct layout mismatch)
   */
  interfaceStructGenHasInterface(name: string): boolean;
  interfaceStructGenGetInterfaceStruct(name: string): InterfaceStructInfo | undefined;
  interfaceStructGenGetStructSize(interfaceName: string): number;
  interfaceStructGenGetFieldCount(interfaceName: string): number;
  interfaceStructGenGetFieldName(interfaceName: string, fieldIndex: number): string;
  interfaceStructGenGetFieldTsType(interfaceName: string, fieldIndex: number): string;
  interfaceStructGenGetFieldLlvmType(interfaceName: string, fieldIndex: number): string;

  /**
   * Access to string map generator for Map<string, *> operations
   */
  readonly stringMapGen: IStringMapGenerator;

  readonly pointerMapGen: IPointerMapGenerator;
  readonly arrayGen: IArrayGenerator;

  readonly responseGen: IResponseGenerator;
  readonly regexGen: IRegexGenerator;
  readonly controlFlowGen: IControlFlowGenerator;
  readonly objectGen: IObjectGenerator;
  readonly mathGen: IMathGenerator;
  readonly pathGen: IPathGenerator;
  readonly fsGen: IFsGenerator;
  readonly jsonGen: IJsonGenerator;
  readonly dateGen: IDateGenerator;
  readonly cryptoGen: ICryptoGenerator;
  readonly sqliteGen: ISqliteGenerator;

  readonly arrowFunctionGen: IArrowFunctionGenerator;

  readonly childProcessGen: IChildProcessGenerator;
  readonly embedGen: IEmbedGenerator;

  ensureDouble(value: string): string;
  ensureI64(value: string): string;

  /**
   * Env pointer for the last inline lambda that had captures.
   * Set by orchestrator after generating an inline arrow function with captures.
   * Consumed by array method call sites to pass as first arg.
   * IMPORTANT: Must be at the END of this interface — inserting in the middle
   * shifts GEP indices and crashes the native compiler.
   */
  lastInlineLambdaEnvPtr: string | null;
  getLastInlineLambdaEnvPtr(): string | null;
  setLastInlineLambdaEnvPtr(ptr: string | null): void;

  /**
   * Source variable name from the last type assertion expression.
   * Set by orchestrator when evaluating `expr as Type` where expr is a variable.
   * Consumed by variable-allocator to inherit metadata from the source variable,
   * ensuring correct GEP indices when assertion reorders fields.
   * IMPORTANT: Must be at the END of this interface.
   */
  lastTypeAssertionSourceVar: string | null;
  getLastTypeAssertionSourceVar(): string | null;
  setLastTypeAssertionSourceVar(name: string | null): void;

  setStackEligibleVars(vars: string[]): void;
  isStackEligibleKey(key: string): boolean;
  currentVarDeclKey: string | null;
  setCurrentVarDeclKey(key: string | null): void;
  getCurrentVarDeclKey(): string | null;
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
  public outputIsTerminator: boolean[] = [];
  public allocaInstructions: string[] = [];
  public symbolTable: SymbolTable;
  public diagnostics?: DiagnosticEngine;
  public typeContext: TypeContext;
  public variableTypes: Map<string, string>;
  public actualClassTypes: Map<string, string>;
  public jsonObjectMetadata: Map<string, JsonObjectMeta>;
  public expressionTypes: Map<Expression, ResolvedType>;
  public globalStrings: string[] = [];
  public currentFunctionReturnType: string = "double";
  public currentFunctionTsReturnType: string | undefined = undefined;
  public expectedArrayElementType: "string" | "number" | "boolean" | "pointer" | null = null;
  public currentDeclaredMapType: string | undefined = undefined;
  public expectedCallbackParamType: string | null = null;
  public expectedCallbackReturnType: string | null = null;
  public thisPointer: string | null = null;
  public currentClassName: string | null = null;
  public ast?: AST;
  public interfaceStructGen?: InterfaceStructGenerator;
  public currentLabel: string = "entry";
  public typeChecker: TypeChecker | null = null;
  public typeResolver?: TypeResolver;
  public usesPromises: number = 0;
  public usesTimers: number = 0;
  public usesSqlite: number = 0;
  public usesCurl: number = 0;
  public usesUvHrtime: number = 0;
  public usesCrypto: number = 0;
  public usesJson: number = 0;
  public usesHttpServer: number = 0;
  public usesRegex: number = 0;
  public usesTestRunner: number = 0;
  public usesAsyncFs: number = 0;
  public currentFunction: string | null = null;
  public currentDeclaredInterfaceType: string | undefined = undefined;

  // Must be at end of field list — see BaseGenerator/IGeneratorContext comments
  public lastInlineLambdaEnvPtr: string | null = null;
  public lastTypeAssertionSourceVar: string | null = null;

  private stackEligibleVars: string[] = [];
  public currentVarDeclKey: string | null = null;

  constructor() {
    this.typeContext = new TypeContext();
    this.symbolTable = new SymbolTable(this.typeContext);
    this.variableTypes = new Map();
    this.actualClassTypes = new Map();
    this.jsonObjectMetadata = new Map();
    this.expressionTypes = new Map();
  }

  getClassesCount(): number {
    if (!this.ast || !this.ast.classes) return 0;
    return this.ast.classes.length;
  }

  getAst(): AST | undefined {
    return this.ast;
  }

  getLastInstruction(): string {
    if (this.output.length === 0) return "";
    const last = this.output[this.output.length - 1];
    return last ? last.trim() : "";
  }

  emitError(message: string, _loc?: SourceLocation, _suggestion?: string): never {
    throw new Error(message);
  }

  emitWarning(_message: string, _loc?: SourceLocation, _suggestion?: string): void {}

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

  setJsonObjectMetadata(key: string, value: JsonObjectMeta): void {
    this.jsonObjectMetadata.set(key, value);
  }

  getJsonObjectMetadata(key: string): JsonObjectMeta | undefined {
    return this.jsonObjectMetadata.get(key);
  }

  hasJsonObjectMetadata(key: string): boolean {
    return this.jsonObjectMetadata.has(key);
  }

  getJsonObjectMetadataKeys(key: string): string[] | undefined {
    const meta = this.jsonObjectMetadata.get(key);
    if (!meta) return undefined;
    return meta.keys;
  }

  getJsonObjectMetadataTypes(key: string): string[] | undefined {
    const meta = this.jsonObjectMetadata.get(key);
    if (!meta) return undefined;
    return meta.types;
  }

  getJsonObjectMetadataTsTypes(key: string): string[] | undefined {
    const meta = this.jsonObjectMetadata.get(key);
    if (!meta) return undefined;
    return meta.tsTypes;
  }

  getJsonObjectMetadataInterfaceType(key: string): string | undefined {
    const meta = this.jsonObjectMetadata.get(key);
    if (!meta) return undefined;
    return meta.interfaceType;
  }

  getParameterTypeFromAST(_paramName: string): string | null {
    return null;
  }
  findClassImplementingInterface(_interfaceName: string): string | null {
    return null;
  }
  getInterfaceProperties(
    _name: string,
  ): { keys: string[]; types: string[]; tsTypes: string[] } | null {
    return null;
  }
  getInterfaceDeclByName(_name: string): InterfaceDeclaration | null {
    return null;
  }
  findInterfaceForFields(_fieldNames: string[]): string | null {
    return null;
  }
  getAllInterfaceFields(iface: InterfaceDeclaration): InterfaceField[] {
    return iface.fields;
  }
  isTypeAlias(_name: string): boolean {
    return false;
  }
  getTypeAliasCommonProperties(
    _name: string,
  ): { keys: string[]; types: string[]; tsTypes: string[] } | null {
    return null;
  }
  getInterfaceFieldType(_interfaceName: string, _fieldName: string): string | null {
    return null;
  }
  getMethodReturnType(_className: string, _methodName: string): string | null {
    return null;
  }
  isEnumType(_name: string): boolean {
    return false;
  }
  getEnumMemberValue(_enumName: string, _memberName: string): number {
    return -1;
  }
  getEnumMemberStringValue(_enumName: string, _memberName: string): string | null {
    return null;
  }

  setCurrentFunction(name: string | null): void {
    this.currentFunction = name;
  }
  getCurrentFunction(): string | null {
    return this.currentFunction;
  }
  setCurrentFunctionReturnType(type: string): void {
    this.currentFunctionReturnType = type;
  }
  getCurrentFunctionReturnType(): string {
    return this.currentFunctionReturnType;
  }
  setCurrentFunctionTsReturnType(type: string | undefined): void {
    this.currentFunctionTsReturnType = type;
  }
  getCurrentFunctionTsReturnType(): string | undefined {
    return this.currentFunctionTsReturnType;
  }
  setExpectedArrayElementType(type: "string" | "number" | "boolean" | "pointer" | null): void {
    this.expectedArrayElementType = type;
  }
  getExpectedArrayElementType(): "string" | "number" | "boolean" | "pointer" | null {
    return this.expectedArrayElementType;
  }
  wantsBinaryReturn: boolean = false;
  setWantsBinaryReturn(value: boolean): void {
    this.wantsBinaryReturn = value;
  }
  getWantsBinaryReturn(): boolean {
    return this.wantsBinaryReturn;
  }
  setCurrentDeclaredMapType(type: string | undefined): void {
    this.currentDeclaredMapType = type;
  }
  getCurrentDeclaredMapType(): string | undefined {
    return this.currentDeclaredMapType;
  }
  getAllocaInstructions(): string[] {
    return this.allocaInstructions;
  }
  clearAllocaInstructions(): void {
    this.allocaInstructions.length = 0;
  }

  setUsesPromises(value: boolean): void {
    this.usesPromises = value ? 1 : 0;
  }
  getUsesPromises(): boolean {
    return this.usesPromises !== 0;
  }
  setUsesTimers(value: boolean): void {
    this.usesTimers = value ? 1 : 0;
  }
  getUsesTimers(): boolean {
    return this.usesTimers !== 0;
  }
  setUsesTreeSitter(_value: boolean): void {}
  setUsesSqlite(value: boolean): void {
    this.usesSqlite = value ? 1 : 0;
  }
  setUsesCurl(value: boolean): void {
    this.usesCurl = value ? 1 : 0;
  }
  setUsesOs(_value: boolean): void {}
  setUsesUvHrtime(value: boolean): void {
    this.usesUvHrtime = value ? 1 : 0;
  }
  public usesConsoleTime: number = 0;
  setUsesConsoleTime(value: boolean): void {
    this.usesConsoleTime = value ? 1 : 0;
  }
  public usesArraySort: number = 0;
  setUsesArraySort(value: boolean): void {
    this.usesArraySort = value ? 1 : 0;
  }
  setUsesCrypto(value: boolean): void {
    this.usesCrypto = value ? 1 : 0;
  }
  setUsesJson(value: boolean): void {
    this.usesJson = value ? 1 : 0;
  }
  setUsesHttpServer(value: boolean): void {
    this.usesHttpServer = value ? 1 : 0;
  }
  setUsesMultipart(value: boolean): void {
    // no-op in mock
  }
  setUsesRegex(value: boolean): void {
    this.usesRegex = value ? 1 : 0;
  }
  setUsesTestRunner(value: boolean): void {
    this.usesTestRunner = value ? 1 : 0;
  }
  getUsesTestRunner(): boolean {
    return this.usesTestRunner !== 0;
  }
  setUsesChildProcess(value: boolean): void {
    // no-op in mock
  }
  setUsesSpawn(value: boolean): void {
    // no-op in mock
  }
  setUsesAsyncFs(value: boolean): void {
    this.usesAsyncFs = value ? 1 : 0;
  }
  getUsesGC(): boolean {
    return false;
  }
  setUsesGC(_value: boolean): void {}
  getUsesMathRandom(): boolean {
    return false;
  }
  setUsesMathRandom(_value: boolean): void {}
  setCurrentDeclaredInterfaceType(type: string | undefined): void {
    this.currentDeclaredInterfaceType = type;
  }
  getCurrentDeclaredInterfaceType(): string | undefined {
    return this.currentDeclaredInterfaceType;
  }
  setExpectedCallbackParamType(type: string | null): void {
    this.expectedCallbackParamType = type;
  }
  getExpectedCallbackParamType(): string | null {
    return this.expectedCallbackParamType;
  }
  setExpectedCallbackReturnType(type: string | null): void {
    this.expectedCallbackReturnType = type;
  }
  getExpectedCallbackReturnType(): string | null {
    return this.expectedCallbackReturnType;
  }
  getLastInlineLambdaEnvPtr(): string | null {
    return this.lastInlineLambdaEnvPtr;
  }
  setLastInlineLambdaEnvPtr(ptr: string | null): void {
    this.lastInlineLambdaEnvPtr = ptr;
  }
  getLastTypeAssertionSourceVar(): string | null {
    return this.lastTypeAssertionSourceVar;
  }
  setLastTypeAssertionSourceVar(name: string | null): void {
    this.lastTypeAssertionSourceVar = name;
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
    return e.type === "string";
  }

  isArrayExpression(expr: Expression): boolean {
    const e = expr as ExprBase;
    return e.type === "array";
  }

  isStringArrayExpression(_expr: Expression): boolean {
    return false; // Simplified mock
  }

  isObjectArrayExpression(_expr: Expression): boolean {
    return false; // Simplified mock
  }

  isObjectExpression(expr: Expression): boolean {
    const e = expr as ExprBase;
    return e.type === "object";
  }

  nextTemp(): string {
    return `%${this.tempCount++}`;
  }

  nextAllocaReg(varName: string): string {
    const safeName = varName.replace(/[^a-zA-Z0-9_]/g, "_");
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
        escaped += "\\5C";
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
    const ptrReg = this.nextTemp();
    this.emit(
      ptrReg +
        " = getelementptr inbounds [" +
        len +
        " x i8], [" +
        len +
        " x i8]* " +
        strId +
        ", i64 0, i64 0",
    );
    this.setVariableType(ptrReg, "i8*");
    return ptrReg;
  }

  defineVariable(
    name: string,
    allocaReg: string,
    llvmType: string,
    kind: number,
    scope: string,
  ): void {
    this.symbolTable.define(name, kind, llvmType, allocaReg, scope);
  }

  defineVariableWithMetadata(
    name: string,
    allocaReg: string,
    llvmType: string,
    kind: number,
    scope: string,
    metadata: SymbolMetadata,
  ): void {
    this.symbolTable.defineWithMetadata(name, kind, llvmType, allocaReg, scope, metadata);
  }

  getVariableType(name: string): string | undefined {
    // Check named variables in SymbolTable first
    const symbolType = this.symbolTable.getType(name);
    if (symbolType) return symbolType;

    // Fall back to temporary register types
    return this.variableTypes.get(name);
  }

  hasVariableType(name: string): boolean {
    return this.getVariableType(name) !== undefined;
  }

  setVariableType(name: string, type: string): void {
    this.variableTypes.set(name, type);
  }

  getVariableAlloca(name: string): string | undefined {
    return this.symbolTable.getAlloca(name);
  }

  emit(instruction: string): void {
    // Quick validation for store instructions
    if (instruction.startsWith("store ")) {
      // Parse: "store <valueType> <value>, <ptrType> <ptr>"
      // Find first space after "store "
      const afterStore = instruction.substring(6);
      const firstSpace = afterStore.indexOf(" ");
      if (firstSpace > 0) {
        const valueType = afterStore.substring(0, firstSpace);
        const commaPos = instruction.indexOf(",");
        if (commaPos > 0) {
          // Skip ", " (comma + space)
          const afterComma = instruction.substring(commaPos + 2);
          const ptrTypeEnd = afterComma.indexOf(" ");
          if (ptrTypeEnd > 0) {
            const ptrType = afterComma.substring(0, ptrTypeEnd);
            if (ptrType.endsWith("*")) {
              const expectedType = ptrType.substring(0, ptrType.length - 1);
              if (valueType !== expectedType) {
                const msg =
                  "Type mismatch: value=" + valueType + " ptr=" + ptrType + " in: " + instruction;
                throw new Error(msg);
              }
            }
          }
        }
      }
    }
    this.output.push(instruction);
    this.outputIsTerminator.push(this.classifyTerminator(instruction));
  }

  private classifyTerminator(instruction: string): boolean {
    const trimmed = instruction.trim();
    return (
      trimmed.startsWith("ret ") ||
      trimmed === "ret void" ||
      trimmed.startsWith("br ") ||
      trimmed.startsWith("unreachable") ||
      trimmed.startsWith("switch ")
    );
  }

  lastInstructionIsTerminator(): boolean {
    const len = this.outputIsTerminator.length;
    if (len === 0) return false;
    return this.outputIsTerminator[len - 1];
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

  getOutput(): string[] {
    return this.output;
  }

  clearOutput(): void {
    this.output = [];
    this.outputIsTerminator = [];
  }

  pushOutput(line: string): void {
    this.output.push(line);
    this.outputIsTerminator.push(this.classifyTerminator(line));
  }

  getOutputLength(): number {
    return this.output.length;
  }

  getOutputLine(index: number): string {
    const line = this.output[index];
    if (line === undefined) return "";
    return line;
  }

  setOutputLine(index: number, line: string): void {
    const newOutput: string[] = [];
    const newIsTerminator: boolean[] = [];
    for (let i = 0; i < this.output.length; i++) {
      if (i === index) {
        newOutput.push(line);
        newIsTerminator.push(this.classifyTerminator(line));
      } else {
        newOutput.push(this.output[i]);
        newIsTerminator.push(this.outputIsTerminator[i]);
      }
    }
    this.output.length = 0;
    this.outputIsTerminator.length = 0;
    for (let i = 0; i < newOutput.length; i++) {
      this.output.push(newOutput[i]);
      this.outputIsTerminator.push(newIsTerminator[i]);
    }
  }

  getGlobalStringsLength(): number {
    return this.globalStrings.length;
  }

  getGlobalStringAt(index: number): string {
    return this.globalStrings[index] || "";
  }

  clearGlobalStrings(): void {
    this.globalStrings.length = 0;
  }

  getOutputAsIndentedString(indent: string): string {
    let result = "";
    for (let i = 0; i < this.output.length; i++) {
      result += indent + this.output[i] + "\n";
    }
    return result;
  }

  getCurrentLabel(): string {
    return this.currentLabel;
  }

  setCurrentLabel(label: string): void {
    this.currentLabel = label;
  }

  stringGen: IStringGenerator = {
    doCreateStringConstant: (_value: string): string => "%0",
    doConvertNumberToString: (_numValue: string): string => "%0",
    doConvertNumberToFixed: (_numValue: string, _precisionValue: string): string => "%0",
    doGenerateStringConcat: (_left: Expression, _right: Expression, _params: string[]): string =>
      "%0",
    doGenerateStringConcatDirect: (_left: string, _right: string): string => "%0",
    doGenerateSubstr: (_strPtr: string, _startIndex: string, _length: string | null): string =>
      "%0",
    doGenerateRepeat: (_strPtr: string, _count: string): string => "%0",
    doGeneratePadStart: (_strPtr: string, _targetLength: string, _padString: string): string =>
      "%0",
    doGeneratePadEnd: (_strPtr: string, _targetLength: string, _padString: string): string => "%0",
    doGenerateSplit: (_strPtr: string, _delimiter: string): string => "%0",
    doGenerateStartsWith: (_strPtr: string, _prefix: string): string => "%0",
    doGenerateEndsWith: (_strPtr: string, _suffix: string): string => "%0",
    doGenerateTrim: (_strPtr: string): string => "%0",
    doGenerateTrimStart: (_strPtr: string): string => "%0",
    doGenerateTrimEnd: (_strPtr: string): string => "%0",
    doGenerateToUpperCase: (_strPtr: string): string => "%0",
    doGenerateToLowerCase: (_strPtr: string): string => "%0",
    doGenerateIndexOf: (_strPtr: string, _substring: string): string => "%0",
    doGenerateLastIndexOf: (_strPtr: string, _substring: string): string => "%0",
    doGenerateIncludes: (_strPtr: string, _substring: string): string => "%0",
    doGenerateSlice: (_strPtr: string, _start: string, _end: string | null): string => "%0",
    doGenerateCharAt: (_strPtr: string, _index: string): string => "%0",
    doGenerateCharCodeAt: (_strPtr: string, _index: string): string => "%0",
    doGenerateReplace: (_strPtr: string, _search: string, _replace: string): string => "%0",
    doGenerateReplaceAll: (_strPtr: string, _search: string, _replace: string): string => "%0",
    doGenerateGlobalString: (_value: string): string => "%0",
  };

  interfaceStructGenHasInterface(_name: string): boolean {
    return false;
  }
  interfaceStructGenGetInterfaceStruct(_name: string):
    | {
        name: string;
        llvmType: string;
        fields: { name: string; tsType: string; llvmType: string }[];
        isBuiltinConflict: boolean;
      }
    | undefined {
    return undefined;
  }
  interfaceStructGenGetStructSize(_interfaceName: string): number {
    return 0;
  }
  interfaceStructGenGetFieldCount(_interfaceName: string): number {
    return 0;
  }
  interfaceStructGenGetFieldName(_interfaceName: string, _fieldIndex: number): string {
    return "";
  }
  interfaceStructGenGetFieldTsType(_interfaceName: string, _fieldIndex: number): string {
    return "";
  }
  interfaceStructGenGetFieldLlvmType(_interfaceName: string, _fieldIndex: number): string {
    return "";
  }

  generateHttpServe(_expr: CallNode, _params: string[]): string {
    return this.nextTemp();
  }

  generateWsBroadcast(_expr: CallNode, _params: string[]): string {
    return "0.0";
  }

  generateWsSend(_expr: CallNode, _params: string[]): string {
    return "0.0";
  }

  generateParseMultipart(_expr: CallNode, _params: string[]): string {
    return this.nextTemp();
  }

  getInterfaceFromAST(
    name: string,
  ): { name: string; fields: { name: string; type: string }[] } | null {
    if (!this.ast) return null;
    for (let i = 0; i < this.ast.interfaces.length; i++) {
      const iface = this.ast.interfaces[i] as {
        name: string;
        extends: string[];
        fields: { name: string; type: string }[];
      };
      if (iface.name === name) {
        return iface;
      }
    }
    return null;
  }

  classGen = {
    getFieldInfo: (_className: string, _fieldName: string): FieldInfo | null => null,
    getClassFields: (_className: string): { name: string; fieldType: string }[] => [],
    getFieldType: (_className: string, _fieldName: string): string | null => null,
    getFieldTsType: (_className: string, _fieldName: string): string | null => null,
    generateNewExpression: (_className: string, _args: Expression[], _params: string[]): string =>
      "%mock_new_result",
    generateMethodCall: (
      _instancePtr: string,
      _className: string,
      _method: string,
      _args: Expression[],
      _params: string[],
    ): string => "%mock_method_result",
  };
  classGenGetFieldInfo(_className: string | null, _fieldName: string | null): FieldInfo | null {
    return null;
  }
  classGenGetFieldType(_className: string, _fieldName: string): string | null {
    return null;
  }
  classGenGetFieldTsType(_className: string, _fieldName: string): string | null {
    return null;
  }
  classGenGetClassFields(_className: string): { name: string; fieldType: string }[] {
    return [];
  }
  classGenGenerateNewExpression(
    _className: string,
    _args: Expression[],
    _params: string[],
  ): string {
    return "%mock_new_result";
  }
  classGenGenerateMethodCall(
    _instancePtr: string,
    _className: string,
    _method: string,
    _args: Expression[],
    _params: string[],
  ): string {
    return "%mock_method_result";
  }
  classGenGenerateStaticMethodCall(
    _className: string,
    _method: string,
    _args: Expression[],
    _params: string[],
  ): string {
    return "%mock_static_method_result";
  }
  classGenIsStaticMethod(_className: string, _methodName: string): boolean {
    return false;
  }
  classGenIsStaticField(_className: string, _fieldName: string): boolean {
    return false;
  }
  classGenGetStaticFieldType(_className: string, _fieldName: string): string {
    return "double";
  }

  stringMapGen: IStringMapGenerator = {
    generateStringMapSet: (_mapPtr: string, _keyValue: string, _valueValue: string): string =>
      "%mock_set_result",
    generateStringMapGet: (_mapPtr: string, _keyToFind: string): string => "%mock_get_result",
    generateStringMapHas: (_mapPtr: string, _keyToFind: string): string => "%mock_has_result",
    generateStringMapClear: (_mapPtr: string): string => "%mock_clear_result",
    generateStringMapDelete: (_mapPtr: string, _keyToFind: string): string => "%mock_delete_result",
    generateStringMapEntries: (_mapPtr: string): string => "%mock_entries",
    generateStringMapValues: (_mapPtr: string): string => "%mock_values",
    generateStringMapKeys: (_mapPtr: string): string => "%mock_keys",
    generateEmptyStringMap: (): string => "%mock_empty_map",
  };

  responseGen: IResponseGenerator = {
    generateText: (_responsePtr: string): string => "%mock_response_text",
    generateJson: (_responsePtr: string): string => "%mock_response_json",
    generateTypedJson: (
      _responsePtr: string,
      _typeName: string,
      _interfaceDef: { properties: { name: string; type: string }[] },
    ): string => "%mock_response_typed_json",
    generateStatus: (_responsePtr: string): string => "%mock_response_status",
    generateOk: (_responsePtr: string): string => "%mock_response_ok",
    generateUrl: (_responsePtr: string): string => "%mock_response_url",
    generateHeaders: (_responsePtr: string): string => "%mock_response_headers",
    generateRedirected: (_responsePtr: string): string => "%mock_response_redirected",
    generateStatusText: (_responsePtr: string): string => "%mock_response_status_text",
  };
  regexGen: IRegexGenerator = {
    generateRegexCompile: (_pattern: string, _flags: string): string => "%mock_regex_compile",
    generateRegexTest: (_regexPtr: string, _testStr: string): string => "%mock_regex_test",
    generateRegexMatch: (_regexPtr: string, _testStr: string, _numGroups: number): string =>
      "%mock_regex_match",
    generateRegexCompileRuntime: (_patternPtr: string, _cflags: number): string =>
      "%mock_regex_compile_runtime",
    generateRegexExecDyn: (_regexPtr: string, _testStr: string): string => "%mock_regex_exec_dyn",
  };
  controlFlowGen: IControlFlowGenerator = {
    generateLogicalOp: (
      _op: string,
      _left: Expression,
      _right: Expression,
      _params: string[],
    ): string => "%mock_logical_op",
  };
  objectGen: IObjectGenerator = {
    generateObjectLiteral: (_expr: Expression, _params: string[]): string => "%mock_object_literal",
  };
  mathGen: IMathGenerator = {
    canHandle: (_expr: MethodCallNode): boolean => false,
    generateMathMethod: (_expr: MethodCallNode, _params: string[]): string => "%mock_math_method",
  };
  pathGen: IPathGenerator = {
    generateResolve: (_expr: MethodCallNode, _params: string[]): string => "%mock_path_resolve",
    generateDirname: (_expr: MethodCallNode, _params: string[]): string => "%mock_path_dirname",
    generateBasename: (_expr: MethodCallNode, _params: string[]): string => "%mock_path_basename",
    generateJoin: (_expr: MethodCallNode, _params: string[]): string => "%mock_path_join",
    generateExtname: (_expr: MethodCallNode, _params: string[]): string => "%mock_path_extname",
    generateIsAbsolute: (_expr: MethodCallNode, _params: string[]): string =>
      "%mock_path_isabsolute",
    generateNormalize: (_expr: MethodCallNode, _params: string[]): string => "%mock_path_normalize",
    generateRelative: (_expr: MethodCallNode, _params: string[]): string => "%mock_path_relative",
    generateParse: (_expr: MethodCallNode, _params: string[]): string => "%mock_path_parse",
  };
  fsGen: IFsGenerator = {
    canHandle: (_expr: MethodCallNode): boolean => false,
    generateReadFileSync: (_expr: MethodCallNode, _params: string[]): string =>
      "%mock_fs_readFileSync",
    generateWriteFileSync: (_expr: MethodCallNode, _params: string[]): string =>
      "%mock_fs_writeFileSync",
    generateAppendFileSync: (_expr: MethodCallNode, _params: string[]): string =>
      "%mock_fs_appendFileSync",
    generateExistsSync: (_expr: MethodCallNode, _params: string[]): string => "%mock_fs_existsSync",
    generateUnlinkSync: (_expr: MethodCallNode, _params: string[]): string => "%mock_fs_unlinkSync",
    generateReaddirSync: (_expr: MethodCallNode, _params: string[]): string =>
      "%mock_fs_readdirSync",
    generateStatSync: (_expr: MethodCallNode, _params: string[]): string => "%mock_fs_statSync",
    generateMkdirSync: (_expr: MethodCallNode, _params: string[]): string => "%mock_fs_mkdirSync",
    generateRenameSync: (_expr: MethodCallNode, _params: string[]): string => "%mock_fs_renameSync",
    generateCopyFileSync: (_expr: MethodCallNode, _params: string[]): string =>
      "%mock_fs_copyFileSync",
    generateReadFile: (_expr: MethodCallNode, _params: string[]): string => "%mock_fs_readFile",
    generateWriteFile: (_expr: MethodCallNode, _params: string[]): string => "%mock_fs_writeFile",
    generateAppendFile: (_expr: MethodCallNode, _params: string[]): string => "%mock_fs_appendFile",
    generateReaddir: (_expr: MethodCallNode, _params: string[]): string => "%mock_fs_readdir",
    generateStat: (_expr: MethodCallNode, _params: string[]): string => "%mock_fs_stat",
    generateUnlink: (_expr: MethodCallNode, _params: string[]): string => "%mock_fs_unlink",
    generateMkdir: (_expr: MethodCallNode, _params: string[]): string => "%mock_fs_mkdir",
    generateRename: (_expr: MethodCallNode, _params: string[]): string => "%mock_fs_rename",
    generateCopyFile: (_expr: MethodCallNode, _params: string[]): string => "%mock_fs_copyFile",
    generateReadFileSyncBinary: (_expr: MethodCallNode, _params: string[]): string =>
      "%mock_fs_readFileSyncBinary",
    generateWriteFileSyncBinary: (_expr: MethodCallNode, _params: string[]): string =>
      "%mock_fs_writeFileSyncBinary",
  };
  jsonGen: IJsonGenerator = {
    canHandle: (_expr: MethodCallNode): boolean => false,
    generateParse: (_expr: MethodCallNode, _params: string[], _typeParam?: string): string =>
      "%mock_json_parse",
    generateStringify: (_expr: MethodCallNode, _params: string[]): string => "%mock_json_stringify",
    generateStringifyExpr: (_arg: Expression, _params: string[]): string =>
      "%mock_json_stringify_expr",
  };
  dateGen: IDateGenerator = {
    canHandle: (_expr: MethodCallNode): boolean => false,
    generateNow: (): string => "%mock_date_now",
    generateDateMethod: (_datePtr: string, _method: string): string => "%mock_date_method",
  };
  cryptoGen: ICryptoGenerator = {
    canHandle: (_expr: MethodCallNode): boolean => false,
    generateSha256: (_expr: MethodCallNode, _params: string[]): string => "%mock_crypto_sha256",
    generateMd5: (_expr: MethodCallNode, _params: string[]): string => "%mock_crypto_md5",
    generateSha512: (_expr: MethodCallNode, _params: string[]): string => "%mock_crypto_sha512",
    generateRandomBytes: (_expr: MethodCallNode, _params: string[]): string =>
      "%mock_crypto_random_bytes",
    generateRandomUUID: (_expr: MethodCallNode, _params: string[]): string =>
      "%mock_crypto_random_uuid",
    generateHmacSha256: (_expr: MethodCallNode, _params: string[]): string =>
      "%mock_crypto_hmac_sha256",
    generatePbkdf2: (_expr: MethodCallNode, _params: string[]): string => "%mock_crypto_pbkdf2",
  };
  sqliteGen: ISqliteGenerator = {
    canHandle: (_expr: MethodCallNode): boolean => false,
    generateOpen: (_expr: MethodCallNode, _params: string[]): string => "%mock_sqlite_open",
    generateExec: (_expr: MethodCallNode, _params: string[]): string => "%mock_sqlite_exec",
    generateGet: (_expr: MethodCallNode, _params: string[]): string => "%mock_sqlite_get",
    generateGetRow: (_expr: MethodCallNode, _params: string[]): string => "%mock_sqlite_get_row",
    generateAll: (_expr: MethodCallNode, _params: string[]): string => "%mock_sqlite_all",
    generateQuery: (_expr: MethodCallNode, _params: string[]): string => "%mock_sqlite_query",
    generateClose: (_expr: MethodCallNode, _params: string[]): string => "%mock_sqlite_close",
  };
  arrowFunctionGen: IArrowFunctionGenerator = {
    generateArrowFunction: (
      _expr: Expression,
      _params: string[],
      _typeHints: { paramTypes?: string[]; returnType?: string } | undefined,
      _scopeVarNames: string[] | undefined,
      _scopeVarTypes: string[] | undefined,
    ): string => "__mock_lambda",
    getClosureInfoForLambda: (
      _lambdaName: string,
    ): { captures: { name: string; llvmType: string }[]; envStructName: string } | undefined =>
      undefined,
  };
  mapGen: IMapGenerator = {
    generateMapLiteral: (_expr: MapNode, _params: string[]): string => "%mock_map_literal",
    generateMapSet: (_expr: MethodCallNode, _params: string[]): string => "%mock_map_set",
    generateMapGet: (_expr: MethodCallNode, _params: string[]): string => "%mock_map_get",
    generateMapHas: (_expr: MethodCallNode, _params: string[]): string => "%mock_map_has",
    generateMapDelete: (_expr: MethodCallNode, _params: string[]): string => "%mock_map_delete",
    generateMapClear: (_expr: MethodCallNode, _params: string[]): string => "%mock_map_clear",
    generateMapSize: (_mapPtr: string): string => "%mock_map_size",
  };
  setGen: ISetGenerator = {
    generateSetLiteral: (_expr: SetNode, _params: string[]): string => "%mock_set_literal",
    generateSetAdd: (_expr: MethodCallNode, _params: string[]): string => "%mock_set_add",
    generateSetHas: (_expr: MethodCallNode, _params: string[]): string => "%mock_set_has",
    generateSetDelete: (_expr: MethodCallNode, _params: string[]): string => "%mock_set_delete",
    generateSetSize: (_setPtr: string): string => "%mock_set_size",
  };
  stringSetGen: IStringSetGenerator = {
    generateEmptyStringSet: (): string => "%mock_empty_string_set",
    generateStringSetAdd: (_setAlloca: string, _valueValue: string): string =>
      "%mock_string_set_add",
    generateStringSetHas: (_setAlloca: string, _valueValue: string): string =>
      "%mock_string_set_has",
    generateStringSetDelete: (_setAlloca: string, _valueValue: string): string =>
      "%mock_string_set_delete",
  };
  pointerMapGen: IPointerMapGenerator = {
    generatePointerMapSet: (_mapPtr: string, _keyValue: string, _valueValue: string): string =>
      "%mock_pointer_map_set",
    generatePointerMapGet: (_mapPtr: string, _keyValue: string, _valueType: string): string =>
      "%mock_pointer_map_get",
    generatePointerMapClear: (_mapPtr: string): string => "%mock_pointer_map_clear",
  };
  embedGen: IEmbedGenerator = {
    generateEmbedFile: (_expr: MethodCallNode, _params: string[]): string => "%mock_embed_file",
    generateEmbedDir: (_expr: MethodCallNode, _params: string[]): string => "%mock_embed_dir",
    generateGetEmbeddedFile: (_expr: MethodCallNode, _params: string[]): string =>
      "%mock_get_embedded",
    generateGetEmbeddedFileAsUint8Array: (_expr: MethodCallNode, _params: string[]): string =>
      "%mock_get_embedded_uint8array",
    generateServeEmbedded: (_expr: MethodCallNode, _params: string[]): string =>
      "%mock_serve_embedded",
    generateLookupFunction: (): string => "",
    generateLengthLookupFunction: (): string => "",
    hasEmbeddedFiles: (): boolean => false,
  };
  childProcessGen: IChildProcessGenerator = {
    canHandle: (_expr: MethodCallNode): boolean => false,
    generateExecSync: (_expr: MethodCallNode, _params: string[]): string => "%mock_execsync",
    generateBareExecSync: (_expr: CallNode, _params: string[]): string => "%mock_bare_execsync",
    generateSpawnSync: (_expr: MethodCallNode, _params: string[]): string => "%mock_spawnsync",
    generateExec: (_expr: MethodCallNode, _params: string[]): string => "%mock_exec",
    generateSpawn: (_expr: MethodCallNode, _params: string[]): string => "%mock_spawn",
  };
  arrayGen: IArrayGenerator = {
    generateArrayLiteral: (_expr: ArrayNode, _params: string[]): string => "%mock_array_literal",
    generateArrayPush: (_expr: MethodCallNode, _params: string[]): string => "%mock_array_push",
    generateArrayPop: (_expr: MethodCallNode, _params: string[]): string => "%mock_array_pop",
    generateArrayIncludes: (_expr: MethodCallNode, _params: string[]): string =>
      "%mock_array_includes",
    generateArrayMap: (_expr: MethodCallNode, _params: string[]): string => "%mock_array_map",
    generateStringArrayMap: (_expr: MethodCallNode, _params: string[]): string =>
      "%mock_string_array_map",
    generateArrayJoin: (_expr: MethodCallNode, _params: string[]): string => "%mock_array_join",
    generateArrayFind: (_expr: MethodCallNode, _params: string[]): string => "%mock_array_find",
    generateArraySome: (_expr: MethodCallNode, _params: string[]): string => "%mock_array_some",
    generateArrayEvery: (_expr: MethodCallNode, _params: string[]): string => "%mock_array_every",
    generateArrayFilter: (_expr: MethodCallNode, _params: string[]): string => "%mock_array_filter",
    generateArrayForEach: (_expr: MethodCallNode, _params: string[]): string =>
      "%mock_array_foreach",
    generateArrayReduce: (_expr: MethodCallNode, _params: string[]): string => "%mock_array_reduce",
    generateArraySlice: (_expr: MethodCallNode, _params: string[]): string => "%mock_array_slice",
    generateArrayConcat: (_expr: MethodCallNode, _params: string[]): string => "%mock_array_concat",
    generateArrayReverse: (_expr: MethodCallNode, _params: string[]): string =>
      "%mock_array_reverse",
    generateArrayShift: (_expr: MethodCallNode, _params: string[]): string => "%mock_array_shift",
    generateArrayUnshift: (_expr: MethodCallNode, _params: string[]): string =>
      "%mock_array_unshift",
    generateArrayIndexOf: (_expr: MethodCallNode, _params: string[]): string =>
      "%mock_array_indexof",
    generateArrayFindIndex: (_expr: MethodCallNode, _params: string[]): string =>
      "%mock_array_findindex",
    generateArraySort: (_expr: MethodCallNode, _params: string[]): string => "%mock_array_sort",
    generateArraySplice: (_expr: MethodCallNode, _params: string[]): string => "%mock_array_splice",
  };

  resolveImportAlias(localName: string): string {
    return localName;
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

  mangleUserName(name: string): string {
    if (name.startsWith("__")) return name;
    return `_cs_${name}`;
  }

  typeResolverGetUnionCommonFields(_memberNames: string[]): {
    keys: string[];
    types: string[];
    tsTypes: string[];
  } {
    return { keys: [], types: [], tsTypes: [] };
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
  typeResolverGetClassFieldMapType(
    _className: string,
    _fieldName: string,
  ): { keyType: string; valueType: string } | null {
    return null;
  }
  typeResolverGetInterfaceMetadata(
    _name: string,
  ): { keys: string[]; types: string[]; tsTypes?: string[] } | null {
    return null;
  }
  typeResolverGetInterface(_name: string): InterfaceDeclaration | null {
    return null;
  }

  reset(): void {
    this.tempCount = 0;
    this.labelCount = 0;
    this.stringCount = 0;
    this.output = [];
    this.outputIsTerminator = [];
    this.variableTypes.clear();
    this.currentLabel = "entry";
  }

  getAstInterfacesLength(): number {
    if (!this.ast || !this.ast.interfaces) return 0;
    return this.ast.interfaces.length;
  }

  getAstInterfaceAt(index: number): InterfaceDeclaration | null {
    if (!this.ast || !this.ast.interfaces || index < 0 || index >= this.ast.interfaces.length)
      return null;
    return this.ast.interfaces[index];
  }

  getAstInterfaceNameAt(index: number): string | null {
    if (!this.ast || !this.ast.interfaces || index < 0 || index >= this.ast.interfaces.length)
      return null;
    const iface = this.ast.interfaces[index];
    if (!iface || !iface.name) return null;
    return iface.name;
  }

  getAstFunctionsLength(): number {
    if (!this.ast || !this.ast.functions) return 0;
    return this.ast.functions.length;
  }

  getAstFunctionAt(index: number): FunctionNode | null {
    if (!this.ast || !this.ast.functions || index < 0 || index >= this.ast.functions.length)
      return null;
    return this.ast.functions[index];
  }

  getAstFunctionNameAt(index: number): string | null {
    if (!this.ast || !this.ast.functions || index < 0 || index >= this.ast.functions.length)
      return null;
    const func = this.ast.functions[index];
    if (!func || !func.name) return null;
    return func.name;
  }

  getAstClassesLength(): number {
    if (!this.ast || !this.ast.classes) return 0;
    return this.ast.classes.length;
  }

  getAstClassAt(index: number): ClassNode | null {
    if (!this.ast || !this.ast.classes || index < 0 || index >= this.ast.classes.length)
      return null;
    return this.ast.classes[index];
  }

  getAstClassNameAt(index: number): string | null {
    if (!this.ast || !this.ast.classes || index < 0 || index >= this.ast.classes.length)
      return null;
    const cls = this.ast.classes[index];
    if (!cls || !cls.name) return null;
    return cls.name;
  }

  getAstTypeAliasesLength(): number {
    if (!this.ast || !this.ast.typeAliases) return 0;
    return this.ast.typeAliases.length;
  }

  getAstTypeAliasAt(index: number): TypeAliasDeclaration | null {
    if (!this.ast || !this.ast.typeAliases || index < 0 || index >= this.ast.typeAliases.length)
      return null;
    return this.ast.typeAliases[index];
  }

  getAstTypeAliasNameAt(index: number): string | null {
    if (!this.ast || !this.ast.typeAliases || index < 0 || index >= this.ast.typeAliases.length)
      return null;
    const ta = this.ast.typeAliases[index];
    if (!ta || !ta.name) return null;
    return ta.name;
  }

  getAstTypeAliasMembersAt(index: number): string[] | null {
    if (!this.ast || !this.ast.typeAliases || index < 0 || index >= this.ast.typeAliases.length)
      return null;
    const ta = this.ast.typeAliases[index];
    if (!ta || !ta.unionMembers) return null;
    return ta.unionMembers;
  }

  setStackEligibleVars(vars: string[]): void {
    this.stackEligibleVars = vars;
  }

  isStackEligibleKey(key: string): boolean {
    for (let i = 0; i < this.stackEligibleVars.length; i++) {
      if (this.stackEligibleVars[i] === key) return true;
    }
    return false;
  }

  setCurrentVarDeclKey(key: string | null): void {
    this.currentVarDeclKey = key;
  }

  getCurrentVarDeclKey(): string | null {
    return this.currentVarDeclKey;
  }
}
