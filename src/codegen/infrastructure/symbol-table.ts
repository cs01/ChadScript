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

/**
 * Symbol kind for different variable types
 */
export enum SymbolKind {
  Number = 'number',           // double
  String = 'string',           // i8*
  Boolean = 'boolean',         // i1 (stored as double)
  Array = 'array',             // %Array*
  StringArray = 'string_array', // %StringArray*
  BooleanArray = 'boolean_array', // %BooleanArray*
  ObjectArray = 'object_array', // Array of typed objects (e.g., ObjectProperty[])
  Object = 'object',           // Struct with fields
  Map = 'map',                 // %Map*
  Set = 'set',                 // %Set*
  Class = 'class',             // Class instance (i32*)
  Regex = 'regex',             // i8* (compiled regex)
  JSON = 'json',               // i8* (cJSON object)
  ProcessArgv = 'process_argv', // i8** (process.argv)
  Closure = 'closure'          // Function with captured environment
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
}

/**
 * Symbol entry in the symbol table
 */
export interface Symbol {
  name: string;
  kind: SymbolKind;
  llvmType: string;           // e.g., 'double', 'i8*', '%Array*'
  allocaRegister: string;     // e.g., '%1', '%foo'
  scope: 'local' | 'global';  // Function-local or top-level

  // True if alloca contains a pointer (e.g., function parameter %Array** holding %Array*)
  // False if alloca contains the value directly (e.g., local %Array* pointing to %Array struct)
  isPointerAlloca?: boolean;

  // Optional metadata for complex types
  objectMetadata?: ObjectMetadata;
  classMetadata?: ClassMetadata;
  arrayMetadata?: ArrayMetadata;
  objectArrayMetadata?: ObjectArrayMetadata;
  closureMetadata?: ClosureMetadata;
  mapMetadata?: MapMetadata;
  setMetadata?: SetMetadata;
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
  private symbols: Map<string, Symbol> = new Map();
  private narrowedTypes: Map<string, ObjectMetadata[]> = new Map();

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
    kind: SymbolKind,
    llvmType: string,
    allocaRegister: string,
    scope: 'local' | 'global' = 'local',
    metadata?: SymbolMetadata
  ): void {
    const symbol: Symbol = {
      name,
      kind,
      llvmType,
      allocaRegister,
      scope,
      ...metadata
    };
    this.symbols.set(name, symbol);
  }

  /**
   * Look up a symbol by name
   */
  lookup(name: string): Symbol | undefined {
    return this.symbols.get(name);
  }

  /**
   * Check if a symbol exists
   */
  has(name: string): boolean {
    return this.symbols.has(name);
  }

  /**
   * Get LLVM type for a variable
   */
  getType(name: string): string | undefined {
    return this.symbols.get(name)?.llvmType;
  }

  /**
   * Get alloca register for a variable
   */
  getAlloca(name: string): string | undefined {
    return this.symbols.get(name)?.allocaRegister;
  }

  /**
   * Get symbol kind for a variable
   */
  getKind(name: string): SymbolKind | undefined {
    return this.symbols.get(name)?.kind;
  }

  /**
   * Check if alloca contains a pointer (requires load) vs value directly
   */
  isPointerAlloca(name: string): boolean {
    return this.symbols.get(name)?.isPointerAlloca === true;
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
  }

  /**
   * Clear all symbols (e.g., when entering new function scope)
   */
  clear(): void {
    this.symbols.clear();
  }

  /**
   * Clear only local symbols (preserve globals)
   */
  clearLocals(): void {
    for (const [name, symbol] of this.symbols.entries()) {
      if (symbol.scope === 'local') {
        this.symbols.delete(name);
      }
    }
  }

  /**
   * Get all symbols
   */
  getAll(): Symbol[] {
    return Array.from(this.symbols.values());
  }

  /**
   * Get all symbols of a specific kind
   */
  getByKind(kind: SymbolKind): Symbol[] {
    return Array.from(this.symbols.values()).filter(s => s.kind === kind);
  }

  /**
   * Get all local symbols
   */
  getLocals(): Symbol[] {
    return Array.from(this.symbols.values()).filter(s => s.scope === 'local');
  }

  /**
   * Get all global symbols
   */
  getGlobals(): Symbol[] {
    return Array.from(this.symbols.values()).filter(s => s.scope === 'global');
  }

  // ============================================
  // Type-safe predicates
  // ============================================

  isNumber(name: string): boolean {
    return this.symbols.get(name)?.kind === SymbolKind.Number;
  }

  isString(name: string): boolean {
    return this.symbols.get(name)?.kind === SymbolKind.String;
  }

  isBoolean(name: string): boolean {
    return this.symbols.get(name)?.kind === SymbolKind.Boolean;
  }

  isArray(name: string): boolean {
    const kind = this.symbols.get(name)?.kind;
    return kind === SymbolKind.Array ||
           kind === SymbolKind.StringArray ||
           kind === SymbolKind.BooleanArray;
  }

  isNumberArray(name: string): boolean {
    return this.symbols.get(name)?.kind === SymbolKind.Array;
  }

  isStringArray(name: string): boolean {
    return this.symbols.get(name)?.kind === SymbolKind.StringArray;
  }

  isBooleanArray(name: string): boolean {
    return this.symbols.get(name)?.kind === SymbolKind.BooleanArray;
  }

  isObject(name: string): boolean {
    return this.symbols.get(name)?.kind === SymbolKind.Object;
  }

  isMap(name: string): boolean {
    return this.symbols.get(name)?.kind === SymbolKind.Map;
  }

  isSet(name: string): boolean {
    return this.symbols.get(name)?.kind === SymbolKind.Set;
  }

  isClass(name: string): boolean {
    return this.symbols.get(name)?.kind === SymbolKind.Class;
  }

  isRegex(name: string): boolean {
    return this.symbols.get(name)?.kind === SymbolKind.Regex;
  }

  isJSON(name: string): boolean {
    return this.symbols.get(name)?.kind === SymbolKind.JSON;
  }

  isProcessArgv(name: string): boolean {
    return this.symbols.get(name)?.kind === SymbolKind.ProcessArgv;
  }

  isClosure(name: string): boolean {
    return this.symbols.get(name)?.kind === SymbolKind.Closure;
  }

  isObjectArray(name: string): boolean {
    return this.symbols.get(name)?.kind === SymbolKind.ObjectArray;
  }

  // ============================================
  // Metadata accessors
  // ============================================

  /**
   * Get closure metadata (lambda name, env struct, captures)
   */
  getClosureMetadata(name: string): ClosureMetadata | undefined {
    const symbol = this.symbols.get(name);
    if (symbol?.kind === SymbolKind.Closure) {
      return symbol.closureMetadata;
    }
    return undefined;
  }

  /**
   * Get object metadata (keys and types)
   */
  getObjectMetadata(name: string): ObjectMetadata | undefined {
    const symbol = this.symbols.get(name);
    if (symbol?.kind === SymbolKind.Object) {
      return symbol.objectMetadata;
    }
    return undefined;
  }

  /**
   * Get class metadata (className, fields)
   */
  getClassMetadata(name: string): ClassMetadata | undefined {
    const symbol = this.symbols.get(name);
    if (symbol?.kind === SymbolKind.Class) {
      return symbol.classMetadata;
    }
    return undefined;
  }

  /**
   * Get array metadata (element type)
   */
  getArrayMetadata(name: string): ArrayMetadata | undefined {
    const symbol = this.symbols.get(name);
    if (this.isArray(name)) {
      return symbol?.arrayMetadata;
    }
    return undefined;
  }

  /**
   * Get map metadata (key/value types)
   */
  getMapMetadata(name: string): MapMetadata | undefined {
    const symbol = this.symbols.get(name);
    if (symbol?.kind === SymbolKind.Map) {
      return symbol.mapMetadata;
    }
    return undefined;
  }

  /**
   * Get set metadata (value type)
   */
  getSetMetadata(name: string): SetMetadata | undefined {
    const symbol = this.symbols.get(name);
    if (symbol?.kind === SymbolKind.Set) {
      return symbol.setMetadata;
    }
    return undefined;
  }

  getObjectArrayMetadata(name: string): ObjectArrayMetadata | undefined {
    const symbol = this.symbols.get(name);
    if (symbol?.kind === SymbolKind.ObjectArray) {
      return symbol.objectArrayMetadata;
    }
    return undefined;
  }

  // ============================================
  // Convenience methods for backward compatibility
  // ============================================

  /**
   * Get alloca register for string variable (legacy stringVariables.get())
   */
  getStringAlloca(name: string): string | undefined {
    const symbol = this.symbols.get(name);
    if (symbol?.kind === SymbolKind.String) {
      return symbol.allocaRegister;
    }
    return undefined;
  }

  /**
   * Get alloca register for array variable (legacy arrayVariables.get())
   */
  getArrayAlloca(name: string): string | undefined {
    const symbol = this.symbols.get(name);
    if (this.isArray(name)) {
      return symbol?.allocaRegister;
    }
    return undefined;
  }

  /**
   * Get object variable info (legacy objectVariables.get())
   */
  getObjectInfo(name: string): { ptr: string; keys: string[]; types: string[]; tsTypes?: string[] } | undefined {
    const symbol = this.symbols.get(name);
    // Support both Object and JSON kinds (JSON.parse results store metadata like objects)
    if ((symbol?.kind === SymbolKind.Object || symbol?.kind === SymbolKind.JSON) && symbol.objectMetadata) {
      return {
        ptr: symbol.allocaRegister,
        keys: symbol.objectMetadata.keys,
        types: symbol.objectMetadata.types,
        tsTypes: symbol.objectMetadata.tsTypes
      };
    }
    return undefined;
  }

  /**
   * Get class instance info (legacy classInstanceVariables.get())
   */
  getClassInfo(name: string): { ptr: string; className: string } | undefined {
    const symbol = this.symbols.get(name);
    if (symbol?.kind === SymbolKind.Class && symbol.classMetadata) {
      return {
        ptr: symbol.allocaRegister,
        className: symbol.classMetadata.className
      };
    }
    return undefined;
  }

  /**
   * Clone symbol table (useful for nested scopes)
   */
  clone(): SymbolTable {
    const cloned = new SymbolTable();
    cloned.symbols = new Map(this.symbols);
    return cloned;
  }

  /**
   * Get a Map of variable names to LLVM types for closure analysis.
   * This is used by the ClosureAnalyzer to know what variables are available
   * for capture and their types.
   */
  getScopeVarsForClosure(): Map<string, string> {
    const scopeVars = new Map<string, string>();
    for (const [name, symbol] of this.symbols.entries()) {
      scopeVars.set(name, symbol.llvmType);
    }
    return scopeVars;
  }

  /**
   * Debug: Print all symbols
   */
  dump(): string {
    let output = '=== Symbol Table ===\n';
    for (const [name, symbol] of this.symbols.entries()) {
      output += `${name}: ${symbol.kind} (${symbol.llvmType}) -> ${symbol.allocaRegister} [${symbol.scope}]\n`;
      if (symbol.objectMetadata) {
        output += `  Object: keys=${symbol.objectMetadata.keys.join(', ')}\n`;
      }
      if (symbol.classMetadata) {
        output += `  Class: ${symbol.classMetadata.className}\n`;
      }
      if (symbol.arrayMetadata) {
        output += `  Array: elementType=${symbol.arrayMetadata.elementType}\n`;
      }
    }
    return output;
  }
}
