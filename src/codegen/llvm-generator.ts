import { AST, Expression, FunctionNode, BlockStatement, NewNode, CallNode, VariableNode, VariableDeclaration, ObjectNode, ObjectProperty, MethodCallNode, InterfaceDeclaration, Statement, AssignmentStatement, ImportDeclaration, ImportSpecifier, IfStatement, WhileStatement, ForStatement, ForOfStatement, TryStatement } from '../ast/types.js';
import { BaseGenerator, SymbolKind } from './infrastructure/base-generator.js';
import { TypeInference, TypeInferenceContext } from './infrastructure/type-inference.js';
import { VariableAllocator, VariableAllocatorContext } from './infrastructure/variable-allocator.js';
import { FunctionGenerator, FunctionGeneratorContext } from './infrastructure/function-generator.js';
import { AssignmentGenerator, AssignmentGeneratorContext } from './infrastructure/assignment-generator.js';
import { getLLVMDeclarations, getSafeStringHelper, getDoubleToStringHelper, getGlobalVariables } from './infrastructure/llvm-declarations.js';
import { TypeResolver, TypeResolverContext } from './infrastructure/type-resolver/index.js';
import { IGeneratorContext } from './infrastructure/generator-context.js';
import { ArrayGenerator } from './types/collections/array.js';
import { StringGenerator } from './types/collections/string.js';
import { ObjectGenerator } from './types/objects/object.js';
import { MapGenerator, StringMapGenerator, PointerMapGenerator } from './types/collections/map.js';
import { SetGenerator, StringSetGenerator } from './types/collections/set.js';
import { ControlFlowGenerator } from './statements/control-flow.js';
import { ClassGenerator } from './types/objects/class.js';
import { RegexGenerator } from './types/objects/regex.js';
import { MathGenerator } from './stdlib/math.js';
import { ConsoleGenerator } from './stdlib/console.js';
import { ProcessGenerator } from './stdlib/process.js';
import { PathGenerator } from './stdlib/path.js';
import { JsonGenerator } from './stdlib/json.js';
import { FilesystemGenerator } from './stdlib/fs.js';
import { ResponseGenerator } from './stdlib/response.js';
import { RuntimeGenerator } from './runtime/runtime.js';
import { MongooseGenerator } from './stdlib/mongoose.js';
import { LibuvGenerator } from './stdlib/libuv.js';
import { PromiseGenerator } from './stdlib/promise.js';
import { TreeSitterGenerator } from './stdlib/treesitter.js';
import { ExpressionGenerator } from './expressions/orchestrator.js';
import type { TypeChecker } from '../typescript/type-checker.js';
import { InterfaceStructGenerator } from './types/interface-struct-generator.js';

export interface LLVMGeneratorOptions {
  linkTreeSitter: boolean;
  sourceCode?: string;
  filename?: string;
}

// ============================================
// LLVM IR CODE GENERATOR - Main Orchestrator
// ============================================

export class LLVMGenerator extends BaseGenerator implements IGeneratorContext {
  public ast: AST;
  public typeChecker: TypeChecker | null;
  private externalFunctions: Set<string>;
  public currentFunction: string = '';
  public currentDeclaredInterfaceType: string | undefined;
  public currentDeclaredMapType: string | undefined;
  public currentDeclaredSetType: string | undefined;
  public currentFunctionReturnType: string = 'double';
  public currentFunctionTsReturnType: string | undefined;
  public isAsyncFunction: boolean = false;
  public asyncResultPromise: string = '';

  // Top-level variables (accessible from all functions)
  private topLevelObjectVariables: Map<string, { ptr: string; keys: string[]; types: string[] }>;

  // Global variables declared with LLVM @ prefix (accessible from any function)
  private globalVariables: Map<string, { llvmType: string; kind: SymbolKind; initialized: boolean }>;

  // Import alias map: local name -> original name (for renamed imports like "x as y")
  private importAliasMap: Map<string, string>;

  // Specialized generators (public for context pattern access)
  public arrayGen: ArrayGenerator;
  public stringGen: StringGenerator;
  public objectGen: ObjectGenerator;
  public mapGen: MapGenerator;
  public stringMapGen: StringMapGenerator;
  public pointerMapGen: PointerMapGenerator;
  public setGen: SetGenerator;
  public stringSetGen: StringSetGenerator;
  private controlFlowGen: ControlFlowGenerator;
  public classGen: ClassGenerator;
  public regexGen: RegexGenerator;

  // Method generators (public for context pattern access)
  public mathGen: MathGenerator;
  public consoleGen: ConsoleGenerator;
  public processGen: ProcessGenerator;
  public pathGen: PathGenerator;
  public jsonGen: JsonGenerator;
  public fsGen: FilesystemGenerator;
  public responseGen: ResponseGenerator;
  private runtimeGen: RuntimeGenerator;
  private mongooseGen: MongooseGenerator;
  private libuvGen: LibuvGenerator;
  private promiseGen: PromiseGenerator;
  private treesitterGen: TreeSitterGenerator;
  private httpHandlers: string[];
  public usesTimers: boolean = false;
  public usesPromises: boolean = false;

  // Expression generator (context pattern)
  private exprGen: ExpressionGenerator;

  // Type inference helper
  private typeInference: TypeInference;

  // Type resolver (consolidates type resolution logic)
  public typeResolver: TypeResolver;

  // Variable allocator
  private varAllocator: VariableAllocator;

  // Function generator
  private funcGen: FunctionGenerator;

  // Assignment generator
  private assignmentGen: AssignmentGenerator;

  // Interface struct generator
  public interfaceStructGen: InterfaceStructGenerator;

  // Cache for interface struct defs (used at end of generate())
  private interfaceStructDefsCache: string = '';

  // Cache for class struct defs (used at end of generate())
  private classStructDefsCache: string = '';

  // Helper: Format nice compiler errors (public for context pattern access)
  public formatCodegenError(message: string, suggestion?: string, pos?: number): string {
    let error = '';

    // If we have source code and position, show the line with arrow
    if (this.sourceCode && pos !== undefined) {
      const lines = this.sourceCode.substring(0, pos).split('\n');
      const lineNum = lines.length;
      const col = lines[lines.length - 1].length;
      const allLines = this.sourceCode.split('\n');

      const lineNumStr = String(lineNum);
      const lineNumWidth = lineNumStr.length > 2 ? lineNumStr.length : 2;

      const filename = this.filename || '<input>';
      error += `${filename}:${lineNum}:${col + 1}: \x1b[31m\x1b[1merror:\x1b[0m ${message}\n`;
      error += `\x1b[36m\x1b[1m${' '.repeat(lineNumWidth)} |\x1b[0m\n`;

      const lineContent = allLines[lineNum - 1] || '';
      error += `\x1b[36m\x1b[1m${lineNumStr.padStart(lineNumWidth)} |\x1b[0m ${lineContent}\n`;
      error += `\x1b[36m\x1b[1m${' '.repeat(lineNumWidth)} |\x1b[0m ${' '.repeat(col)}\x1b[31m\x1b[1m^\x1b[0m\n`;

      if (suggestion) {
        error += `\x1b[36m\x1b[1m${' '.repeat(lineNumWidth)} |\x1b[0m\n`;
        error += `\x1b[36m\x1b[1m${' '.repeat(lineNumWidth)} =\x1b[0m \x1b[33mhelp:\x1b[0m ${suggestion}\n`;
      }
    } else {
      error = `\x1b[31m\x1b[1merror:\x1b[0m ${message}\n`;
      if (suggestion) {
        error += `\x1b[33m  help:\x1b[0m ${suggestion}\n`;
      }
    }

    return error;
  }

  private extractInlineInterfaceType(returnType: string): string | null {
    if (returnType.startsWith('{')) {
      return returnType;
    }
    if (returnType.indexOf(' | ') !== -1) {
      const parts = returnType.split(' | ');
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        if (part.startsWith('{')) {
          return part;
        }
      }
    }
    return null;
  }

  public getClassesCount(): number {
    return this.classesCount;
  }

  // Helper: Extract object literal metadata (public for context pattern access)
  public getObjectMetadata(objExpr: ObjectNode): { keys: string[]; types: string[] } {
    if (objExpr.type !== 'object') {
      return { keys: [], types: [] };
    }

    const keys: string[] = [];
    const types: string[] = [];

    for (let i = 0; i < objExpr.properties.length; i++) {
      const prop = objExpr.properties[i] as ObjectProperty;
      keys.push(prop.key);

      let llvmType: string;

      if (prop.value.type === 'string' || this.isStringExpression(prop.value)) {
        llvmType = 'i8*';
      } else if (prop.value.type === 'array' || this.isStringArrayExpression(prop.value)) {
        llvmType = this.isStringArrayExpression(prop.value) ? '%StringArray*' : '%Array*';
      } else if (this.isArrayExpression(prop.value)) {
        llvmType = '%Array*';
      } else if (prop.value.type === 'map') {
        llvmType = '%Map*';
      } else if (prop.value.type === 'set') {
        llvmType = '%Set*';
      } else {
        llvmType = 'double';
      }

      types.push(llvmType);
    }

    return { keys, types };
  }

  // Cached counts for empty array protection (public for FunctionGeneratorContext)
  topLevelStatementsCount: number = 0;
  topLevelExpressionsCount: number = 0;
  topLevelItemsCount: number = 0;
  private functionsCount: number = 0;
  public classesCount: number = 0;

  private linkTreeSitter: boolean = false;
  public sourceCode: string = '';
  public filename: string = '';

  constructor(ast: AST, typeChecker: TypeChecker | null, options: LLVMGeneratorOptions) {
    super();

    // Initialize complex fields in constructor (field initializers don't work in native code)
    this.externalFunctions = new Set();
    this.topLevelObjectVariables = new Map();
    this.globalVariables = new Map();
    this.importAliasMap = new Map();
    this.httpHandlers = [];

    this.ast = ast;

    // Cache all counts BEFORE storing - empty arrays become garbage after assignment
    this.topLevelStatementsCount = ast.topLevelStatements.length;
    this.topLevelExpressionsCount = ast.topLevelExpressions.length;
    this.topLevelItemsCount = ast.topLevelItems ? ast.topLevelItems.length : 0;
    this.functionsCount = ast.functions.length;
    this.classesCount = ast.classes.length;

    const ifaceCount = ast.interfaces.length;
    this.typeChecker = typeChecker;
    this.linkTreeSitter = options.linkTreeSitter;
    this.sourceCode = options.sourceCode || '';
    this.filename = options.filename || '';

    this.interfaceStructGen = new InterfaceStructGenerator(ast.interfaces, ifaceCount);

    // Initialize specialized generators with context (NEW pattern for RegexGenerator + ObjectGenerator)
    // These generators use explicit context instead of callback binding
    this.regexGen = new RegexGenerator(this); // 'this' implements IGeneratorContext
    this.objectGen = new ObjectGenerator(this); // Clean context pattern! 🎯

    // Initialize method generators with context pattern
    this.mathGen = new MathGenerator(this);
    this.consoleGen = new ConsoleGenerator(this);
    this.processGen = new ProcessGenerator(this);
    this.pathGen = new PathGenerator(this);
    this.jsonGen = new JsonGenerator(this);
    this.fsGen = new FilesystemGenerator(this);
    this.responseGen = new ResponseGenerator(this);
    this.runtimeGen = new RuntimeGenerator();
    this.mongooseGen = new MongooseGenerator();
    this.libuvGen = new LibuvGenerator();
    this.promiseGen = new PromiseGenerator();
    this.treesitterGen = new TreeSitterGenerator();

    // Initialize expression generator with context pattern
    this.exprGen = new ExpressionGenerator(this);

    // All generators now use context pattern! 🎉
    this.arrayGen = new ArrayGenerator(this);
    this.stringGen = new StringGenerator(this);
    this.mapGen = new MapGenerator(this);
    this.stringMapGen = new StringMapGenerator(this);
    this.pointerMapGen = new PointerMapGenerator(this);
    this.setGen = new SetGenerator(this);
    this.stringSetGen = new StringSetGenerator(this);
    this.controlFlowGen = new ControlFlowGenerator(this);
    this.classGen = new ClassGenerator(this);

    this.typeInference = new TypeInference(this as unknown as TypeInferenceContext);

    this.typeResolver = new TypeResolver(this as unknown as TypeResolverContext);

    this.varAllocator = new VariableAllocator(this as unknown as VariableAllocatorContext);

    this.funcGen = new FunctionGenerator(this as unknown as FunctionGeneratorContext);

    this.assignmentGen = new AssignmentGenerator(this as unknown as AssignmentGeneratorContext);

    const importsCount = ast.imports.length;
    if (importsCount > 0) {
      this.buildImportAliasMap(ast.imports, importsCount);
    }

    // No more delegate binding needed - all generators use context pattern! 🎯

    // Note: External function tracking removed for self-hosting compatibility.
    // All imported functions are compiled into the same binary, so no external declarations needed.
  }

  private buildImportAliasMap(imports: ImportDeclaration[], importCount: number): void {
    for (let i = 0; i < importCount; i++) {
      const imp = imports[i] as ImportDeclaration;
      if (imp.aliasedSpecifiers) {
        const specCount = imp.aliasedSpecifiers.length;
        for (let j = 0; j < specCount; j++) {
          const spec = imp.aliasedSpecifiers[j] as ImportSpecifier;
          if (spec.original && spec.original !== spec.name) {
            this.importAliasMap.set(spec.name, spec.original);
          }
        }
      }
    }
  }

  resolveImportAlias(localName: string): string {
    const original = this.importAliasMap.get(localName);
    return original || localName;
  }

  reset(): void {
    this.tempCounter = 0;
    this.labelCounter = 0;
    this.currentLabel = 'entry';
    this.output.length = 0;
    this.outputCount = 0;
    this.thisPointer = null;
    this.currentClassName = null;
    this.currentFunctionReturnType = 'double';
    this.symbolTable.clearLocals();
    this.variableTypes.clear();
    this.expressionTypes.clear();
  }

  private generateGlobalVariableDeclarations(): string {
    let ir = '';
    if (this.topLevelStatementsCount === 0) {
      return ir;
    }
    const stmts = this.ast.topLevelStatements;
    for (let stmtIdx = 0; stmtIdx < this.topLevelStatementsCount; stmtIdx++) {
      const stmt = stmts[stmtIdx] as { type: string; name: string; value: Expression | null; kind: string };
      if (stmt.type === 'variable_declaration' && stmt.value !== null) {
        const name = stmt.name;
        const isString = this.isStringExpression(stmt.value);
        const isStringArray = this.isStringArrayExpression(stmt.value);
        const isArray = !isStringArray && this.isArrayExpression(stmt.value);
        const isObject = this.isObjectExpression(stmt.value);
        const isMap = this.typeInference.isMapExpression(stmt.value);
        const isSet = this.typeInference.isSetExpression(stmt.value);
        const isRegex = this.typeInference.isRegexExpression(stmt.value);
        const isClassInstance = this.typeInference.isClassInstanceExpression(stmt.value);
        const isBoolean = this.typeInference.isBooleanExpression(stmt.value);

        let llvmType: string;
        let kind: SymbolKind;
        let defaultValue: string;

        if (isString) {
          llvmType = 'i8*';
          kind = SymbolKind.String;
          defaultValue = 'null';
        } else if (isStringArray) {
          llvmType = '%StringArray';
          kind = SymbolKind.StringArray;
          defaultValue = 'zeroinitializer';
        } else if (isArray) {
          llvmType = '%Array';
          kind = SymbolKind.Array;
          defaultValue = 'zeroinitializer';
        } else if (isObject) {
          llvmType = 'i8*';
          kind = SymbolKind.Object;
          defaultValue = 'null';
        } else if (isMap) {
          llvmType = '%Map';
          kind = SymbolKind.Map;
          defaultValue = 'zeroinitializer';
        } else if (isSet) {
          llvmType = '%Set';
          kind = SymbolKind.Set;
          defaultValue = 'zeroinitializer';
        } else if (isRegex) {
          llvmType = 'i8*';
          kind = SymbolKind.Regex;
          defaultValue = 'null';
        } else if (isClassInstance) {
          const className = (stmt.value as NewNode).className;
          const fields = this.classGen?.getClassFields(className) || [];
          llvmType = fields.length > 0 ? `%${className}_struct*` : 'i32*';
          kind = SymbolKind.Class;
          defaultValue = 'null';
        } else if (isBoolean) {
          llvmType = 'double';
          kind = SymbolKind.Boolean;
          defaultValue = '0.0';
        } else {
          llvmType = 'double';
          kind = SymbolKind.Number;
          defaultValue = '0.0';
        }

        ir += `@${name} = global ${llvmType} ${defaultValue}\n`;
        this.globalVariables.set(name, { llvmType, kind, initialized: false });
        this.defineVariable(name, `@${name}`, llvmType, kind, 'global');
      }
    }
    if (ir.length > 0) {
      ir += '\n';
    }
    return ir;
  }

  /**
   * Main entry point for LLVM IR generation.
   * Converts the entire AST to LLVM IR text representation.
   *
   * @example
   * Input AST (for: function add(a, b) { return a + b; }):
   * {
   *   functions: [{
   *     type: 'function',
   *     name: 'add',
   *     params: ['a', 'b'],
   *     body: { statements: [{ type: 'return', value: { type: 'binary', op: '+', ... }}]}
   *   }]
   * }
   *
   * Output LLVM IR:
   * define double @add(double %0, double %1) {
   *   %2 = fadd double %0, %1
   *   ret double %2
   * }
   *
   * @returns Complete LLVM IR module as string (struct types + extern declarations + functions + main)
   */
  generate(): string {
    let ir = '';

    ir += getLLVMDeclarations();

    const interfaceStructDefs = this.interfaceStructGen.generateStructTypeDefinitions();
    this.interfaceStructDefsCache = interfaceStructDefs;

    const classStructDefs = this.classGen.generateStructTypeDefinitions(this.classesCount);
    this.classStructDefsCache = classStructDefs;

    ir += this.runtimeGen.generateFetchRuntime();
    ir += '\n';

    ir += this.runtimeGen.generateJSONRuntime();
    ir += '\n';

    ir += this.mongooseGen.generateDeclarations();
    ir += '\n';

    ir += this.libuvGen.generateDeclarations();
    ir += '\n';

    ir += this.promiseGen.generateDeclarations();
    ir += '\n';

    if (this.linkTreeSitter) {
      ir += this.treesitterGen.generateDeclarations();
      ir += '\n';

      ir += this.treesitterGen.generateParseSourceHelper();
      ir += this.treesitterGen.generateGetRootNodeHelper();
      ir += this.treesitterGen.generateNodeTypeHelper();
      ir += this.treesitterGen.generateNodeChildCountHelper();
      ir += this.treesitterGen.generateNodeChildHelper();
      ir += this.treesitterGen.generateNodeStartByteHelper();
      ir += this.treesitterGen.generateNodeEndByteHelper();
      ir += this.treesitterGen.generateNodeTextHelper();
      ir += this.treesitterGen.generateNodeIsNullHelper();
      ir += this.treesitterGen.generateNodeIsNamedHelper();
      ir += this.treesitterGen.generateNamedChildHelper();
      ir += this.treesitterGen.generateNamedChildCountHelper();
      ir += this.treesitterGen.generateChildByFieldNameHelper();
      ir += '\n';
    }

    ir += getSafeStringHelper();
    ir += getDoubleToStringHelper();

    ir += getGlobalVariables();

    // Generate global variable declarations for top-level let/const
    ir += this.generateGlobalVariableDeclarations();

    // Generate external function declarations for imports
    // TODO: for-of on Set crashes in native code, skip for now
    // if (this.externalFunctions.size > 0) {
    //   for (const funcName of this.externalFunctions) {
    //     ir += `declare i32 @${funcName}(...)\n`;
    //   }
    //   ir += '\n';
    // }

    // Generate class definitions
    for (let classIdx = 0; classIdx < this.classesCount; classIdx++) {
      const classNode = this.ast.classes[classIdx];
      this.syncStateToGenerators();
      ir += this.classGen.generateClass(classNode);
      ir += '\n';
    }

    // Generate user function definitions (this may discover lifted functions)
    let userFunctionsIr = '';
    for (let funcIdx = 0; funcIdx < this.functionsCount; funcIdx++) {
      const func = this.ast.functions[funcIdx];
      userFunctionsIr += this.generateFunction(func);
      userFunctionsIr += '\n';
    }

    // Generate main function (this may also discover lifted functions)
    const mainIr = this.generateMain();

    // Generate environment struct type definitions for closures
    const envStructDefs = this.exprGen.arrowFunctionGen.getEnvStructDefinitions();
    if (envStructDefs) {
      ir += envStructDefs;
      ir += '\n';
    }

    // Generate lifted functions (discovered during user function and main generation)
    // These need to be placed BEFORE user functions so they can be called
    const liftedFunctions = this.exprGen.arrowFunctionGen.getLiftedFunctions();
    for (const func of liftedFunctions) {
      ir += this.generateFunction(func);
      ir += '\n';
    }

    // Append user functions after lifted functions
    ir += userFunctionsIr;

    // Append main function after all other functions
    ir += mainIr;

    // Generate mongoose HTTP server runtime if httpServe was used
    if (this.httpHandlers.length > 0) {
      ir += '\n';
      ir += this.mongooseGen.generateHttpServeFunction();
      ir += '\n';
      ir += this.mongooseGen.generateEventHandler(this.httpHandlers[0]);
    }

    // Generate libuv timer runtime if setTimeout/setInterval was used
    if (this.usesTimers) {
      ir += '\n';
      ir += this.libuvGen.generateTimerCallbackWrapper();
      ir += this.libuvGen.generateSetTimeout();
      ir += this.libuvGen.generateSetInterval();
      ir += this.libuvGen.generateClearTimer();
      ir += this.libuvGen.generateRunEventLoop();
    }

    // Generate Promise runtime if Promise is used
    if (this.usesPromises) {
      ir += '\n';
      ir += this.promiseGen.generateAll();
      ir += this.runtimeGen.generateFetchAsyncWrapper();
    }

    // Add global string constants at the beginning
    if (this.globalStrings.length > 0) {
      ir = this.globalStrings.join('\n') + '\n\n' + ir;
    }

    // Add class struct defs before the main IR (after interface structs)
    if (this.classStructDefsCache) {
      ir = this.classStructDefsCache + '\n' + ir;
    }

    // Add interface struct defs at the very beginning
    if (this.interfaceStructDefsCache) {
      ir = this.interfaceStructDefsCache + '\n' + ir;
    }

    return ir;
  }

  /**
   * Generates LLVM IR for a function declaration and implementation.
   * Handles parameter types, allocas, body code generation, and return.
   *
   * @example
   * Input: { type: 'function', name: 'multiply', params: ['x', 'y'],
   *          body: { statements: [{ type: 'return', value: { type: 'binary', op: '*', ... }}]}}
   *
   * Output:
   * define double @multiply(double %0, double %1) {
   *   %x = alloca double
   *   store double %0, double* %x
   *   %y = alloca double
   *   store double %1, double* %y
   *   %2 = load double, double* %x
   *   %3 = load double, double* %y
   *   %4 = fmul double %2, %3
   *   ret double %4
   * }
   *
   * @param func - Function AST node
   * @returns LLVM IR function definition as string
   */
  private generateFunction(func: FunctionNode): string {
    return this.funcGen.generate(func);
  }

  /**
   * Allocate stack space for a variable declaration.
   * Handles all variable types: strings, arrays, objects, maps, sets, regex, classes, Response, etc.
   * This eliminates duplicate code between generateBlock() and generateMain().
   *
   * @param stmt - Variable declaration statement
   * @param params - Function parameters for expression generation
   */
  private allocateVariable(stmt: VariableDeclaration, params: string[]): void {
    this.varAllocator.allocate(stmt, params);
  }

  public generateBlock(block: BlockStatement, params: string[]): string | null {
    let lastValue: string | null = null;
    let hasTerminator = false;

    // thisPointer is now shared via context - no sync needed!

    for (let stmtIdx = 0; stmtIdx < block.statements.length; stmtIdx++) {
      const stmtRaw = block.statements[stmtIdx];
      const stmt = stmtRaw as { type: string; name: string; value: Expression | null };
      // Stop processing if we've already generated a terminator
      if (hasTerminator) {
        break;
      }

      if (stmt.type === 'variable_declaration') {
        this.allocateVariable(stmtRaw as VariableDeclaration, params);
      } else if (stmt.type === 'assignment') {
        // Check if this is a member access assignment (this.field = value)
        if (stmt.name.startsWith('__member_access__')) {
          this.assignmentGen.generateMemberAccessAssignment(stmtRaw as AssignmentStatement, params);
        } else if (stmt.name === '__index_access__') {
          this.generateExpression(stmt.value as Expression, params);
        } else {
          // Regular variable assignment
          const value = this.generateExpression(stmt.value as Expression, params);

          // Check for string variable
          const stringAllocaReg = this.symbolTable.getStringAlloca(stmt.name);
          if (stringAllocaReg) {
            this.emit(`store i8* ${value}, i8** ${stringAllocaReg}`);
            continue;
          }

          // Check for array variable
          const arrayAllocaReg = this.symbolTable.getArrayAlloca(stmt.name);
          if (arrayAllocaReg) {
            const loadedArray = this.nextTemp();
            this.emit(`${loadedArray} = load %Array, %Array* ${value}`);
            this.emit(`store %Array ${loadedArray}, %Array* ${arrayAllocaReg}`);
            continue;
          }

          // Check for numeric variable
          if (!stmt.name) {
            throw new Error(`Assignment statement has no name property. Statement: ${JSON.stringify(stmt, null, 2)}`);
          }
          const allocaReg = this.getVariableAlloca(stmt.name);
          if (!allocaReg) {
            throw new Error(`Unknown variable: ${stmt.name}`);
          }
          // All numeric variables are double now
          const varType = this.getVariableType(stmt.name) || 'double';
          this.emit(`store ${varType} ${value}, ${varType}* ${allocaReg}`);
        }
      } else if (stmt.type === 'return') {
        if (!stmt.value) {
          // Return without value - use default based on return type
          if (this.currentFunctionReturnType === 'void') {
            this.emit(`ret void`);
          } else if (this.currentFunctionReturnType === 'i8*') {
            this.syncStateToGenerators();
            const emptyStr = this.stringGen.createStringConstant('');
            this.emit(`ret i8* ${emptyStr}`);
          } else if (this.currentFunctionReturnType && this.currentFunctionReturnType.indexOf('*') !== -1) {
            this.emit(`ret ${this.currentFunctionReturnType} null`);
          } else {
            this.emit(`ret ${this.currentFunctionReturnType} 0.0`);
          }
          hasTerminator = true;
          continue;
        }

        const stmtValueBase = stmt.value as { type: string };
        if (stmtValueBase.type === 'object' && this.currentFunctionTsReturnType) {
          const inlineType = this.extractInlineInterfaceType(this.currentFunctionTsReturnType);
          if (inlineType) {
            this.currentDeclaredInterfaceType = inlineType;
          } else {
            let returnTypeName = this.currentFunctionTsReturnType;
            if (returnTypeName.indexOf(' | ') !== -1) {
              const parts = returnTypeName.split(' | ');
              const objLit = stmt.value as ObjectNode;
              let discriminantValue: string | null = null;
              if (objLit.properties && objLit.properties.length > 0) {
                const firstProp = objLit.properties[0];
                if (firstProp.key === 'type' && firstProp.value) {
                  const propValue = firstProp.value as { type: string; value?: string };
                  if (propValue.type === 'string' && propValue.value) {
                    discriminantValue = propValue.value;
                  }
                }
              }
              if (discriminantValue && this.interfaceStructGen) {
                for (let i = 0; i < parts.length; i++) {
                  const part = parts[i].trim();
                  if (part === 'null' || part === 'undefined') continue;
                  const ifaceInfo = this.interfaceStructGen.getInterfaceStruct(part);
                  if (ifaceInfo && ifaceInfo.fields) {
                    const firstField = ifaceInfo.fields[0] as { name: string; tsType: string };
                    if (firstField && firstField.name === 'type') {
                      const expectedType = firstField.tsType.replace(/['"]/g, '');
                      if (expectedType === discriminantValue) {
                        returnTypeName = part;
                        break;
                      }
                    }
                  }
                }
              }
              if (returnTypeName === this.currentFunctionTsReturnType) {
                for (let i = 0; i < parts.length; i++) {
                  const part = parts[i].trim();
                  if (part !== 'null' && part !== 'undefined') {
                    returnTypeName = part;
                    break;
                  }
                }
              }
            }
            if (this.interfaceStructGen && this.interfaceStructGen.hasInterface(returnTypeName)) {
              this.currentDeclaredInterfaceType = returnTypeName;
            }
          }
        }
        lastValue = this.generateExpression(stmt.value as Expression, params);
        this.currentDeclaredInterfaceType = undefined;

        if (!lastValue || lastValue === '') {
          throw new Error(`Return statement generated empty value for function ${this.currentFunction}`);
        }

        if (this.isAsyncFunction) {
          const valueAsPtr = this.nextTemp();
          this.emit(`${valueAsPtr} = bitcast i8* ${lastValue} to i8*`);
          this.emit(`call void @__Promise_resolve(%Promise* ${this.asyncResultPromise}, i8* ${lastValue})`);
          this.emit(`ret %Promise* ${this.asyncResultPromise}`);
        } else {
          if (this.currentFunctionReturnType === 'double') {
            const valueType = this.getVariableType(lastValue);
            if (valueType === 'i32') {
              const converted = this.nextTemp();
              this.emit(`${converted} = sitofp i32 ${lastValue} to double`);
              lastValue = converted;
            }
          }

          if (this.currentFunctionReturnType === 'void') {
            this.emit(`ret void`);
          } else {
            this.emit(`ret ${this.currentFunctionReturnType} ${lastValue}`);
          }
        }
        hasTerminator = true;
      } else if (stmt.type === 'if') {
        this.syncStateToGenerators();
        lastValue = this.controlFlowGen.generateIfStatement(stmtRaw as Statement, params);
        // Don't need to sync back - counters are already shared via bound methods
      } else if (stmt.type === 'while') {
        this.syncStateToGenerators();
        lastValue = this.controlFlowGen.generateWhileStatement(stmtRaw as Statement, params);
      } else if (stmt.type === 'for') {
        this.syncStateToGenerators();
        lastValue = this.controlFlowGen.generateForStatement(stmtRaw as Statement, params);
      } else if (stmt.type === 'for_of') {
        this.syncStateToGenerators();
        lastValue = this.controlFlowGen.generateForOfStatement(stmtRaw as Statement, params);
      } else if (stmt.type === 'break') {
        this.syncStateToGenerators();
        lastValue = this.controlFlowGen.generateBreakStatement();
        hasTerminator = true;  // break generates 'br', which is a terminator
      } else if (stmt.type === 'continue') {
        this.syncStateToGenerators();
        lastValue = this.controlFlowGen.generateContinueStatement();
        hasTerminator = true;  // continue generates 'br', which is a terminator
      } else if (stmt.type === 'throw') {
        this.syncStateToGenerators();
        lastValue = this.controlFlowGen.generateThrowStatement(stmtRaw as Statement, params);
        hasTerminator = true;  // throw generates 'unreachable', which is a terminator
      } else if (stmt.type === 'try') {
        this.syncStateToGenerators();
        lastValue = this.controlFlowGen.generateTryStatement(stmtRaw as Statement, params);
      } else if (stmt.type === 'switch') {
        this.syncStateToGenerators();
        lastValue = this.controlFlowGen.generateSwitchStatement(stmtRaw as Statement, params);
      } else {
        // Expression statement
        lastValue = this.generateExpression(stmtRaw as Expression, params);
      }
    }

    return lastValue;
  }

  /**
   * Generates LLVM IR for any expression node.
   * This is the core dispatcher that handles all expression types via visitor pattern.
   *
   * @example
   * // Binary expression: 5 + 3
   * Input: { type: 'binary', op: '+', left: { type: 'number', value: 5 }, right: { type: 'number', value: 3 }}
   * Output: '%1 = fadd double 5.0, 3.0'
   *
   * @example
   * // Variable reference: x
   * Input: { type: 'variable', name: 'x' }
   * Output: '%2 = load double, double* %x'
   *
   * @example
   * // Array literal: [1, 2, 3]
   * Input: { type: 'array', elements: [{ type: 'number', value: 1 }, ...] }
   * Output: (calls to malloc, stores for each element, returns %Array* pointer)
   *
   * @param expr - AST expression node to generate code for
   * @param params - Function parameter names (for resolving variable references)
   * @returns LLVM register name containing the expression result (e.g., '%3')
   */
  public generateExpression(expr: Expression, params: string[]): string {
    // Delegate all expression types to ExpressionGenerator
    return this.exprGen.generate(expr, params);
  }

  public isArrayExpression(expr: Expression): boolean {
    return this.typeInference.isArrayExpression(expr);
  }

  public isObjectArrayExpression(expr: Expression): boolean {
    return this.typeInference.isObjectArrayExpression(expr);
  }

  public getObjectArrayElementType(expr: Expression): string | null {
    return this.typeInference.getObjectArrayElementType(expr);
  }

  public isObjectExpression(expr: Expression): boolean {
    return this.typeInference.isObjectExpression(expr);
  }

  public isMapExpression(expr: Expression): boolean {
    return this.typeInference.isMapExpression(expr);
  }

  public isSetExpression(expr: Expression): boolean {
    return this.typeInference.isSetExpression(expr);
  }

  public isStringExpression(expr: Expression): boolean {
    return this.typeInference.isStringExpression(expr);
  }

  public isRegexExpression(expr: Expression): boolean {
    return this.typeInference.isRegexExpression(expr);
  }

  public isClassInstanceExpression(expr: Expression): boolean {
    return this.typeInference.isClassInstanceExpression(expr);
  }

  public isPromiseExpression(expr: Expression): boolean {
    return this.typeInference.isPromiseExpression(expr);
  }

  public isAwaitExpression(expr: Expression): boolean {
    return expr.type === 'await';
  }

  public isResponseExpression(expr: Expression): boolean {
    return this.typeInference.isResponseExpression(expr);
  }

  public getTypedJsonInterface(expr: Expression): string | null {
    if (expr.type !== 'method_call') return null;
    return this.typeInference.getTypedJsonInterface(expr as MethodCallNode);
  }

  public getFunctionCallInterfaceReturn(expr: Expression): string | null {
    return this.typeInference.getFunctionCallInterfaceReturn(expr);
  }

  public getMethodCallInterfaceReturn(expr: Expression): string | null {
    return this.typeInference.getMethodCallInterfaceReturn(expr);
  }

  public getMethodCallArrayReturn(expr: Expression): { elementType: string; fields: { name: string; type: string }[] } | null {
    return this.typeInference.getMethodCallArrayReturn(expr);
  }

  public getJSONParseInterface(expr: Expression): string | null {
    if (expr.type !== 'method_call') return null;
    return this.typeInference.getJSONParseInterface(expr as MethodCallNode);
  }

  public isJSONParseExpression(expr: Expression): boolean {
    return this.typeInference.isJSONParseExpression(expr);
  }

  public isStringArrayExpression(expr: Expression): boolean {
    return this.typeInference.isStringArrayExpression(expr);
  }

  public getTopLevelItemsCount(): number {
    return this.topLevelItemsCount;
  }

  public getTopLevelStatementsCount(): number {
    return this.topLevelStatementsCount;
  }

  public getTopLevelExpressionsCount(): number {
    return this.topLevelExpressionsCount;
  }

  public getTopLevelItem(index: number): Expression {
    return this.ast.topLevelItems![index] as Expression;
  }

  public getTopLevelStatement(index: number): VariableDeclaration {
    return this.ast.topLevelStatements[index] as VariableDeclaration;
  }

  public getTopLevelExpression(index: number): CallNode | NewNode | MethodCallNode | ForStatement | ForOfStatement | WhileStatement | IfStatement | TryStatement {
    return this.ast.topLevelExpressions[index];
  }

  public getOutputAsString(): string {
    if (this.output.length === 0) {
      return '';
    }
    let result = '';
    for (let i = 0; i < this.output.length; i++) {
      result += '  ' + this.output[i] + '\n';
    }
    return result;
  }

  public processTopLevelItem(index: number): void {
    const items = this.ast.topLevelItems;
    if (!items) {
      return;
    }
    const item = items[index];
    if (!item) {
      return;
    }
    if (item.type === 'variable_declaration') {
      this.allocateVariable(item as VariableDeclaration, []);
    } else if (item.type === 'if') {
      this.syncStateToGenerators();
      this.controlFlowGen.generateIfStatement(item as IfStatement, []);
    } else if (item.type === 'while') {
      this.syncStateToGenerators();
      this.controlFlowGen.generateWhileStatement(item as WhileStatement, []);
    } else if (item.type === 'for') {
      this.syncStateToGenerators();
      this.controlFlowGen.generateForStatement(item as ForStatement, []);
    } else if (item.type === 'for_of') {
      this.syncStateToGenerators();
      this.controlFlowGen.generateForOfStatement(item as ForOfStatement, []);
    } else if (item.type === 'assignment') {
      this.generateBlock({ type: 'block', statements: [item as AssignmentStatement] }, []);
    } else {
      this.generateExpression(item as Expression, []);
    }
  }

  private generateMain(): string {
    return this.funcGen.generateMain(this.topLevelObjectVariables);
  }

  // Generate HTTP server - creates a TCP server that parses HTTP and calls handler
  public generateHttpServe(expr: CallNode, params: string[]): string {
    if (expr.args.length < 2) {
      throw new Error('httpServe() requires 2 arguments: port and handler function');
    }

    const portValue = this.generateExpression(expr.args[0], params);
    const handlerArg = expr.args[1];
    if (handlerArg.type !== 'variable') {
      throw new Error('httpServe() handler must be a function reference');
    }
    const handlerName = (handlerArg as VariableNode).name;

    // Track handler for mongoose event handler generation
    this.httpHandlers.push(handlerName);

    // Convert port from double to i32
    const portI32 = this.nextTemp();
    this.emit(`${portI32} = fptosi double ${portValue} to i32`);

    // Call the runtime http_serve function
    // Handler now takes a single Request object (i8*) and returns Response object (i8*)
    const temp = this.nextTemp();
    this.emit(`${temp} = call i32 @http_serve(i32 ${portI32}, i8* (i8*)* @${handlerName})`);

    return temp;
  }

  public getInterfaceFromAST(name: string): { name: string; fields: { name: string; type: string }[] } | null {
    for (let i = 0; i < this.ast.interfaces.length; i++) {
      const iface = this.ast.interfaces[i] as InterfaceDeclaration;
      if (iface.name === name) {
        return this.ast.interfaces[i];
      }
    }
    return null;
  }

  // Sync state to sub-generators - share Maps/arrays by reference
  // Note: Counters are already shared via bound methods (nextTemp, nextLabel, nextString)
  // Note: ALL generators now use context pattern - no state syncing needed! 🎉
  public syncStateToGenerators() {
    // No generators left to sync - all use context pattern!
    // This method kept for backward compatibility but is now a no-op
  }
}
