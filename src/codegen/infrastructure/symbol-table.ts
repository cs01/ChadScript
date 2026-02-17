/**
 * Symbol Table - Unified variable tracking for LLVM code generation
 *
 * Replaces 12 separate tracking maps with a single, type-safe symbol table.
 * Tracks all variables with their LLVM types, allocations, and metadata.
 *
 * Previously tracked separately:
 * - variables, variableTypes, stringVariables, arrayVariables,
 *   stringArrayVariables, objectVariables, mapVariables, setVariables,
 *   classInstanceVariables, regexVariables, jsonObjectVariables,
 *   processArgvVariables
 */

import type { ResolvedType } from './type-system.js';
import type { TypeContext } from './type-context.js';

/**
 * Symbol kind for different variable types
 */
export enum SymbolKind {
  Number,
  String,
  Boolean,
  Array,
  StringArray,
  BooleanArray,
  ObjectArray,
  Object,
  Map,
  Set,
  Class,
  Regex,
  JSON,
  ProcessArgv,
  Closure,
  Pointer,
  Uint8Array
}

/**
 * Object-specific metadata
 */
export interface ObjectMetadata {
  keys: string[];
  types: string[];  // LLVM types for each field
  tsTypes?: string[];  // TypeScript types for nested interface resolution
}

/**
 * Class-specific metadata
 */
export interface ClassMetadata {
  className: string;
  fields?: string[];  // Field names
}

/**
 * Return type for getClassInfo method
 */
export interface ClassInfo {
  ptr: string;
  className: string;
}

/**
 * Array-specific metadata
 */
export interface ArrayMetadata {
  elementType: 'string' | 'number' | 'boolean';
}

/**
 * Object array metadata - for arrays of typed objects (e.g., ObjectProperty[])
 */
export interface ObjectArrayMetadata {
  elementInterfaceName: string;
  elementKeys: string[];
  elementTypes: string[];  // LLVM types for each field
  elementTsTypes?: string[];  // TypeScript types for nested resolution
}

/**
 * Closure-specific metadata
 */
export interface ClosureMetadata {
  lambdaName: string;          // The lifted function name (e.g., __lambda_0)
  envStructName: string;       // The environment struct type name
  envPtrRegister: string;      // Register holding the environment pointer
  captures: { name: string; llvmType: string }[];  // Captured variables
}

/**
 * Map-specific metadata for typed Maps
 */
export interface MapMetadata {
  keyType: 'string' | 'number';   // TypeScript key type
  valueType: string;              // TypeScript value type (string, number, or interface name)
  llvmKeyType: string;            // LLVM type for keys (i8* for string, double for number)
  llvmValueType: string;          // LLVM type for values
}

/**
 * Set-specific metadata for typed Sets
 */
export interface SetMetadata {
  valueType: 'string' | 'number'; // TypeScript value type
  llvmValueType: string;          // LLVM type for values (i8* for string, double for number)
}

/**
 * Combined metadata type for symbol definitions
 */
export interface SymbolMetadata {
  objectMetadata?: ObjectMetadata;
  classMetadata?: ClassMetadata;
  arrayMetadata?: ArrayMetadata;
  objectArrayMetadata?: ObjectArrayMetadata;
  closureMetadata?: ClosureMetadata;
  mapMetadata?: MapMetadata;
  setMetadata?: SetMetadata;
  isPointerAlloca?: boolean;
  interfaceType?: string;
  concreteClass?: string;
  resolvedType?: ResolvedType;
  unionType?: string;
  unionMembers?: string[];
}

export function createPointerAllocaMetadata(): SymbolMetadata {
  return {
    objectMetadata: undefined,
    classMetadata: undefined,
    arrayMetadata: undefined,
    objectArrayMetadata: undefined,
    closureMetadata: undefined,
    mapMetadata: undefined,
    setMetadata: undefined,
    isPointerAlloca: true,
    interfaceType: undefined,
    resolvedType: undefined,
    unionType: undefined,
    unionMembers: undefined
  };
}

export function createInterfacePointerAllocaMetadata(interfaceType: string, concreteClass?: string): SymbolMetadata {
  return {
    objectMetadata: undefined,
    classMetadata: undefined,
    arrayMetadata: undefined,
    objectArrayMetadata: undefined,
    closureMetadata: undefined,
    mapMetadata: undefined,
    setMetadata: undefined,
    isPointerAlloca: true,
    interfaceType: interfaceType,
    concreteClass: concreteClass,
    resolvedType: undefined,
    unionType: undefined,
    unionMembers: undefined
  };
}

export function createInterfaceMetadata(interfaceType: string, concreteClass?: string): SymbolMetadata {
  return {
    objectMetadata: undefined,
    classMetadata: undefined,
    arrayMetadata: undefined,
    objectArrayMetadata: undefined,
    closureMetadata: undefined,
    mapMetadata: undefined,
    setMetadata: undefined,
    isPointerAlloca: undefined,
    interfaceType: interfaceType,
    concreteClass: concreteClass,
    resolvedType: undefined,
    unionType: undefined,
    unionMembers: undefined
  };
}

export function createObjectMetadata(objectMetadata: ObjectMetadata): SymbolMetadata {
  return {
    objectMetadata: objectMetadata,
    classMetadata: undefined,
    arrayMetadata: undefined,
    objectArrayMetadata: undefined,
    closureMetadata: undefined,
    mapMetadata: undefined,
    setMetadata: undefined,
    isPointerAlloca: undefined,
    interfaceType: undefined,
    resolvedType: undefined,
    unionType: undefined,
    unionMembers: undefined
  };
}

export function createObjectMetadataWithInterface(objectMetadata: ObjectMetadata, interfaceType: string): SymbolMetadata {
  return {
    objectMetadata: objectMetadata,
    classMetadata: undefined,
    arrayMetadata: undefined,
    objectArrayMetadata: undefined,
    closureMetadata: undefined,
    mapMetadata: undefined,
    setMetadata: undefined,
    isPointerAlloca: undefined,
    interfaceType: interfaceType,
    resolvedType: undefined,
    unionType: undefined,
    unionMembers: undefined
  };
}

export function createObjectMetadataWithPointerAlloca(objectMetadata: ObjectMetadata, isPointerAlloca: boolean): SymbolMetadata {
  return {
    objectMetadata: objectMetadata,
    classMetadata: undefined,
    arrayMetadata: undefined,
    objectArrayMetadata: undefined,
    closureMetadata: undefined,
    mapMetadata: undefined,
    setMetadata: undefined,
    isPointerAlloca: isPointerAlloca,
    interfaceType: undefined,
    resolvedType: undefined,
    unionType: undefined,
    unionMembers: undefined
  };
}

export function createObjectMetadataWithInterfaceAndPointerAlloca(objectMetadata: ObjectMetadata, interfaceType: string, isPointerAlloca: boolean): SymbolMetadata {
  return {
    objectMetadata: objectMetadata,
    classMetadata: undefined,
    arrayMetadata: undefined,
    objectArrayMetadata: undefined,
    closureMetadata: undefined,
    mapMetadata: undefined,
    setMetadata: undefined,
    isPointerAlloca: isPointerAlloca,
    interfaceType: interfaceType,
    resolvedType: undefined,
    unionType: undefined,
    unionMembers: undefined
  };
}

export function createClassMetadata(classMetadata: ClassMetadata): SymbolMetadata {
  return {
    objectMetadata: undefined,
    classMetadata: classMetadata,
    arrayMetadata: undefined,
    objectArrayMetadata: undefined,
    closureMetadata: undefined,
    mapMetadata: undefined,
    setMetadata: undefined,
    isPointerAlloca: undefined,
    interfaceType: undefined,
    concreteClass: classMetadata.className,
    resolvedType: undefined,
    unionType: undefined,
    unionMembers: undefined
  };
}

export function createClosureMetadataSymbol(closureMetadata: ClosureMetadata): SymbolMetadata {
  return {
    objectMetadata: undefined,
    classMetadata: undefined,
    arrayMetadata: undefined,
    objectArrayMetadata: undefined,
    closureMetadata: closureMetadata,
    mapMetadata: undefined,
    setMetadata: undefined,
    isPointerAlloca: undefined,
    interfaceType: undefined,
    resolvedType: undefined,
    unionType: undefined,
    unionMembers: undefined
  };
}

export function createMapMetadataSymbol(mapMetadata: MapMetadata): SymbolMetadata {
  return {
    objectMetadata: undefined,
    classMetadata: undefined,
    arrayMetadata: undefined,
    objectArrayMetadata: undefined,
    closureMetadata: undefined,
    mapMetadata: mapMetadata,
    setMetadata: undefined,
    isPointerAlloca: undefined,
    interfaceType: undefined,
    resolvedType: undefined,
    unionType: undefined,
    unionMembers: undefined
  };
}

export function createSetMetadataSymbol(setMetadata: SetMetadata): SymbolMetadata {
  return {
    objectMetadata: undefined,
    classMetadata: undefined,
    arrayMetadata: undefined,
    objectArrayMetadata: undefined,
    closureMetadata: undefined,
    mapMetadata: undefined,
    setMetadata: setMetadata,
    isPointerAlloca: undefined,
    interfaceType: undefined,
    resolvedType: undefined,
    unionType: undefined,
    unionMembers: undefined
  };
}

export function createObjectArrayMetadataSymbol(objectArrayMetadata: ObjectArrayMetadata): SymbolMetadata {
  return {
    objectMetadata: undefined,
    classMetadata: undefined,
    arrayMetadata: undefined,
    objectArrayMetadata: objectArrayMetadata,
    closureMetadata: undefined,
    mapMetadata: undefined,
    setMetadata: undefined,
    isPointerAlloca: undefined,
    interfaceType: undefined,
    resolvedType: undefined,
    unionType: undefined,
    unionMembers: undefined
  };
}

export function createUnionMetadata(objectMetadata: ObjectMetadata, unionType: string, unionMembers: string[]): SymbolMetadata {
  return {
    objectMetadata: objectMetadata,
    classMetadata: undefined,
    arrayMetadata: undefined,
    objectArrayMetadata: undefined,
    closureMetadata: undefined,
    mapMetadata: undefined,
    setMetadata: undefined,
    isPointerAlloca: undefined,
    interfaceType: undefined,
    resolvedType: undefined,
    unionType: unionType,
    unionMembers: unionMembers
  };
}

/**
 * Symbol entry in the symbol table
 */
export interface Symbol {
  name: string;
  kind: number;
  llvmType: string;           // e.g., 'double', 'i8*', '%Array*'
  allocaRegister: string;     // e.g., '%1', '%foo'
  scope: string;  // Function-local or top-level

  // True if alloca contains a pointer (e.g., function parameter %Array** holding %Array*)
  // False if alloca contains the value directly (e.g., local %Array* pointing to %Array struct)
  isPointerAlloca?: boolean;

  // Cached ResolvedType for efficient type lookups
  resolvedType?: ResolvedType;

  // Optional metadata for complex types
  objectMetadata?: ObjectMetadata;
  classMetadata?: ClassMetadata;
  arrayMetadata?: ArrayMetadata;
  objectArrayMetadata?: ObjectArrayMetadata;
  closureMetadata?: ClosureMetadata;
  mapMetadata?: MapMetadata;
  setMetadata?: SetMetadata;
  interfaceType?: string;
  concreteClass?: string;
}

/**
 * Unified Symbol Table for code generation.
 *
 * @example
 * const symbolTable = new SymbolTable();
 *
 * // Define a number variable
 * symbolTable.define('x', SymbolKind.Number, 'double', '%1', 'local');
 *
 * // Define a string variable
 * symbolTable.define('name', SymbolKind.String, 'i8*', '%2', 'local');
 *
 * // Define an object with metadata
 * symbolTable.define('user', SymbolKind.Object, '%User*', '%3', 'local', {
 *   objectMetadata: {
 *     keys: ['name', 'age'],
 *     types: ['i8*', 'double']
 *   }
 * });
 *
 * // Lookup
 * const x = symbolTable.lookup('x');
 * console.log(x?.llvmType); // 'double'
 *
 * // Type-safe checks
 * if (symbolTable.isString('name')) {
 *   const str = symbolTable.lookup('name')!;
 *   console.log(str.allocaRegister); // '%2'
 * }
 */
export class SymbolTable {
  private symbols: Map<string, Symbol>;
  private symbolKeys: string[];
  private symbolKeysCount: number = 0;
  private narrowedTypes: Map<string, ObjectMetadata[]>;
  private interfaceTypes: Map<string, string>;
  private scopeNames: string[];
  private scopeNamesCount: number = 0;
  private scopeBoundaries: number[];
  private scopeBoundariesCount: number = 0;
  private typeContext: TypeContext | null;

  constructor(typeContext?: TypeContext) {
    this.symbols = new Map();
    this.symbolKeys = [];
    this.narrowedTypes = new Map();
    this.interfaceTypes = new Map();
    this.scopeNames = [];
    this.scopeBoundaries = [];
    this.typeContext = typeContext || null;
  }

  pushScope(kind: string): void {
    this.scopeBoundaries.push(this.scopeNamesCount);
    this.scopeBoundariesCount++;
  }

  popScope(): void {
    if (this.scopeBoundariesCount === 0) return;
    this.scopeBoundariesCount--;
    const boundary = this.scopeBoundaries[this.scopeBoundariesCount];
    this.scopeBoundaries.length = this.scopeBoundariesCount;
    for (let i = this.scopeNamesCount - 1; i >= boundary; i--) {
      const name = this.scopeNames[i];
      this.symbols.delete(name);
      this.interfaceTypes.delete(name);
    }
    this.scopeNamesCount = boundary;
    this.scopeNames.length = boundary;
    let writeIdx = 0;
    const count = this.symbolKeysCount;
    for (let readIdx = 0; readIdx < count; readIdx++) {
      const key = this.symbolKeys[readIdx];
      if (!key) continue;
      if (this.symbols.has(key)) {
        if (writeIdx !== readIdx) {
          this.symbolKeys[writeIdx] = key;
        }
        writeIdx++;
      }
    }
    this.symbolKeysCount = writeIdx;
  }

  lookupLocal(name: string): Symbol | undefined {
    if (!name) return undefined;
    if (this.scopeBoundariesCount === 0) return this.symbols.get(name);
    const boundary = this.scopeBoundaries[this.scopeBoundariesCount - 1];
    for (let i = boundary; i < this.scopeNamesCount; i++) {
      if (this.scopeNames[i] === name) {
        return this.symbols.get(name);
      }
    }
    return undefined;
  }

  /**
   * Narrow a symbol's object metadata (for type guards like `if (x.type === '...')`)
   * Pushes the new metadata onto a stack so it can be restored later.
   */
  narrowType(name: string, narrowedMetadata: ObjectMetadata): void {
    const symbol = this.symbols.get(name);
    if (!symbol) return;

    if (!this.narrowedTypes.has(name)) {
      this.narrowedTypes.set(name, []);
    }
    const stack = this.narrowedTypes.get(name)!;
    stack.push(symbol.objectMetadata || { keys: [], types: [] });

    symbol.objectMetadata = narrowedMetadata;
    symbol.kind = SymbolKind.Object;
  }

  /**
   * Restore a symbol's object metadata after leaving a narrowed scope.
   */
  restoreType(name: string): void {
    const symbol = this.symbols.get(name);
    if (!symbol) return;

    const stack = this.narrowedTypes.get(name);
    if (stack && stack.length > 0) {
      symbol.objectMetadata = stack.pop();
    }
  }

  /**
   * Define a new symbol in the table
   */
  define(
    name: string,
    kind: number,
    llvmType: string,
    allocaRegister: string,
    scope: string
  ): void {
    if (!name) return;
    const symbol: Symbol = {
      name,
      kind,
      llvmType,
      allocaRegister,
      scope,
      isPointerAlloca: false,
      resolvedType: undefined,
      objectMetadata: undefined,
      classMetadata: undefined,
      arrayMetadata: undefined,
      objectArrayMetadata: undefined,
      closureMetadata: undefined,
      mapMetadata: undefined,
      setMetadata: undefined,
      interfaceType: undefined,
      concreteClass: undefined
    };
    if (!this.symbols.has(name)) {
      this.symbolKeys.push(name);
      this.symbolKeysCount++;
    }
    this.symbols.set(name, symbol);
    if (scope === 'local' && this.scopeBoundariesCount > 0) {
      this.scopeNames.push(name);
      this.scopeNamesCount++;
    }
  }

  defineWithMetadata(
    name: string,
    kind: number,
    llvmType: string,
    allocaRegister: string,
    scope: string,
    metadata: SymbolMetadata
  ): void {
    if (!name) return;
    const symbol: Symbol = {
      name,
      kind,
      llvmType,
      allocaRegister,
      scope,
      isPointerAlloca: false,
      resolvedType: undefined,
      objectMetadata: undefined,
      classMetadata: undefined,
      arrayMetadata: undefined,
      objectArrayMetadata: undefined,
      closureMetadata: undefined,
      mapMetadata: undefined,
      setMetadata: undefined,
      interfaceType: undefined,
      concreteClass: undefined
    };
    if (metadata.objectMetadata) symbol.objectMetadata = metadata.objectMetadata;
    if (metadata.classMetadata) symbol.classMetadata = metadata.classMetadata;
    if (metadata.arrayMetadata) symbol.arrayMetadata = metadata.arrayMetadata;
    if (metadata.objectArrayMetadata) symbol.objectArrayMetadata = metadata.objectArrayMetadata;
    if (metadata.closureMetadata) symbol.closureMetadata = metadata.closureMetadata;
    if (metadata.mapMetadata) symbol.mapMetadata = metadata.mapMetadata;
    if (metadata.setMetadata) symbol.setMetadata = metadata.setMetadata;
    if (metadata.isPointerAlloca !== undefined) symbol.isPointerAlloca = metadata.isPointerAlloca;
    if (metadata.interfaceType) {
      symbol.interfaceType = metadata.interfaceType;
      this.interfaceTypes.set(name, metadata.interfaceType);
    }
    if (metadata.concreteClass) symbol.concreteClass = metadata.concreteClass;
    if (metadata.resolvedType) symbol.resolvedType = metadata.resolvedType;
    if (!this.symbols.has(name)) {
      this.symbolKeys.push(name);
      this.symbolKeysCount++;
    }
    this.symbols.set(name, symbol);
    if (scope === 'local' && this.scopeBoundariesCount > 0) {
      this.scopeNames.push(name);
      this.scopeNamesCount++;
    }
  }

  /**
   * Look up a symbol by name
   */
  lookup(name: string): Symbol | undefined {
    if (!name) return undefined;
    return this.symbols.get(name);
  }

  /**
   * Check if a symbol exists
   */
  has(name: string): boolean {
    if (!name) return false;
    return this.symbols.has(name);
  }

  /**
   * Get LLVM type for a variable
   */
  getType(name: string): string | undefined {
    if (!name) return undefined;
    const symbol = this.symbols.get(name);
    if (symbol) {
      return symbol.llvmType;
    }
    return undefined;
  }

  getScope(name: string): string | undefined {
    if (!name) return undefined;
    const symbol = this.symbols.get(name);
    if (symbol) {
      return symbol.scope;
    }
    return undefined;
  }

  /**
   * Get alloca register for a variable
   */
  getAlloca(name: string): string | undefined {
    if (!name) return undefined;
    const symbol = this.symbols.get(name);
    if (symbol) {
      return symbol.allocaRegister;
    }
    return undefined;
  }

  /**
   * Get symbol kind for a variable
   */
  getKind(name: string): number | undefined {
    if (!name) return undefined;
    const symbol = this.symbols.get(name);
    if (symbol) {
      return symbol.kind;
    }
    return undefined;
  }

  /**
   * Get interface type for a variable (if it's an interface-typed object)
   */
  getInterfaceType(name: string): string | undefined {
    if (!name) return undefined;
    if (name.length === 0) return undefined;
    const symbol = this.symbols.get(name);
    if (symbol) {
      const k = symbol.kind;
      if (k === SymbolKind.Array || k === SymbolKind.StringArray || k === SymbolKind.BooleanArray || k === SymbolKind.ObjectArray) {
        return undefined;
      }
    }
    return this.interfaceTypes.get(name);
  }

  getObjectArrayElementType(name: string): string | undefined {
    if (!name) return undefined;
    const symbol = this.symbols.get(name);
    if (symbol && symbol.kind === SymbolKind.ObjectArray) {
      return this.interfaceTypes.get(name);
    }
    return undefined;
  }

  getRawInterfaceType(name: string): string | undefined {
    return this.interfaceTypes.get(name);
  }

  setRawInterfaceType(name: string, type: string): void {
    this.interfaceTypes.set(name, type);
  }

  getConcreteClass(name: string): string | undefined {
    if (!name) return undefined;
    const symbol = this.symbols.get(name);
    if (symbol) {
      if (symbol.concreteClass) return symbol.concreteClass;
      if (symbol.classMetadata) return symbol.classMetadata.className;
    }
    return undefined;
  }

  setConcreteClass(name: string, concreteClass: string): void {
    if (!name) return;
    const symbol = this.symbols.get(name);
    if (symbol) {
      symbol.concreteClass = concreteClass;
    }
  }

  /**
   * Get resolved type for a variable (cached ResolvedType)
   */
  getResolvedType(name: string): ResolvedType | undefined {
    if (!name) return undefined;
    const symbol = this.symbols.get(name);
    if (symbol) {
      return symbol.resolvedType;
    }
    return undefined;
  }

  /**
   * Set resolved type for a variable (cache ResolvedType)
   */
  setResolvedType(name: string, resolvedType: ResolvedType): void {
    if (!name) return;
    const symbol = this.symbols.get(name);
    if (symbol) {
      symbol.resolvedType = resolvedType;
    }
  }

  /**
   * Check if alloca contains a pointer (requires load) vs value directly
   */
  isPointerAlloca(name: string): boolean {
    const symbol = this.symbols.get(name);
    if (symbol) {
      return symbol.isPointerAlloca === true;
    }
    return false;
  }

  /**
   * Update alloca register (e.g., after load)
   */
  updateAlloca(name: string, allocaRegister: string): void {
    const symbol = this.symbols.get(name);
    if (symbol) {
      symbol.allocaRegister = allocaRegister;
    }
  }

  /**
   * Remove a symbol from the table
   */
  remove(name: string): void {
    this.symbols.delete(name);
    this.interfaceTypes.delete(name);
  }

  /**
   * Clear all symbols (e.g., when entering new function scope)
   */
  clear(): void {
    this.symbols.clear();
    this.symbolKeys = [];
    this.interfaceTypes.clear();
  }

  /**
   * Clear only local symbols (preserve globals)
   */
  clearLocals(): void {
    if (this.symbolKeysCount === 0) {
      return;
    }
    let writeIdx = 0;
    const count = this.symbolKeysCount;
    for (let readIdx = 0; readIdx < count; readIdx++) {
      const name = this.symbolKeys[readIdx];
      if (!name) {
        continue;
      }
      const symbol = this.symbols.get(name);
      if (symbol && symbol.scope === 'local') {
        this.symbols.delete(name);
        this.interfaceTypes.delete(name);
      } else {
        if (writeIdx !== readIdx) {
          this.symbolKeys[writeIdx] = name;
        }
        writeIdx++;
      }
    }
    this.symbolKeysCount = writeIdx;
  }

  /**
   * Get all symbols
   */
  getAll(): Symbol[] {
    const result: Symbol[] = [];
    for (let i = 0; i < this.symbolKeys.length; i++) {
      const name = this.symbolKeys[i];
      if (!name) {
        continue;
      }
      const symbol = this.symbols.get(name);
      if (symbol) {
        result.push(symbol);
      }
    }
    return result;
  }

  /**
   * Get all symbols of a specific kind
   */
  getByKind(kind: number): Symbol[] {
    const result: Symbol[] = [];
    for (let i = 0; i < this.symbolKeys.length; i++) {
      const name = this.symbolKeys[i];
      if (!name) {
        continue;
      }
      const s = this.symbols.get(name);
      if (s && s.kind === kind) {
        result.push(s);
      }
    }
    return result;
  }

  /**
   * Get all local symbols
   */
  getLocals(): Symbol[] {
    const result: Symbol[] = [];
    for (let i = 0; i < this.symbolKeys.length; i++) {
      const name = this.symbolKeys[i];
      if (!name) {
        continue;
      }
      const s = this.symbols.get(name);
      if (s && s.scope === 'local') {
        result.push(s);
      }
    }
    return result;
  }

  /**
   * Get all global symbols
   */
  getGlobals(): Symbol[] {
    const result: Symbol[] = [];
    for (let i = 0; i < this.symbolKeys.length; i++) {
      const name = this.symbolKeys[i];
      if (!name) {
        continue;
      }
      const s = this.symbols.get(name);
      if (s && s.scope === 'global') {
        result.push(s);
      }
    }
    return result;
  }

  // ============================================
  // Type-safe predicates
  // ============================================

  private getSymbolKind(name: string): number | undefined {
    const symbol = this.symbols.get(name);
    if (symbol) {
      return symbol.kind;
    }
    return undefined;
  }

  isNumber(name: string): boolean {
    const symbol = this.symbols.get(name);
    if (!symbol) { return false; }
    const k = symbol.kind;
    const m = SymbolKind.Number;
    if (k === m) { return true; }
    return false;
  }

  isString(name: string): boolean {
    const symbol = this.symbols.get(name);
    if (!symbol) { return false; }
    const k = symbol.kind;
    const m = SymbolKind.String;
    if (k === m) { return true; }
    return false;
  }

  isBoolean(name: string): boolean {
    const symbol = this.symbols.get(name);
    if (!symbol) { return false; }
    const k = symbol.kind;
    const m = SymbolKind.Boolean;
    if (k === m) { return true; }
    return false;
  }

  isArray(name: string): boolean {
    const symbol = this.symbols.get(name);
    if (!symbol) { return false; }
    const k = symbol.kind;
    if (k === SymbolKind.Array) { return true; }
    if (k === SymbolKind.StringArray) { return true; }
    if (k === SymbolKind.BooleanArray) { return true; }
    return false;
  }

  isNumberArray(name: string): boolean {
    const symbol = this.symbols.get(name);
    if (!symbol) { return false; }
    const k = symbol.kind;
    const m = SymbolKind.Array;
    if (k === m) { return true; }
    return false;
  }

  isStringArray(name: string): boolean {
    const symbol = this.symbols.get(name);
    if (!symbol) { return false; }
    const k = symbol.kind;
    const m = SymbolKind.StringArray;
    if (k === m) { return true; }
    return false;
  }

  isBooleanArray(name: string): boolean {
    const symbol = this.symbols.get(name);
    if (!symbol) { return false; }
    const k = symbol.kind;
    const m = SymbolKind.BooleanArray;
    if (k === m) { return true; }
    return false;
  }

  isObject(name: string): boolean {
    const symbol = this.symbols.get(name);
    if (!symbol) { return false; }
    const k = symbol.kind;
    const m = SymbolKind.Object;
    if (k === m) { return true; }
    return false;
  }

  isMap(name: string): boolean {
    const symbol = this.symbols.get(name);
    if (!symbol) {
      return false;
    }
    const k = symbol.kind;
    const m = SymbolKind.Map;
    if (k === m) {
      return true;
    }
    return false;
  }

  isSet(name: string): boolean {
    const symbol = this.symbols.get(name);
    if (!symbol) { return false; }
    const k = symbol.kind;
    const m = SymbolKind.Set;
    if (k === m) { return true; }
    return false;
  }

  isClass(name: string): boolean {
    const symbol = this.symbols.get(name);
    if (!symbol) { return false; }
    const k = symbol.kind;
    const m = SymbolKind.Class;
    if (k === m) { return true; }
    return false;
  }

  isRegex(name: string): boolean {
    const symbol = this.symbols.get(name);
    if (!symbol) { return false; }
    const k = symbol.kind;
    const m = SymbolKind.Regex;
    if (k === m) { return true; }
    return false;
  }

  isJSON(name: string): boolean {
    const symbol = this.symbols.get(name);
    if (!symbol) { return false; }
    const k = symbol.kind;
    const m = SymbolKind.JSON;
    if (k === m) { return true; }
    return false;
  }

  isProcessArgv(name: string): boolean {
    const symbol = this.symbols.get(name);
    if (!symbol) { return false; }
    const k = symbol.kind;
    const m = SymbolKind.ProcessArgv;
    if (k === m) { return true; }
    return false;
  }

  isClosure(name: string): boolean {
    const symbol = this.symbols.get(name);
    if (!symbol) { return false; }
    const k = symbol.kind;
    const m = SymbolKind.Closure;
    if (k === m) { return true; }
    return false;
  }

  isObjectArray(name: string): boolean {
    const symbol = this.symbols.get(name);
    if (!symbol) { return false; }
    const k = symbol.kind;
    const m = SymbolKind.ObjectArray;
    if (k === m) { return true; }
    return false;
  }

  isUint8Array(name: string): boolean {
    const symbol = this.symbols.get(name);
    if (!symbol) { return false; }
    const k = symbol.kind;
    const m = SymbolKind.Uint8Array;
    if (k === m) { return true; }
    return false;
  }

  // ============================================
  // Metadata accessors
  // ============================================

  /**
   * Get closure metadata (lambda name, env struct, captures)
   */
  getClosureMetadata(name: string): ClosureMetadata | undefined {
    const symbol = this.symbols.get(name);
    if (symbol && symbol.kind === SymbolKind.Closure) {
      return symbol.closureMetadata;
    }
    return undefined;
  }

  /**
   * Get object metadata (keys and types)
   */
  getObjectMetadata(name: string): ObjectMetadata | undefined {
    const symbol = this.symbols.get(name);
    if (symbol && symbol.kind === SymbolKind.Object) {
      return symbol.objectMetadata;
    }
    return undefined;
  }

  /**
   * Get class metadata (className, fields)
   */
  getClassMetadata(name: string): ClassMetadata | undefined {
    const symbol = this.symbols.get(name);
    if (symbol && symbol.kind === SymbolKind.Class) {
      return symbol.classMetadata;
    }
    return undefined;
  }

  /**
   * Get array metadata (element type)
   */
  getArrayMetadata(name: string): ArrayMetadata | undefined {
    const symbol = this.symbols.get(name);
    if (symbol && this.isArray(name)) {
      return symbol.arrayMetadata;
    }
    return undefined;
  }

  /**
   * Get map metadata (key/value types)
   */
  getMapMetadata(name: string): MapMetadata | undefined {
    const symbol = this.symbols.get(name);
    if (symbol && symbol.kind === SymbolKind.Map) {
      return symbol.mapMetadata;
    }
    return undefined;
  }

  /**
   * Get set metadata (value type)
   */
  getSetMetadata(name: string): SetMetadata | undefined {
    const symbol = this.symbols.get(name);
    if (symbol && symbol.kind === SymbolKind.Set) {
      return symbol.setMetadata;
    }
    return undefined;
  }

  getSetValueType(name: string): string | undefined {
    const symbol = this.symbols.get(name);
    if (symbol && symbol.kind === SymbolKind.Set && symbol.setMetadata) {
      return symbol.setMetadata.valueType;
    }
    return undefined;
  }

  getObjectArrayMetadata(name: string): ObjectArrayMetadata | undefined {
    const symbol = this.symbols.get(name);
    if (symbol && symbol.kind === SymbolKind.ObjectArray) {
      return symbol.objectArrayMetadata;
    }
    return undefined;
  }

  setObjectArrayMetadata(name: string, metadata: ObjectArrayMetadata): void {
    const symbol = this.symbols.get(name);
    if (symbol) {
      symbol.objectArrayMetadata = metadata;
      symbol.kind = SymbolKind.ObjectArray;
    }
  }

  // ============================================
  // Convenience methods for backward compatibility
  // ============================================

  /**
   * Get alloca register for string variable (legacy stringVariables.get())
   */
  getStringAlloca(name: string): string | undefined {
    const symbol = this.symbols.get(name);
    if (symbol && symbol.kind === SymbolKind.String) {
      return symbol.allocaRegister;
    }
    return undefined;
  }

  /**
   * Get alloca register for array variable (legacy arrayVariables.get())
   */
  getArrayAlloca(name: string): string | undefined {
    const symbol = this.symbols.get(name);
    if (symbol && this.isArray(name)) {
      return symbol.allocaRegister;
    }
    return undefined;
  }

  /**
   * Get object variable info (legacy objectVariables.get())
   */
  getObjectInfo(name: string): { ptr: string; keys: string[]; types: string[]; tsTypes?: string[] } | undefined {
    const symbol = this.symbols.get(name);
    if (symbol && (symbol.kind === SymbolKind.Object || symbol.kind === SymbolKind.JSON) && symbol.objectMetadata) {
      const objMeta = symbol.objectMetadata;
      return {
        ptr: symbol.allocaRegister,
        keys: objMeta.keys,
        types: objMeta.types,
        tsTypes: objMeta.tsTypes
      };
    }
    return undefined;
  }

  getObjectMetadataKeys(name: string): string[] | undefined {
    const symbol = this.symbols.get(name);
    if (symbol && symbol.objectMetadata) {
      return symbol.objectMetadata.keys;
    }
    return undefined;
  }

  getObjectMetadataTypes(name: string): string[] | undefined {
    const symbol = this.symbols.get(name);
    if (symbol && symbol.objectMetadata) {
      return symbol.objectMetadata.types;
    }
    return undefined;
  }

  getObjectMetadataTsTypes(name: string): string[] | undefined {
    const symbol = this.symbols.get(name);
    if (symbol && symbol.objectMetadata) {
      return symbol.objectMetadata.tsTypes;
    }
    return undefined;
  }

  getClassMetadataClassName(name: string): string | undefined {
    const symbol = this.symbols.get(name);
    if (symbol && symbol.classMetadata) {
      return symbol.classMetadata.className;
    }
    return undefined;
  }

  getArrayMetadataElementType(name: string): string | undefined {
    const symbol = this.symbols.get(name);
    if (symbol && symbol.arrayMetadata) {
      const arrMeta = symbol.arrayMetadata;
      return arrMeta.elementType;
    }
    return undefined;
  }

  /**
   * Get the LLVM type of a property on an object variable (for ChadScript compatibility)
   */
  getObjectPropertyType(varName: string, propertyName: string): string | null {
    if (!varName) return null;
    if (!propertyName) return null;
    const symbol = this.symbols.get(varName);
    if (symbol && (symbol.kind === SymbolKind.Object || symbol.kind === SymbolKind.JSON) && symbol.objectMetadata) {
      const objMeta = symbol.objectMetadata;
      if (!objMeta.keys) return null;
      const idx = objMeta.keys.indexOf(propertyName);
      if (idx >= 0) {
        return objMeta.types[idx];
      }
    }
    return null;
  }

  /**
   * Get class instance info (legacy classInstanceVariables.get())
   */
  getClassInfo(name: string): ClassInfo | undefined {
    const symbol = this.symbols.get(name);
    if (symbol && symbol.kind === SymbolKind.Class && symbol.classMetadata) {
      const classMeta = symbol.classMetadata;
      return {
        ptr: symbol.allocaRegister,
        className: classMeta.className
      };
    }
    return undefined;
  }

  /**
   * Get class name for a variable (returns string directly for ChadScript compatibility)
   */
  getClassName(name: string): string | undefined {
    const symbol = this.symbols.get(name);
    if (symbol && symbol.kind === SymbolKind.Class && symbol.classMetadata) {
      const classMeta = symbol.classMetadata;
      return classMeta.className;
    }
    return undefined;
  }

  /**
   * Clone symbol table (useful for nested scopes)
   */
  clone(): SymbolTable {
    const cloned = new SymbolTable(this.typeContext || undefined);
    cloned.symbols = new Map(this.symbols);
    return cloned;
  }

  /**
   * Merge another symbol table into this one
   */
  merge(other: SymbolTable): void {
    const otherSymbols: Symbol[] = other.getAll();
    for (let i = 0; i < otherSymbols.length; i++) {
      const symbol: Symbol = otherSymbols[i];
      if (!this.symbols.has(symbol.name)) {
        this.symbols.set(symbol.name, symbol);
        this.symbolKeys.push(symbol.name);
      }
    }
  }

  /**
   * Get a Map of variable names to LLVM types for closure analysis.
   * This is used by the ClosureAnalyzer to know what variables are available
   * for capture and their types.
   */
  getScopeVarsForClosure(): Map<string, string> {
    const scopeVars = new Map<string, string>();
    for (let i = 0; i < this.symbolKeys.length; i++) {
      const name = this.symbolKeys[i];
      if (!name) {
        continue;
      }
      const symbol = this.symbols.get(name);
      if (symbol) {
        scopeVars.set(name, symbol.llvmType);
      }
    }
    return scopeVars;
  }

  getScopeVarsArraysForClosure(): { names: string[]; types: string[] } {
    const names: string[] = [];
    const types: string[] = [];
    for (let i = 0; i < this.symbolKeys.length; i++) {
      const name = this.symbolKeys[i];
      if (!name) {
        continue;
      }
      const symbol = this.symbols.get(name);
      if (symbol) {
        names.push(name);
        types.push(symbol.llvmType);
      }
    }
    return { names: names, types: types };
  }

  /**
   * Debug: Print all symbols
   */
  dump(): string {
    let output = '=== Symbol Table ===\n';
    for (let i = 0; i < this.symbolKeys.length; i++) {
      const name = this.symbolKeys[i];
      if (!name) {
        continue;
      }
      const symbol = this.symbols.get(name);
      if (symbol) {
        output += `${name}: ${symbol.kind} (${symbol.llvmType}) -> ${symbol.allocaRegister} [${symbol.scope}]` + '\n';
        if (symbol.objectMetadata) {
          const objMeta = symbol.objectMetadata;
          output += `  Object: keys=${objMeta.keys.join(', ')}` + '\n';
        }
        if (symbol.classMetadata) {
          const classMeta = symbol.classMetadata;
          output += `  Class: ${classMeta.className}` + '\n';
        }
        if (symbol.arrayMetadata) {
          const arrMeta = symbol.arrayMetadata;
          output += `  Array: elementType=${arrMeta.elementType}` + '\n';
        }
      }
    }
    return output;
  }
}
