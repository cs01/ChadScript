import { AST, Expression, FunctionNode, BlockStatement, NewNode, CallNode, VariableNode, VariableDeclaration, ObjectNode, MethodCallNode } from '../ast/types.js';
import { BaseGenerator, SymbolKind } from './infrastructure/base-generator.js';
import { TypeInference, TypeInferenceContext } from './infrastructure/type-inference.js';
import { VariableAllocator, VariableAllocatorContext } from './infrastructure/variable-allocator.js';
import { FunctionGenerator, FunctionGeneratorContext } from './infrastructure/function-generator.js';
import { AssignmentGenerator, AssignmentGeneratorContext } from './infrastructure/assignment-generator.js';
import { getLLVMDeclarations, getSafeStringHelper, getGlobalVariables } from './infrastructure/llvm-declarations.js';
import { TypeResolver, TypeResolverContext } from './infrastructure/type-resolver/index.js';
import { ArrayGenerator } from './types/collections/array.js';
import { StringGenerator } from './types/collections/string.js';
import { ObjectGenerator } from './types/objects/object.js';
import { MapGenerator, StringMapGenerator } from './types/collections/map.js';
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
}

// ============================================
// LLVM IR CODE GENERATOR - Main Orchestrator
// ============================================

export class LLVMGenerator extends BaseGenerator {
  public ast: AST;
  public typeChecker: TypeChecker | null;
  private externalFunctions: Set<string> = new Set();
  public currentFunction: string = '';
  public currentDeclaredInterfaceType: string | undefined;
  public currentDeclaredMapType: string | undefined;
  public currentDeclaredSetType: string | undefined;
  public currentFunctionReturnType: string = 'double';
  public isAsyncFunction: boolean = false;
  public asyncResultPromise: string = '';

  // Top-level variables (accessible from all functions)
  private topLevelObjectVariables: Map<string, { ptr: string; keys: string[]; types: string[] }> = new Map();

  // Global variables declared with LLVM @ prefix (accessible from any function)
  private globalVariables: Map<string, { llvmType: string; kind: SymbolKind; initialized: boolean }> = new Map();

  // Specialized generators
  private arrayGen: ArrayGenerator;
  public stringGen: StringGenerator;
  private objectGen: ObjectGenerator;
  private mapGen: MapGenerator;
  private stringMapGen: StringMapGenerator;
  private setGen: SetGenerator;
  private stringSetGen: StringSetGenerator;
  private controlFlowGen: ControlFlowGenerator;
  public classGen: ClassGenerator;
  private regexGen: RegexGenerator;

  // Method generators (context pattern)
  private mathGen: MathGenerator;
  private consoleGen: ConsoleGenerator;
  private processGen: ProcessGenerator;
  private pathGen: PathGenerator;
  private jsonGen: JsonGenerator;
  private fsGen: FilesystemGenerator;
  private responseGen: ResponseGenerator;
  private runtimeGen: RuntimeGenerator;
  private mongooseGen: MongooseGenerator;
  private libuvGen: LibuvGenerator;
  private promiseGen: PromiseGenerator;
  private treesitterGen: TreeSitterGenerator;
  private httpHandlers: string[] = [];
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

  // Helper: Format nice compiler errors
  private formatCodegenError(message: string, suggestion?: string): string {
    let error = `\x1b[31m\x1b[1merror:\x1b[0m ${message}\n`;

    if (suggestion) {
      error += `\n\x1b[36m\x1b[1mℹ suggestion:\x1b[0m\n`;
      error += `${suggestion}\n`;
    }

    return error;
  }

  // Helper: Extract object literal metadata (keys and types)
  private getObjectMetadata(objExpr: ObjectNode): { keys: string[]; types: string[] } {
    if (objExpr.type !== 'object') {
      return { keys: [], types: [] };
    }

    const keys: string[] = [];
    const types: string[] = [];

    for (let i = 0; i < objExpr.properties.length; i++) {
      keys.push(objExpr.properties[i].key);

      let llvmType: string;

      if (objExpr.properties[i].value.type === 'string' || this.isStringExpression(objExpr.properties[i].value)) {
        llvmType = 'i8*';
      } else if (objExpr.properties[i].value.type === 'array') {
        llvmType = this.isStringArrayExpression(objExpr.properties[i].value) ? '%StringArray*' : '%Array*';
      } else if (objExpr.properties[i].value.type === 'map') {
        llvmType = '%Map*';
      } else if (objExpr.properties[i].value.type === 'set') {
        llvmType = '%Set*';
      } else {
        llvmType = 'double';
      }

      types.push(llvmType);
    }

    return { keys, types };
  }

  private linkTreeSitter: boolean = false;

  constructor(ast: AST, typeChecker: TypeChecker | null, options: LLVMGeneratorOptions) {
    super();
    this.ast = ast;
    this.typeChecker = typeChecker;
    this.linkTreeSitter = options.linkTreeSitter;

    this.interfaceStructGen = new InterfaceStructGenerator(ast.interfaces || []);

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
    this.setGen = new SetGenerator(this);
    this.stringSetGen = new StringSetGenerator(this);
    this.controlFlowGen = new ControlFlowGenerator(this);
    this.classGen = new ClassGenerator(this);

    this.typeInference = new TypeInference(this as unknown as TypeInferenceContext);

    this.typeResolver = new TypeResolver(this as unknown as TypeResolverContext);

    this.varAllocator = new VariableAllocator(this as unknown as VariableAllocatorContext);

    this.funcGen = new FunctionGenerator(this as unknown as FunctionGeneratorContext);

    this.assignmentGen = new AssignmentGenerator(this as unknown as AssignmentGeneratorContext);

    // No more delegate binding needed - all generators use context pattern! 🎯

    // Note: External function tracking removed for self-hosting compatibility.
    // All imported functions are compiled into the same binary, so no external declarations needed.
  }

  // Override reset to preserve top-level variables
  reset() {
    super.reset();
    // Restore top-level object variables after reset
    this.topLevelObjectVariables.forEach((meta, name) => {
      this.defineVariable(name, meta.ptr, 'i8*', SymbolKind.Object, 'global', {
        objectMetadata: { keys: meta.keys, types: meta.types }
      });
    });
    // Restore global variables after reset so functions can access them
    this.globalVariables.forEach((info, name) => {
      this.defineVariable(name, `@${name}`, info.llvmType, info.kind, 'global');
    });
  }

  private generateGlobalVariableDeclarations(): string {
    let ir = '';
    for (const stmt of this.ast.topLevelStatements || []) {
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
    if (interfaceStructDefs) {
      this.globalStrings.unshift(interfaceStructDefs);
    }

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

    ir += getGlobalVariables();

    // Generate global variable declarations for top-level let/const
    ir += this.generateGlobalVariableDeclarations();

    // Generate external function declarations for imports
    for (const funcName of this.externalFunctions) {
      ir += `declare i32 @${funcName}(...)\n`;
    }
    if (this.externalFunctions.size > 0) {
      ir += '\n';
    }

    // Generate class definitions
    for (const classNode of this.ast.classes) {
      this.syncStateToGenerators();
      ir += this.classGen.generateClass(classNode);
      ir += '\n';
    }

    // Generate user function definitions (this may discover lifted functions)
    let userFunctionsIr = '';
    for (const func of this.ast.functions) {
      userFunctionsIr += this.generateFunction(func);
      userFunctionsIr += '\n';
    }

    // Generate main function (this may also discover lifted functions)
    const mainIr = this.generateMain();

    // Generate environment struct type definitions for closures
    const envStructDefs = this.exprGen.getArrowFunctionGenerator().getEnvStructDefinitions();
    if (envStructDefs) {
      ir += envStructDefs;
      ir += '\n';
    }

    // Generate lifted functions (discovered during user function and main generation)
    // These need to be placed BEFORE user functions so they can be called
    const liftedFunctions = this.exprGen.getArrowFunctionGenerator().getLiftedFunctions();
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

    for (const stmt of block.statements) {
      // Stop processing if we've already generated a terminator
      if (hasTerminator) {
        break;
      }

      if (stmt.type === 'variable_declaration') {
        this.allocateVariable(stmt, params);
      } else if (stmt.type === 'assignment') {
        // Check if this is a member access assignment (this.field = value)
        if (stmt.name.startsWith('__member_access__')) {
          this.assignmentGen.generateMemberAccessAssignment(stmt, params);
        } else {
          // Regular variable assignment
          const value = this.generateExpression(stmt.value, params);

          // Check for string variable
          const stringAllocaReg = this.symbolTable.getStringAlloca(stmt.name);
          if (stringAllocaReg) {
            this.emit(`store i8* ${value}, i8** ${stringAllocaReg}`);
            return '';
          }

          // Check for array variable
          const arrayAllocaReg = this.symbolTable.getArrayAlloca(stmt.name);
          if (arrayAllocaReg) {
            const loadedArray = this.nextTemp();
            this.emit(`${loadedArray} = load %Array, %Array* ${value}`);
            this.emit(`store %Array ${loadedArray}, %Array* ${arrayAllocaReg}`);
            return '';
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
        lastValue = this.generateExpression(stmt.value, params);

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

          this.emit(`ret ${this.currentFunctionReturnType} ${lastValue}`);
        }
        hasTerminator = true;
      } else if (stmt.type === 'if') {
        this.syncStateToGenerators();
        lastValue = this.controlFlowGen.generateIfStatement(stmt, params);
        // Don't need to sync back - counters are already shared via bound methods
      } else if (stmt.type === 'while') {
        this.syncStateToGenerators();
        lastValue = this.controlFlowGen.generateWhileStatement(stmt, params);
      } else if (stmt.type === 'for') {
        this.syncStateToGenerators();
        lastValue = this.controlFlowGen.generateForStatement(stmt, params);
      } else if (stmt.type === 'for_of') {
        this.syncStateToGenerators();
        lastValue = this.controlFlowGen.generateForOfStatement(stmt, params);
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
        lastValue = this.controlFlowGen.generateThrowStatement(stmt, params);
        hasTerminator = true;  // throw generates 'unreachable', which is a terminator
      } else if (stmt.type === 'try') {
        this.syncStateToGenerators();
        lastValue = this.controlFlowGen.generateTryStatement(stmt, params);
      } else {
        // Expression statement
        lastValue = this.generateExpression(stmt, params);
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

  public isObjectExpression(expr: Expression): boolean {
    return this.typeInference.isObjectExpression(expr);
  }

  private isMapExpression(expr: Expression): boolean {
    return this.typeInference.isMapExpression(expr);
  }

  private isSetExpression(expr: Expression): boolean {
    return this.typeInference.isSetExpression(expr);
  }

  public isStringExpression(expr: Expression): boolean {
    return this.typeInference.isStringExpression(expr);
  }

  private isRegexExpression(expr: Expression): boolean {
    return this.typeInference.isRegexExpression(expr);
  }

  private isClassInstanceExpression(expr: Expression): boolean {
    return this.typeInference.isClassInstanceExpression(expr);
  }

  public isPromiseExpression(expr: Expression): boolean {
    return this.typeInference.isPromiseExpression(expr);
  }

  public isAwaitExpression(expr: Expression): boolean {
    return expr.type === 'await';
  }

  private isResponseExpression(expr: Expression): boolean {
    return this.typeInference.isResponseExpression(expr);
  }

  private getTypedJsonInterface(expr: Expression): string | null {
    if (expr.type !== 'method_call') return null;
    return this.typeInference.getTypedJsonInterface(expr as MethodCallNode);
  }

  private getFunctionCallInterfaceReturn(expr: Expression): string | null {
    return this.typeInference.getFunctionCallInterfaceReturn(expr);
  }

  private getJSONParseInterface(expr: Expression): string | null {
    if (expr.type !== 'method_call') return null;
    return this.typeInference.getJSONParseInterface(expr as MethodCallNode);
  }

  private isJSONParseExpression(expr: Expression): boolean {
    return this.typeInference.isJSONParseExpression(expr);
  }

  public isStringArrayExpression(expr: Expression): boolean {
    return this.typeInference.isStringArrayExpression(expr);
  }

  private isBooleanExpression(expr: Expression): boolean {
    return this.typeInference.isBooleanExpression(expr);
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
      const iface = this.ast.interfaces[i];
      if (iface.name === name) {
        return iface;
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
