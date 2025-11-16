import { AST, Expression, FunctionNode, BlockStatement, MethodCallNode, NewNode, ThisNode } from '../ast/types.js';
import { BaseGenerator, SymbolKind } from './infrastructure/base-generator.js';
import { ArrayGenerator } from './types/collections/array.js';
import { StringGenerator } from './types/collections/string.js';
import { ObjectGenerator } from './types/objects/object.js';
import { MapGenerator } from './types/collections/map.js';
import { SetGenerator } from './types/collections/set.js';
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
import { ExpressionGenerator } from './expressions/orchestrator.js';
import { TypeChecker } from '../typescript/type-checker.js';
import { logger } from '../utils/logger.js';

// ============================================
// LLVM IR CODE GENERATOR - Main Orchestrator
// ============================================

export class LLVMGenerator extends BaseGenerator {
  public ast: AST; // Public for IGeneratorContext
  private typeChecker: TypeChecker | null;
  private externalFunctions: Set<string> = new Set();
  private currentFunction: string = ''; // Track current function for type checking

  // Top-level variables (accessible from all functions)
  private topLevelObjectVariables: Map<string, { ptr: string; keys: string[]; types: string[] }> = new Map();

  // Specialized generators
  private arrayGen: ArrayGenerator;
  private stringGen: StringGenerator;
  private objectGen: ObjectGenerator;
  private mapGen: MapGenerator;
  private setGen: SetGenerator;
  private controlFlowGen: ControlFlowGenerator;
  private classGen: ClassGenerator;
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

  // Expression generator (context pattern)
  private exprGen: ExpressionGenerator;

  // Helper: Format nice compiler errors
  private formatCodegenError(message: string, suggestion?: string): string {
    let error = `\x1b[31m\x1b[1merror:\x1b[0m ${message}\n`;

    if (suggestion) {
      error += `\n\x1b[36m\x1b[1mℹ suggestion:\x1b[0m\n`;
      error += `${suggestion}\n`;
    }

    return error;
  }

  // Helper: Convert a value to i32 if it's a double register
  private convertToI32(value: string): string {
    const valueType = this.getVariableType(value);
    if (valueType === 'double' || value.startsWith('%')) {
      const i32Value = this.nextTemp();
      this.emit(`${i32Value} = fptosi double ${value} to i32`);
      return i32Value;
    }
    return value;
  }

  // Helper: Extract object literal metadata (keys and types)
  private getObjectMetadata(objExpr: any): { keys: string[]; types: string[] } {
    if (objExpr.type !== 'object') {
      return { keys: [], types: [] };
    }

    const keys: string[] = [];
    const types: string[] = [];

    for (const prop of objExpr.properties) {
      keys.push(prop.key);

      // Determine type from value expression
      const valueExpr = prop.value;
      let llvmType: string;

      if (valueExpr.type === 'string' || this.isStringExpression(valueExpr)) {
        llvmType = 'i8*';
      } else if (valueExpr.type === 'array') {
        llvmType = this.isStringArrayExpression(valueExpr) ? '%StringArray*' : '%Array*';
      } else if ((valueExpr as any).type === 'map') {
        llvmType = '%Map*';
      } else if ((valueExpr as any).type === 'set') {
        llvmType = '%Set*';
      } else {
        // All numeric values (including booleans) are double
        llvmType = 'double';
      }

      types.push(llvmType);
    }

    return { keys, types };
  }

  constructor(ast: AST, typeChecker: TypeChecker | null = null) {
    super();
    this.ast = ast;
    this.typeChecker = typeChecker;

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

    // Initialize expression generator with context pattern
    this.exprGen = new ExpressionGenerator(this);
    // Set up fallback for unextracted expression types
    (this as any).generateExpressionFallback = this.generateExpression.bind(this);

    // All generators now use context pattern! 🎉
    this.arrayGen = new ArrayGenerator(this);
    this.stringGen = new StringGenerator(this);
    this.mapGen = new MapGenerator(this);
    this.setGen = new SetGenerator(this);
    this.controlFlowGen = new ControlFlowGenerator(this);
    this.classGen = new ClassGenerator(this);

    // No more delegate binding needed - all generators use context pattern! 🎯

    // Collect all imported function names
    for (const imp of ast.imports) {
      for (const spec of imp.specifiers) {
        this.externalFunctions.add(spec);
      }
    }
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

    // Define array struct type: { double* data, i32 length, i32 capacity }
    ir += '%Array = type { double*, i32, i32 }\n';

    // Define string array struct type: { i8** data, i32 length, i32 capacity }
    ir += '%StringArray = type { i8**, i32, i32 }\n';

    // Define Map struct type: { double* keys, double* values, i32 size, i32 capacity }
    ir += '%Map = type { double*, double*, i32, i32 }\n';

    // Define Set struct type: { double* values, i32 size, i32 capacity }
    ir += '%Set = type { double*, i32, i32 }\n\n';

    // Declare external C functions for string operations
    ir += 'declare i8* @malloc(i64)\n';
    ir += 'declare i8* @calloc(i64, i64)\n';
    ir += 'declare void @free(i8*)\n';
    ir += 'declare i8* @strcpy(i8*, i8*)\n';
    ir += 'declare i8* @strcat(i8*, i8*)\n';
    ir += 'declare i8* @strdup(i8*)\n';
    ir += 'declare i64 @strlen(i8*)\n';
    ir += 'declare i32 @strcmp(i8*, i8*)\n';
    ir += 'declare i32 @strncmp(i8*, i8*, i64)\n';
    ir += 'declare i32 @snprintf(i8*, i64, i8*, ...)\n';
    ir += 'declare i64 @strtol(i8*, i8**, i32)\n';  // For parseInt
    ir += 'declare i8* @strstr(i8*, i8*)\n';  // For indexOf
    ir += 'declare void @llvm.memcpy.p0i8.p0i8.i64(i8*, i8*, i64, i1)\n';
    ir += '\n';

    // Declare LLVM math intrinsics
    ir += 'declare double @llvm.sqrt.f64(double)\n';
    ir += 'declare double @llvm.pow.f64(double, double)\n';
    ir += 'declare double @llvm.floor.f64(double)\n';
    ir += 'declare double @llvm.ceil.f64(double)\n';
    ir += 'declare double @llvm.round.f64(double)\n';
    ir += 'declare double @llvm.fabs.f64(double)\n';
    ir += '\n';

    // Declare POSIX regex functions
    ir += 'declare i32 @regcomp(i8*, i8*, i32)\n';
    ir += 'declare i32 @regexec(i8*, i8*, i64, i8*, i32)\n';
    ir += 'declare void @regfree(i8*)\n';
    ir += '\n';

    // Declare printf and fprintf for console output
    ir += 'declare i32 @printf(i8*, ...)\n';
    ir += 'declare i32 @fprintf(i8*, i8*, ...)\n';
    ir += '@stderr = external global i8*\n';  // stderr FILE* pointer
    ir += '\n';

    // Declare exit and fflush for process.exit()
    ir += 'declare void @exit(i32)\n';
    ir += 'declare i32 @fflush(i8*)\n';
    ir += '@stdout = external global i8*\n';  // stdout FILE* pointer
    ir += '\n';

    // Declare file I/O functions for fs module
    ir += 'declare i8* @fopen(i8*, i8*)\n';
    ir += 'declare i32 @fclose(i8*)\n';
    ir += 'declare i64 @fread(i8*, i64, i64, i8*)\n';
    ir += 'declare i64 @fwrite(i8*, i64, i64, i8*)\n';
    ir += 'declare i32 @fseek(i8*, i64, i32)\n';
    ir += 'declare i64 @ftell(i8*)\n';
    ir += 'declare i32 @unlink(i8*)\n';
    ir += '\n';

    // Declare network/socket functions (POSIX)
    ir += 'declare i32 @socket(i32, i32, i32)\n';      // socket(domain, type, protocol)
    ir += 'declare i32 @close(i32)\n';                 // close(fd)
    ir += 'declare i32 @bind(i32, i8*, i32)\n';        // bind(sockfd, addr, addrlen)
    ir += 'declare i32 @listen(i32, i32)\n';           // listen(sockfd, backlog)
    ir += 'declare i32 @accept(i32, i8*, i32*)\n';     // accept(sockfd, addr, addrlen)
    ir += 'declare i32 @connect(i32, i8*, i32)\n';     // connect(sockfd, addr, addrlen)
    ir += 'declare i64 @read(i32, i8*, i64)\n';        // read(fd, buf, count)
    ir += 'declare i64 @write(i32, i8*, i64)\n';       // write(fd, buf, count)
    ir += 'declare i16 @htons(i16)\n';                 // htons(hostshort) - network byte order
    ir += '\n';

    // Declare path functions for path module
    ir += 'declare i8* @realpath(i8*, i8*)\n';
    ir += 'declare i8* @dirname(i8*)\n';
    ir += '\n';

    // Declare system/process functions for child_process module
    ir += 'declare i32 @system(i8*)\n';
    ir += '\n';

    // Declare functions for JSON module
    ir += 'declare i32 @sprintf(i8*, i8*, ...)\n';
    ir += '\n';

    // libcurl for fetch() API
    ir += '; libcurl functions\n';
    ir += 'declare i8* @curl_easy_init()\n';
    ir += 'declare i32 @curl_easy_setopt(i8*, i32, ...)\n';
    ir += 'declare i32 @curl_easy_perform(i8*)\n';
    ir += 'declare void @curl_easy_cleanup(i8*)\n';
    ir += 'declare i8* @curl_easy_strerror(i32)\n';
    ir += '\n';

    // libcurl constants
    ir += '@CURLOPT_URL = constant i32 10002\n';
    ir += '@CURLOPT_WRITEFUNCTION = constant i32 20011\n';
    ir += '@CURLOPT_WRITEDATA = constant i32 10001\n';
    ir += '@CURLOPT_FOLLOWLOCATION = constant i32 52\n';
    ir += '@CURLOPT_USERAGENT = constant i32 10018\n';
    ir += '\n';

    // fetch() runtime implementation
    ir += this.runtimeGen.generateFetchRuntime();
    ir += '\n';

    // JSON parsing runtime
    ir += this.runtimeGen.generateJSONRuntime();
    ir += '\n';

    // Helper function to safely get string or return empty string if NULL
    ir += '; Return empty string if pointer is NULL, otherwise return the pointer\n';
    ir += 'define i8* @__safe_string(i8* %str) {\n';
    ir += 'entry:\n';
    ir += '  %is_null = icmp eq i8* %str, null\n';
    ir += '  br i1 %is_null, label %return_empty, label %return_str\n';
    ir += '\n';
    ir += 'return_empty:\n';
    ir += '  ret i8* getelementptr inbounds ([1 x i8], [1 x i8]* @.empty_str, i64 0, i64 0)\n';
    ir += '\n';
    ir += 'return_str:\n';
    ir += '  ret i8* %str\n';
    ir += '}\n';
    ir += '\n';

    // Empty string constant for NULL handling
    ir += '@.empty_str = private unnamed_addr constant [1 x i8] c"\\00", align 1\n';
    ir += '\n';

    // Global variables for process.argv
    ir += '@__argc = global i32 0\n';
    ir += '@__argv = global i8** null\n';
    ir += '\n';

    // Global flag to detect ChadScript environment
    ir += '@__chadscript = global double 1.0\n';
    ir += '\n';

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
    this.reset();
    this.syncStateToGenerators();
    this.currentFunction = func.name; // Track current function for type checking

    // Determine parameter and return types using TypeChecker
    const paramTypes: string[] = [];
    const paramLLVMTypes: string[] = [];
    let returnType = 'double';
    let returnTypeIsString = false;
    let returnTypeIsVoid = false;
    this.currentFunctionReturnType = 'double'; // Default to double

    if (this.typeChecker) {
      try {
        // Get function signature from TypeChecker
        const funcType = this.typeChecker.getFunctionType(func.name);
        if (funcType) {
          // Check return type
          if (funcType.returnType === 'string') {
            returnType = 'i8*';
            returnTypeIsString = true;
            this.currentFunctionReturnType = 'i8*';
          } else if (funcType.returnType === 'void') {
            returnType = 'void';
            returnTypeIsVoid = true;
            this.currentFunctionReturnType = 'void';
          }

          // Check parameter types
          for (let i = 0; i < func.params.length; i++) {
            const paramType = funcType.parameters[i]?.type || 'number';
            paramTypes.push(paramType);
            if (paramType === 'string') {
              paramLLVMTypes.push('i8*');
            } else if (paramType !== 'number' && paramType !== 'boolean') {
              // Object/interface type - use i32 for object pointer
              paramLLVMTypes.push('i32');
            } else {
              paramLLVMTypes.push('double');
            }
          }
        }
      } catch (e) {
        // Type checker failed, fall back to defaults
      }
    }

    // For .js files or when TypeChecker isn't available, check if function has return statements
    // If no return statements, assume void
    if (!returnTypeIsString && !returnTypeIsVoid && !this.hasReturnStatement(func.body)) {
      returnType = 'void';
      returnTypeIsVoid = true;
      this.currentFunctionReturnType = 'void';
    }

    // Fill in missing parameter types with double
    while (paramLLVMTypes.length < func.params.length) {
      paramTypes.push('number');
      paramLLVMTypes.push('double');
    }

    // Generate function signature
    let ir = `define ${returnType} @${func.name}(`;
    ir += func.params.map((_, i) => `${paramLLVMTypes[i]} %arg${i}`).join(', ');
    ir += ') {\n';
    ir += 'entry:\n';

    // Allocate stack space for parameters so they can be treated like variables
    for (let i = 0; i < func.params.length; i++) {
      const paramName = func.params[i];
      const allocaReg = this.nextTemp();
      const llvmType = paramLLVMTypes[i];

      if (llvmType === 'i8*') {
        // String parameter
        this.defineVariable(paramName, allocaReg, 'i8*', SymbolKind.String, 'local');
        this.emit(`${allocaReg} = alloca i8*`);
        this.emit(`store i8* %arg${i}, i8** ${allocaReg}`);
      } else if (llvmType === 'i32') {
        // Object/interface parameter (pointer stored as i32)
        this.defineVariable(paramName, allocaReg, 'i32', SymbolKind.Object, 'local');
        this.emit(`${allocaReg} = alloca i32`);
        this.emit(`store i32 %arg${i}, i32* ${allocaReg}`);
      } else {
        // Numeric parameter (double)
        this.defineVariable(paramName, allocaReg, 'double', SymbolKind.Number, 'local');
        this.emit(`${allocaReg} = alloca double`);
        this.emit(`store double %arg${i}, double* ${allocaReg}`);
      }
    }

    // Generate body
    const result = this.generateBlock(func.body, func.params);

    // Add any instructions that were generated
    if (this.output.length > 0) {
      ir += this.output.map(line => '  ' + line).join('\n') + '\n';
    }

    // Check if the last instruction is a terminator
    const lastInstruction = this.output.length > 0 ? this.output[this.output.length - 1].trim() : '';
    const hasTerminator = lastInstruction.startsWith('ret ') ||
                          lastInstruction.startsWith('br ') ||
                          lastInstruction === 'unreachable';

    // Only add ret if we don't already have a terminator
    if (!hasTerminator) {
      if (returnTypeIsVoid) {
        // Void function - no return value
        ir += '  ret void\n';
      } else if (result !== null) {
        // Return the result value
        ir += `  ret ${returnType} ${result}\n`;
      } else {
        // No explicit return - return default value
        if (returnTypeIsString) {
          // Return empty string
          this.syncStateToGenerators();
          const emptyStr = this.stringGen.createStringConstant('');
          ir += `  ret i8* ${emptyStr}\n`;
        } else {
          ir += `  ret ${returnType} 0.0\n`;
        }
      }
    }
    ir += '}\n';

    return ir;
  }

  /**
   * Check if a block contains any return statements (recursively)
   */
  private hasReturnStatement(block: BlockStatement): boolean {
    for (const stmt of block.statements) {
      if (stmt.type === 'return') {
        return true;
      }
      // Check nested blocks
      if (stmt.type === 'if' && (stmt as any).thenBlock) {
        if (this.hasReturnStatement((stmt as any).thenBlock)) return true;
        if ((stmt as any).elseBlock && this.hasReturnStatement((stmt as any).elseBlock)) return true;
      }
      if (stmt.type === 'while' && stmt.body) {
        if (this.hasReturnStatement(stmt.body)) return true;
      }
      if (stmt.type === 'for' && stmt.body) {
        if (this.hasReturnStatement(stmt.body)) return true;
      }
    }
    return false;
  }

  /**
   * Allocate stack space for a variable declaration.
   * Handles all variable types: strings, arrays, objects, maps, sets, regex, classes, Response, etc.
   * This eliminates duplicate code between generateBlock() and generateMain().
   *
   * @param stmt - Variable declaration statement
   * @param params - Function parameters for expression generation
   */
  private allocateVariable(stmt: any, params: string[]): void {
    // Handle uninitialized variables (e.g., let x;)
    if (stmt.value === null) {
      const allocaReg = this.nextTemp();
      this.defineVariable(stmt.name, allocaReg, 'double', SymbolKind.Number, 'local');
      this.emit(`${allocaReg} = alloca double`);
      this.emit(`store double 0.0, double* ${allocaReg}`);
      return;
    }

    // Set expected array element type from TypeScript type annotation if available
    if (stmt.declaredType) {
      if (stmt.declaredType === 'string[]') {
        this.expectedArrayElementType = 'string';
      } else if (stmt.declaredType === 'number[]' || stmt.declaredType === 'boolean[]') {
        this.expectedArrayElementType = 'number';
      }
    }

    // Determine variable type (check isStringArray BEFORE isArray since string arrays are also arrays)
    const isString = this.isStringExpression(stmt.value);
    const isStringArray = this.isStringArrayExpression(stmt.value);
    const isArray = !isStringArray && this.isArrayExpression(stmt.value);
    const isJSONObject = this.isJSONParseExpression(stmt.value);
    const isObject = !isJSONObject && this.isObjectExpression(stmt.value);
    const isMap = this.isMapExpression(stmt.value);
    const isSet = this.isSetExpression(stmt.value);
    const isRegex = this.isRegexExpression(stmt.value);
    const isClassInstance = this.isClassInstanceExpression(stmt.value);
    const isResponse = this.isResponseExpression(stmt.value);
    const typedJsonInterface = this.getTypedJsonInterface(stmt.value);

    if (isClassInstance) {
      const allocaReg = this.nextTemp();
      const newExpr = stmt.value as any as NewNode;
      const className = newExpr.className;
      const fields = this.classGen.getClassFields(className);
      const ptrType = fields.length > 0 ? `%${className}_struct*` : 'i32*';

      this.defineVariable(stmt.name, allocaReg, ptrType, SymbolKind.Class, 'local', {
        classMetadata: { className }
      });
      this.emit(`${allocaReg} = alloca ${ptrType}`);

      const instancePtr = this.generateExpression(stmt.value, params);
      this.emit(`store ${ptrType} ${instancePtr}, ${ptrType}* ${allocaReg}`);
    } else if (typedJsonInterface) {
      // Typed JSON struct from .json<T>()
      const allocaReg = this.nextTemp();
      const structType = `%${typedJsonInterface}*`;
      this.defineVariable(stmt.name, allocaReg, structType, SymbolKind.Object, 'local');
      this.emit(`${allocaReg} = alloca ${structType}`);

      const structPtr = this.generateExpression(stmt.value, params);
      this.emit(`store ${structType} ${structPtr}, ${structType}* ${allocaReg}`);
    } else if (isResponse) {
      const allocaReg = this.nextTemp();
      this.defineVariable(stmt.name, allocaReg, '%Response*', SymbolKind.Object, 'local');
      this.emit(`${allocaReg} = alloca %Response*`);

      const responsePtr = this.generateExpression(stmt.value, params);
      this.emit(`store %Response* ${responsePtr}, %Response** ${allocaReg}`);
    } else if (isJSONObject) {
      const allocaReg = this.nextTemp();
      this.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.JSON, 'local');
      this.emit(`${allocaReg} = alloca i8*`);

      const jsonPtr = this.generateExpression(stmt.value, params);
      this.emit(`store i8* ${jsonPtr}, i8** ${allocaReg}`);
    } else if (isObject) {
      const allocaReg = this.nextTemp();
      const metadata = this.getObjectMetadata(stmt.value as any);
      this.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.Object, 'local', {
        objectMetadata: { keys: metadata.keys, types: metadata.types }
      });
      this.emit(`${allocaReg} = alloca i8*`);

      const objExpr = this.generateExpression(stmt.value, params);
      this.emit(`store i8* ${objExpr}, i8** ${allocaReg}`);
    } else if (isMap) {
      const allocaReg = this.nextTemp();
      this.defineVariable(stmt.name, allocaReg, '%Map*', SymbolKind.Map, 'local');
      this.emit(`${allocaReg} = alloca %Map`);

      const value = this.generateExpression(stmt.value, params);
      const loadedMap = this.nextTemp();
      this.emit(`${loadedMap} = load %Map, %Map* ${value}`);
      this.emit(`store %Map ${loadedMap}, %Map* ${allocaReg}`);
    } else if (isSet) {
      const allocaReg = this.nextTemp();
      this.defineVariable(stmt.name, allocaReg, '%Set*', SymbolKind.Set, 'local');
      this.emit(`${allocaReg} = alloca %Set`);

      const value = this.generateExpression(stmt.value, params);
      const loadedSet = this.nextTemp();
      this.emit(`${loadedSet} = load %Set, %Set* ${value}`);
      this.emit(`store %Set ${loadedSet}, %Set* ${allocaReg}`);
    } else if (isStringArray) {
      const allocaReg = this.nextTemp();
      this.defineVariable(stmt.name, allocaReg, '%StringArray*', SymbolKind.StringArray, 'local');
      this.emit(`${allocaReg} = alloca %StringArray`);

      const value = this.generateExpression(stmt.value, params);
      const loadedStringArray = this.nextTemp();
      this.emit(`${loadedStringArray} = load %StringArray, %StringArray* ${value}`);
      this.emit(`store %StringArray ${loadedStringArray}, %StringArray* ${allocaReg}`);
    } else if (isArray) {
      const allocaReg = this.nextTemp();
      this.defineVariable(stmt.name, allocaReg, '%Array*', SymbolKind.Array, 'local');
      this.emit(`${allocaReg} = alloca %Array`);

      const value = this.generateExpression(stmt.value, params);
      const loadedArray = this.nextTemp();
      this.emit(`${loadedArray} = load %Array, %Array* ${value}`);
      this.emit(`store %Array ${loadedArray}, %Array* ${allocaReg}`);
    } else if (isRegex) {
      const allocaReg = this.nextTemp();
      this.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.Regex, 'local');
      this.emit(`${allocaReg} = alloca i8*`);

      const value = this.generateExpression(stmt.value, params);
      this.emit(`store i8* ${value}, i8** ${allocaReg}`);
    } else if (isString) {
      const allocaReg = this.nextTemp();
      this.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.String, 'local');
      this.emit(`${allocaReg} = alloca i8*`);

      const value = this.generateExpression(stmt.value, params);
      this.emit(`store i8* ${value}, i8** ${allocaReg}`);
    } else {
      // Numeric value (all numeric values, including booleans)
      const allocaReg = this.nextTemp();
      this.defineVariable(stmt.name, allocaReg, 'double', SymbolKind.Number, 'local');
      this.emit(`${allocaReg} = alloca double`);

      const value = this.generateExpression(stmt.value, params);
      this.emit(`store double ${value}, double* ${allocaReg}`);
    }

    // Reset expected array element type after variable declaration is complete
    this.expectedArrayElementType = null;
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
          // Extract property name and handle member access assignment
          const memberAccessValue = stmt.value as any;
          if (memberAccessValue.type === 'member_access_assignment') {
            const object = memberAccessValue.object;
            const property = memberAccessValue.property;

            // Get instance pointer and className first
            let instancePtr: string | null = null;
            let className: string | null = null;

            if (object.type === 'variable' && this.symbolTable.isClass(object.name)) {
              const classMeta = this.symbolTable.getClassInfo(object.name)!;
              className = classMeta.className;
            } else if ((object as any).type === 'new') {
              const newExpr = object as any as NewNode;
              className = newExpr.className;
            } else if ((object as any).type === 'this') {
              if (!this.thisPointer) {
                throw new Error('this.field = value used outside of class method or constructor');
              }
              // Find class - simplified for now
              const classWithField = this.ast.classes.find(c => true);
              if (classWithField) {
                className = classWithField.name;
              }
            }

            // Get field info to determine expected type
            let fieldInfo = null;
            if (className) {
              fieldInfo = this.classGen.getFieldInfo(className, property);
              // Set expected array element type for array field assignments
              if (fieldInfo && fieldInfo.type === 'string[]') {
                this.expectedArrayElementType = 'string';
              } else if (fieldInfo && fieldInfo.type === 'number[]') {
                this.expectedArrayElementType = 'number';
              } else if (fieldInfo && fieldInfo.type === 'boolean[]') {
                this.expectedArrayElementType = 'boolean';
              }
            }

            // Now generate the value with context
            const value = this.generateExpression(memberAccessValue.value, params);
            this.expectedArrayElementType = null; // Reset context

            // Generate instance pointer
            if (object.type === 'variable' && this.symbolTable.isClass(object.name)) {
              instancePtr = this.generateExpression(object, params);
            } else if ((object as any).type === 'new') {
              instancePtr = this.generateExpression(object, params);
            } else if ((object as any).type === 'this') {
              instancePtr = this.thisPointer;
            } else {
              throw new Error(`Cannot assign to property of ${object.type}`);
            }

            if (instancePtr && className) {
              const fields = this.classGen.getClassFields(className);

              if (fieldInfo) {
                // Typed field - use struct getelementptr
                const fieldPtr = this.nextTemp();
                if (fields.length > 0) {
                  this.emit(`${fieldPtr} = getelementptr inbounds %${className}_struct, %${className}_struct* ${instancePtr}, i32 0, i32 ${fieldInfo.index}`);

                  if (fieldInfo.type === 'string') {
                    // Store string pointer (i8*)
                    // Check if value is already i8* (from properly typed variable)
                    let isAlreadyPointer = false;
                    if (memberAccessValue.value.type === 'variable') {
                      const varType = this.getVariableType(memberAccessValue.value.name);
                      if (varType === 'i8*' || varType?.includes('*')) {
                        isAlreadyPointer = true;
                      }
                    } else if (memberAccessValue.value.type === 'string') {
                      // String constants are already i8*
                      isAlreadyPointer = true;
                    }

                    if (isAlreadyPointer) {
                      // Value is already i8*, store directly
                      this.emit(`store i8* ${value}, i8** ${fieldPtr}`);
                    } else {
                      // Value is i32, need to convert to i8*
                      const strPtr = this.nextTemp();
                      this.emit(`${strPtr} = inttoptr i32 ${value} to i8*`);
                      this.emit(`store i8* ${strPtr}, i8** ${fieldPtr}`);
                    }
                  } else if (fieldInfo.type === 'string[]') {
                    // Store string array pointer (%StringArray*)
                    // Value is already a %StringArray* from array generation
                    this.emit(`store %StringArray* ${value}, %StringArray** ${fieldPtr}`);
                  } else if (fieldInfo.type.endsWith('[]')) {
                    // Store number/boolean array pointer (%Array*)
                    // Value is already an %Array* from array generation
                    this.emit(`store %Array* ${value}, %Array** ${fieldPtr}`);
                  } else {
                    // Store double (JavaScript semantics)
                    this.emit(`store double ${value}, double* ${fieldPtr}`);
                  }
                } else {
                  // Backward compat: no declared fields, use double*
                  this.emit(`${fieldPtr} = getelementptr inbounds double, double* ${instancePtr}, i32 ${fieldInfo.index}`);
                  this.emit(`store double ${value}, double* ${fieldPtr}`);
                }
              } else if (fields.length === 0) {
                // Backward compat: no declared fields, use index 0 with double*
                const fieldPtr = this.nextTemp();
                this.emit(`${fieldPtr} = getelementptr inbounds double, double* ${instancePtr}, i32 0`);
                this.emit(`store double ${value}, double* ${fieldPtr}`);
              } else {
                throw new Error(`Field '${property}' not found in class ${className}. Did you forget to declare it with a type annotation?`);
              }
            } else {
              throw new Error('Could not determine class instance for field assignment');
            }
          } else {
            throw new Error('Invalid member access assignment format');
          }
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

        // Handle type conversion if needed (e.g., i32 to double)
        // Check if we're returning i32 from a double function
        if (this.currentFunctionReturnType === 'double') {
          const valueType = this.getVariableType(lastValue);
          // Only convert if we explicitly know it's i32
          if (valueType === 'i32') {
            const converted = this.nextTemp();
            this.emit(`${converted} = sitofp i32 ${lastValue} to double`);
            lastValue = converted;
          }
        }

        this.emit(`ret ${this.currentFunctionReturnType} ${lastValue}`);
        hasTerminator = true;  // return generates 'ret', which is a terminator
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
    // Delegate to ExpressionGenerator for extracted types
    // (literals, variables, binary, unary, call, index_access, member_access, arrow_function)
    if (expr.type === 'number' || expr.type === 'boolean' || expr.type === 'string' ||
        (expr as any).type === 'regex' || expr.type === 'array' || (expr as any).type === 'object' ||
        (expr as any).type === 'map' || (expr as any).type === 'set' || (expr as any).type === 'new' ||
        (expr as any).type === 'this' || expr.type === 'variable' ||
        expr.type === 'binary' || expr.type === 'unary' || expr.type === 'call' ||
        expr.type === 'index_access' || expr.type === 'member_access' ||
        (expr as any).type === 'arrow_function') {
      return this.exprGen.generate(expr, params);
    }


    if (expr.type === 'method_call') {
      return this.generateMethodCall(expr, params);
    }

    if ((expr as any).type === 'conditional') {
      const conditionalExpr = expr as any;

      // Generate unique labels
      const trueLabel = this.nextLabel('cond_true');
      const falseLabel = this.nextLabel('cond_false');
      const mergeLabel = this.nextLabel('cond_merge');

      // Evaluate condition
      const condValue = this.generateExpression(conditionalExpr.condition, params);

      // Convert to boolean for branching
      const condValueType = this.getVariableType(condValue);
      let condBool: string;

      if (condValueType === 'double' || (condValue.includes('.') && !condValue.startsWith('%'))) {
        // Value is double, use fcmp directly
        condBool = this.nextTemp();
        this.emit(`${condBool} = fcmp one double ${condValue}, 0.0`);
      } else {
        // Value is i32, convert to double first
        const condDouble = this.nextTemp();
        this.emit(`${condDouble} = sitofp i32 ${condValue} to double`);
        condBool = this.nextTemp();
        this.emit(`${condBool} = fcmp one double ${condDouble}, 0.0`);
      }

      // Branch based on condition
      this.emit(`br i1 ${condBool}, label %${trueLabel}, label %${falseLabel}`);

      // True branch
      this.emit(`${trueLabel}:`);
      const trueValue = this.generateExpression(conditionalExpr.consequent, params);
      // Track where we are after generating consequent (might have jumped to other blocks)
      const trueLabelEnd = this.getCurrentLabel();
      this.emit(`br label %${mergeLabel}`);

      // False branch
      this.emit(`${falseLabel}:`);
      const falseValue = this.generateExpression(conditionalExpr.alternate, params);
      // Track where we are after generating alternate (might have jumped to other blocks)
      const falseLabelEnd = this.getCurrentLabel();
      this.emit(`br label %${mergeLabel}`);

      // Merge point with phi node
      this.emit(`${mergeLabel}:`);
      const result = this.nextTemp();

      // Determine the result type - use double if either value is double
      const trueType = this.getVariableType(trueValue);
      const falseType = this.getVariableType(falseValue);
      const resultType = (trueType === 'double' || falseType === 'double') ? 'double' : 'i32';

      // Convert values to match result type if needed
      let trueVal = trueValue;
      let falseVal = falseValue;

      if (resultType === 'double') {
        // Convert i32 values to double
        if (trueType === 'i32') {
          trueVal = this.nextTemp();
          this.emit(`${trueVal} = sitofp i32 ${trueValue} to double`);
        }
        if (falseType === 'i32') {
          falseVal = this.nextTemp();
          this.emit(`${falseVal} = sitofp i32 ${falseValue} to double`);
        }
      }

      this.emit(`${result} = phi ${resultType} [ ${trueVal}, %${trueLabelEnd} ], [ ${falseVal}, %${falseLabelEnd} ]`);
      this.variableTypes.set(result, resultType);

      return result;
    }

    if ((expr as any).type === 'template_literal') {
      const templateExpr = expr as any;

      // Convert template literal to series of string concatenations
      // parts array contains strings and expressions interspersed
      if (templateExpr.parts.length === 0) {
        // Empty template literal
        this.syncStateToGenerators();
        return this.stringGen.createStringConstant('');
      }

      if (templateExpr.parts.length === 1 && typeof templateExpr.parts[0] === 'string') {
        // Simple string with no interpolation
        this.syncStateToGenerators();
        return this.stringGen.createStringConstant(templateExpr.parts[0]);
      }

      // Build result by concatenating parts
      this.syncStateToGenerators();
      let result: string | null = null;

      for (const part of templateExpr.parts) {
        let partValue: string;

        if (typeof part === 'string') {
          // String literal part
          partValue = this.stringGen.createStringConstant(part);
        } else {
          // Expression part - need to convert to string
          // For now, we only support expressions that are already strings
          // TODO: Add number-to-string conversion
          partValue = this.generateExpression(part, params);
        }

        if (result === null) {
          result = partValue;
        } else {
          // Concatenate with previous result
          result = this.stringGen.generateStringConcatDirect(result, partValue);
        }
      }

      return result!;
    }

    throw new Error(`Unknown expression type: ${(expr as any).type}`);
  }

  /**
   * Generates LLVM IR for method calls (array/string/object methods).
   * Dispatches to specialized generators based on method name.
   *
   * @example
   * // Array method: arr.map(x => x * 2)
   * Input: { type: 'method_call', method: 'map', object: { type: 'variable', name: 'arr' }, args: [...] }
   * Output: (delegated to ArrayGenerator, returns new %Array* pointer)
   *
   * @example
   * // String method: str.substring(0, 5)
   * Input: { type: 'method_call', method: 'substring', object: { type: 'variable', name: 'str' }, args: [...] }
   * Output: (delegated to StringGenerator, returns i8* pointer to new string)
   *
   * @example
   * // Console method: console.log("hello")
   * Input: { type: 'method_call', method: 'log', object: { type: 'variable', name: 'console' }, args: [...] }
   * Output: (calls to printf, returns 0.0)
   *
   * @param expr - Method call AST node
   * @param params - Function parameters for variable resolution
   * @returns LLVM register containing method return value
   */
  private generateMethodCall(expr: MethodCallNode, params: string[]): string {
    const method = expr.method;

    // Handle console.log and console.error (delegated to ConsoleGenerator)
    if (this.consoleGen.canHandle(expr)) {
      return this.consoleGen.generateConsoleCall(expr.method, expr.args, params);
    }

    // Handle process.exit() (delegated to ProcessGenerator)
    if (this.processGen.canHandle(expr)) {
      return this.processGen.generateProcessExit(expr, params);
    }

    // Handle fs.* methods (delegated to FilesystemGenerator)
    if (this.fsGen.canHandle(expr)) {
      switch (expr.method) {
        case 'readFileSync':
          return this.fsGen.generateReadFileSync(expr, params);
        case 'writeFileSync':
          return this.fsGen.generateWriteFileSync(expr, params);
        case 'existsSync':
          return this.fsGen.generateExistsSync(expr, params);
        case 'unlinkSync':
          return this.fsGen.generateUnlinkSync(expr, params);
        default:
          throw new Error(`Unsupported fs method: ${expr.method}`);
      }
    }


    // Handle path.resolve() and path.dirname() (delegated to PathGenerator)
    if (method === 'resolve' && expr.object.type === 'variable' && (expr.object as any).name === 'path') {
      return this.pathGen.generateResolve(expr, params);
    }
    if (method === 'dirname' && expr.object.type === 'variable' && (expr.object as any).name === 'path') {
      return this.pathGen.generateDirname(expr, params);
    }


    // Handle execSync() from child_process
    if (method === 'execSync' && expr.object.type === 'variable' &&
        ((expr.object as any).name === 'child_process' || (expr.object as any).name === 'cp')) {
      if (expr.args.length < 1) {
        throw new Error('execSync() requires 1 argument (command)');
      }

      this.syncStateToGenerators();

      // Get command argument
      const commandPtr = this.generateExpression(expr.args[0], params);

      // Call system: system(command) returns exit code
      const result = this.nextTemp();
      this.emit(`${result} = call i32 @system(i8* ${commandPtr})`);

      return result;
    }

    // Handle JSON.parse() and JSON.stringify() (delegated to JsonGenerator)
    if (this.jsonGen.canHandle(expr)) {
      if (method === 'parse') {
        return this.jsonGen.generateParse(expr, params);
      } else if (method === 'stringify') {
        return this.jsonGen.generateStringify(expr, params);
      }
    }

    // Handle Math.* methods (delegated to MathGenerator)
    if (this.mathGen.canHandle(expr)) {
      return this.mathGen.generateMathMethod(expr, params);
    }

    // Handle JSON.stringify()
    if (method === 'stringify' && expr.object.type === 'variable' && (expr.object as any).name === 'JSON') {
      if (expr.args.length < 1) {
        throw new Error('JSON.stringify() requires 1 argument');
      }

      this.syncStateToGenerators();

      const arg = expr.args[0];

      // Check if it's a string
      if (this.isStringExpression(arg)) {
        const strPtr = this.generateExpression(arg, params);

        // For strings, we need to add quotes: "value"
        // Calculate: 2 (quotes) + strlen + 1 (null) = strlen + 3
        const strLen = this.nextTemp();
        this.emit(`${strLen} = call i64 @strlen(i8* ${strPtr})`);
        const bufferSize = this.nextTemp();
        this.emit(`${bufferSize} = add i64 ${strLen}, 3`);
        const buffer = this.nextTemp();
        this.emit(`${buffer} = call i8* @malloc(i64 ${bufferSize})`);

        // Create format string: "\"%s\""
        const formatStr = this.stringGen.createStringConstant('"%s"');
        const sprintfResult = this.nextTemp();
        this.emit(`${sprintfResult} = call i32 (i8*, i8*, ...) @sprintf(i8* ${buffer}, i8* ${formatStr}, i8* ${strPtr})`);

        return buffer;
      } else {
        // For numbers, convert to string
        const numValue = this.generateExpression(arg, params);

        // Allocate buffer for number string (30 chars should be enough for double)
        const buffer = this.nextTemp();
        this.emit(`${buffer} = call i8* @malloc(i64 30)`);

        // Create format string: "%f"
        const formatStr = this.stringGen.createStringConstant('%f');
        const sprintfResult = this.nextTemp();
        this.emit(`${sprintfResult} = call i32 (i8*, i8*, ...) @sprintf(i8* ${buffer}, i8* ${formatStr}, double ${numValue})`);

        return buffer;
      }
    }

    // Handle regex methods
    if (method === 'test') {
      // Check if the object is a regex (literal or variable)
      const isRegex = this.isRegexExpression(expr.object);
      if (isRegex) {
        this.syncStateToGenerators();
        const regexPtr = this.generateExpression(expr.object, params);

        if (expr.args.length !== 1) {
          throw new Error(`test() expects 1 argument, got ${expr.args.length}`);
        }

        const testStr = this.generateExpression(expr.args[0], params);
        return this.regexGen.generateRegexTest(regexPtr, testStr);
      }
    }

    // Handle string methods
    if (method === 'substr') {
      // Assume any .substr() call is on a string (LLVM will catch type errors)
      this.syncStateToGenerators();
      const strPtr = this.generateExpression(expr.object, params);

      // substr() takes 1 or 2 arguments: start and optional length
      if (expr.args.length < 1 || expr.args.length > 2) {
        throw new Error(`substr() expects 1 or 2 arguments, got ${expr.args.length}`);
      }

      const startIndexDouble = this.generateExpression(expr.args[0], params);
      const startIndex = this.convertToI32(startIndexDouble);
      const length = expr.args.length === 2 ? this.convertToI32(this.generateExpression(expr.args[1], params)) : null;

      return this.stringGen.generateSubstr(strPtr, startIndex, length);
    }

    if (method === 'substring') {
      // Assume any .substring() call is on a string (LLVM will catch type errors)
      this.syncStateToGenerators();
      const strPtr = this.generateExpression(expr.object, params);

      // substring() takes 1 or 2 arguments: start and optional end
      if (expr.args.length < 1 || expr.args.length > 2) {
        throw new Error(`substring() expects 1 or 2 arguments, got ${expr.args.length}`);
      }

      const startIndexDouble = this.generateExpression(expr.args[0], params);
      const startIndex = this.convertToI32(startIndexDouble);

      // If end is provided, calculate length = end - start
      // Otherwise, length is null (to end of string)
      let length: string | null = null;
      if (expr.args.length === 2) {
        const endIndexDouble = this.generateExpression(expr.args[1], params);
        const endIndex = this.convertToI32(endIndexDouble);
        length = this.nextTemp();
        this.emit(`${length} = sub i32 ${endIndex}, ${startIndex}`);
      }

      return this.stringGen.generateSubstr(strPtr, startIndex, length);
    }

    if (method === 'concat') {
      // Assume any .concat() call is on a string
      this.syncStateToGenerators();
      const strPtr = this.generateExpression(expr.object, params);

      // concat() can take multiple arguments, concatenate them all
      if (expr.args.length < 1) {
        throw new Error(`concat() expects at least 1 argument, got ${expr.args.length}`);
      }

      // Start with the base string
      let result = strPtr;

      // Concatenate each argument in sequence
      for (const arg of expr.args) {
        const argStr = this.generateExpression(arg, params);
        result = this.stringGen.generateStringConcatDirect(result, argStr);
      }

      return result;
    }

    if (method === 'repeat') {
      // Assume any .repeat() call is on a string
      this.syncStateToGenerators();
      const strPtr = this.generateExpression(expr.object, params);

      // repeat() takes 1 argument: count
      if (expr.args.length !== 1) {
        throw new Error(`repeat() expects 1 argument, got ${expr.args.length}`);
      }

      const countDouble = this.generateExpression(expr.args[0], params);
      const count = this.convertToI32(countDouble);
      return this.stringGen.generateRepeat(strPtr, count);
    }

    if (method === 'padStart') {
      // Assume any .padStart() call is on a string
      this.syncStateToGenerators();
      const strPtr = this.generateExpression(expr.object, params);

      // padStart() takes 1 or 2 arguments: targetLength and optional padString
      if (expr.args.length < 1 || expr.args.length > 2) {
        throw new Error(`padStart() expects 1 or 2 arguments, got ${expr.args.length}`);
      }

      const targetLengthDouble = this.generateExpression(expr.args[0], params);
      const targetLength = this.convertToI32(targetLengthDouble);
      const padString = expr.args.length === 2
        ? this.generateExpression(expr.args[1], params)
        : this.stringGen.createStringConstant(' '); // Default to space

      return this.stringGen.generatePadStart(strPtr, targetLength, padString);
    }

    if (method === 'split') {
      // Assume any .split() call is on a string (LLVM will catch type errors)
      this.syncStateToGenerators();
      const strPtr = this.generateExpression(expr.object, params);

      // split() takes 1 argument: delimiter
      if (expr.args.length !== 1) {
        throw new Error(`split() expects 1 argument, got ${expr.args.length}`);
      }

      const delimiter = this.generateExpression(expr.args[0], params);
      return this.stringGen.generateSplit(strPtr, delimiter);
    }

    if (method === 'startsWith') {
      this.syncStateToGenerators();
      const strPtr = this.generateExpression(expr.object, params);

      if (expr.args.length !== 1) {
        throw new Error(`startsWith() expects 1 argument, got ${expr.args.length}`);
      }

      const prefix = this.generateExpression(expr.args[0], params);
      return this.stringGen.generateStartsWith(strPtr, prefix);
    }

    if (method === 'trim') {
      this.syncStateToGenerators();
      const strPtr = this.generateExpression(expr.object, params);

      if (expr.args.length !== 0) {
        throw new Error(`trim() expects 0 arguments, got ${expr.args.length}`);
      }

      return this.stringGen.generateTrim(strPtr);
    }

    if (method === 'indexOf') {
      this.syncStateToGenerators();
      const strPtr = this.generateExpression(expr.object, params);

      if (expr.args.length !== 1) {
        throw new Error(`indexOf() expects 1 argument, got ${expr.args.length}`);
      }

      const substring = this.generateExpression(expr.args[0], params);
      return this.stringGen.generateIndexOf(strPtr, substring);
    }

    if (method === 'includes' && !this.isArrayExpression(expr.object) && !this.isStringArrayExpression(expr.object)) {
      // string.includes() - only if not an array
      this.syncStateToGenerators();
      const strPtr = this.generateExpression(expr.object, params);

      if (expr.args.length !== 1) {
        throw new Error(`includes() expects 1 argument, got ${expr.args.length}`);
      }

      const substring = this.generateExpression(expr.args[0], params);
      return this.stringGen.generateIncludes(strPtr, substring);
    }

    if (method === 'slice') {
      this.syncStateToGenerators();
      const strPtr = this.generateExpression(expr.object, params);

      if (expr.args.length < 1 || expr.args.length > 2) {
        throw new Error(`slice() expects 1 or 2 arguments, got ${expr.args.length}`);
      }

      const startDouble = this.generateExpression(expr.args[0], params);
      const startI32 = this.nextTemp();
      this.emit(`${startI32} = fptosi double ${startDouble} to i32`);

      let endI32: string | null = null;
      if (expr.args.length === 2) {
        const endDouble = this.generateExpression(expr.args[1], params);
        endI32 = this.nextTemp();
        this.emit(`${endI32} = fptosi double ${endDouble} to i32`);
      }

      return this.stringGen.generateSlice(strPtr, startI32, endI32);
    }

    if (method === 'charAt') {
      // Assume any .charAt() call is on a string
      this.syncStateToGenerators();
      const strPtr = this.generateExpression(expr.object, params);

      // charAt() takes 1 argument: index
      if (expr.args.length !== 1) {
        throw new Error(`charAt() expects 1 argument, got ${expr.args.length}`);
      }

      const index = this.generateExpression(expr.args[0], params);
      return this.stringGen.generateCharAt(strPtr, index);
    }

    // Handle Map methods
    if (method === 'set' || method === 'get' || method === 'has') {
      // Check if the object is a Map
      if (expr.object.type === 'variable' && this.symbolTable.isMap(expr.object.name)) {
        this.syncStateToGenerators();
        if (method === 'set') {
          return this.mapGen.generateMapSet(expr, params, this.generateExpression.bind(this));
        } else if (method === 'get') {
          return this.mapGen.generateMapGet(expr, params, this.generateExpression.bind(this));
        } else {
          return this.mapGen.generateMapHas(expr, params, this.generateExpression.bind(this));
        }
      }
    }

    // Handle Set methods
    if (method === 'add' || method === 'has' || method === 'delete') {
      // Check if the object is a Set
      if (expr.object.type === 'variable' && this.symbolTable.isSet(expr.object.name)) {
        this.syncStateToGenerators();
        if (method === 'add') {
          return this.setGen.generateSetAdd(expr, params, this.generateExpression.bind(this));
        } else if (method === 'has') {
          return this.setGen.generateSetHas(expr, params, this.generateExpression.bind(this));
        } else {
          return this.setGen.generateSetDelete(expr, params, this.generateExpression.bind(this));
        }
      }
    }

    // Handle array methods (arrayGen uses context pattern - no sync needed! 🎯)
    if (method === 'push') {
      return this.arrayGen.generateArrayPush(expr, params, this.generateExpression.bind(this));
    } else if (method === 'pop') {
      return this.arrayGen.generateArrayPop(expr, params, this.generateExpression.bind(this));
    } else if (method === 'includes' && this.isArrayExpression(expr.object)) {
      // array.includes() - check for array first to avoid conflict with string.includes()
      return this.arrayGen.generateArrayIncludes(expr, params, this.generateExpression.bind(this));
    } else if (method === 'map') {
      return this.arrayGen.generateArrayMap(expr, params, this.generateExpression.bind(this));
    } else if (method === 'join') {
      return this.arrayGen.generateArrayJoin(expr, params, this.generateExpression.bind(this));
    } else if (method === 'find') {
      return this.arrayGen.generateArrayFind(expr, params, this.generateExpression.bind(this));
    } else if (method === 'some') {
      return this.arrayGen.generateArraySome(expr, params, this.generateExpression.bind(this));
    } else if (method === 'filter') {
      return this.arrayGen.generateArrayFilter(expr, params, this.generateExpression.bind(this));
    } else if (method === 'forEach') {
      return this.arrayGen.generateArrayForEach(expr, params, this.generateExpression.bind(this));
    }

    // Handle class instance methods
    let className: string | null = null;
    let instancePtr: string | null = null;

    if (expr.object.type === 'variable' && this.symbolTable.isClass(expr.object.name)) {
      const classMeta = this.symbolTable.getClassInfo(expr.object.name)!;
      className = classMeta.className;
      instancePtr = this.generateExpression(expr.object, params);
    } else if ((expr.object as any).type === 'new') {
      const newExpr = expr.object as any as NewNode;
      className = newExpr.className;
      instancePtr = this.generateExpression(expr.object, params);
    } else if ((expr.object as any).type === 'this') {
      // Method call on 'this' - need to find the class context
      if (!this.thisPointer) {
        throw new Error('this.method() called outside of class method');
      }
      instancePtr = this.thisPointer;
      // Find the class that contains the current method - we'll need to track this
      // For now, we'll search for a class with this method
      const classWithMethod = this.ast.classes.find(c =>
        c.methods.some(m => m.name === method && !m.isConstructor)
      );
      if (!classWithMethod) {
        throw new Error(`Method ${method} not found in any class`);
      }
      className = classWithMethod.name;
    } else if ((expr.object as any).type === 'super') {
      // Method call on 'super' - need to find the parent class
      if (!this.thisPointer) {
        throw new Error('super.method() called outside of class method');
      }
      if (!this.currentClassName) {
        throw new Error('super.method() called outside of class context');
      }
      const currentClass = this.ast.classes.find(c => c.name === this.currentClassName);
      if (!currentClass || !currentClass.extends) {
        throw new Error(`super.method() called but current class ${this.currentClassName} has no parent class`);
      }
      instancePtr = this.thisPointer;
      className = currentClass.extends; // Use the parent class name

      // Check if this is a super() constructor call (empty method name)
      if (method === '') {
        // For now, treat super() as a no-op since we don't support parent constructor calls yet
        // Return 0 as a placeholder
        return '0';
      }
    }

    if (className && instancePtr) {
      // Check if the class has this method
      const classNode = this.ast.classes.find(c => c.name === className);
      if (!classNode) {
        throw new Error(`Class ${className} not found`);
      }
      const methodExists = classNode.methods.some(m => m.name === method && !m.isConstructor);
      if (!methodExists) {
        throw new Error(`Method ${method} not found in class ${className}`);
      }

      this.syncStateToGenerators();
      return this.classGen.generateMethodCall(instancePtr, className, method, expr.args, params);
    }

    // Handle object methods
    // Check if the object is an object (variable or literal) and has the method property
    let isObjectMethod = false;
    if (expr.object.type === 'variable' && this.symbolTable.isObject(expr.object.name)) {
      const objMeta = this.symbolTable.getObjectInfo(expr.object.name);
      isObjectMethod = objMeta !== undefined && objMeta.keys.includes(method);
    } else if ((expr.object as any).type === 'object') {
      const objExpr = expr.object as any;
      isObjectMethod = objExpr.properties.some((p: any) => p.key === method);
    }

    if (isObjectMethod) {
      // For object methods, we call the function with the same name as the method
      // This is a simplified implementation - in a full implementation, we'd store function references
      const funcExists = this.ast.functions.some(f => f.name === method);
      if (!funcExists) {
        throw new Error(`Function ${method} not found for object method call`);
      }

      // Get function type from type checker for correct parameter/return types
      let returnType = 'double';
      let paramTypes: string[] = [];

      if (this.typeChecker) {
        try {
          const funcType = this.typeChecker.getFunctionType(method);
          if (funcType) {
            returnType = funcType.returnType === 'string' ? 'i8*' : 'double';
            paramTypes = funcType.parameters.map(p => p.type === 'string' ? 'i8*' : 'double');
          }
        } catch (e) {
          // Fall back to double
        }
      }

      // Generate arguments
      const args = expr.args.map((arg, i) => {
        const result = this.generateExpression(arg, params);
        const paramType = paramTypes[i] || 'double';
        return `${paramType} ${result}`;
      }).join(', ');

      const temp = this.nextTemp();
      this.emit(`${temp} = call ${returnType} @${method}(${args})`);
      return temp;
    }

    // Handle Response methods (from fetch())
    if (method === 'text' || method === 'json') {
      this.syncStateToGenerators();
      const responsePtr = this.generateExpression(expr.object, params);

      if (method === 'text') {
        return this.responseGen.generateText(responsePtr);
      } else { // json
        // Check for typed JSON parsing with generics: .json<TypeName>()
        if ((expr as any).typeParameter && this.typeChecker) {
          const typeName = (expr as any).typeParameter;
          const interfaceDef = this.typeChecker.getInterfaceDefinition(typeName);
          if (interfaceDef) {
            return this.responseGen.generateTypedJson(responsePtr, typeName, interfaceDef);
          }
        }
        // Fall back to untyped JSON parsing
        return this.responseGen.generateJson(responsePtr);
      }
    }

    // Build a helpful error message with supported methods
    const stringMethods = [
      'charAt', 'concat', 'padStart', 'repeat', 'split', 'startsWith', 'substring', 'substr'
    ];
    const arrayMethods = [
      'push', 'map', 'join', 'find', 'some', 'filter', 'forEach'
    ];
    const mapMethods = [
      'set', 'get', 'has'
    ];
    const setMethods = [
      'add', 'has', 'delete'
    ];
    const otherMethods = [
      'console.log', 'console.error',
      'process.exit', 'process.argv',
      'fs.readFileSync', 'fs.writeFileSync', 'fs.existsSync', 'fs.unlinkSync',
      'path.resolve', 'path.dirname',
      'child_process.execSync',
      'JSON.parse', 'JSON.stringify',
      'regex.test'
    ];

    const suggestion =
      `\x1b[33mSupported methods:\x1b[0m\n\n` +
      `\x1b[36mString methods:\x1b[0m\n  ${stringMethods.join(', ')}\n\n` +
      `\x1b[36mArray methods:\x1b[0m\n  ${arrayMethods.join(', ')}\n\n` +
      `\x1b[36mMap methods:\x1b[0m\n  ${mapMethods.join(', ')}\n\n` +
      `\x1b[36mSet methods:\x1b[0m\n  ${setMethods.join(', ')}\n\n` +
      `\x1b[36mOther built-in methods:\x1b[0m\n  ${otherMethods.join(', ')}\n\n` +
      `\x1b[33mIf you need '${method}', consider:\x1b[0m\n` +
      `  • Using a similar method from the list above\n` +
      `  • Implementing it using supported operations\n` +
      `  • Opening an issue: https://github.com/your-repo/issues`;

    throw new Error(this.formatCodegenError(
      `Method '${method}' is not supported yet.`,
      suggestion
    ));
  }


  public isArrayExpression(expr: Expression): boolean {
    if (expr.type === 'array') {
      return true;
    }
    if (expr.type === 'variable') {
      // Check both arrayVariables (legacy) and variableTypes (new system)
      if (this.symbolTable.isNumberArray(expr.name)) {
        return true;
      }
      const varType = this.getVariableType(expr.name);
      if (varType === '%Array*') {
        return true;
      }
      return false;
    }
    // Check if it's a method call that returns an array (e.g., .filter(), .map())
    if (expr.type === 'method_call') {
      const method = (expr as any).method;
      return method === 'filter' || method === 'map'; // filter() and map() return new arrays
    }
    // Check if it's a member access to a numeric/boolean array field
    if (expr.type === 'member_access') {
      const memberExpr = expr as any;
      if (memberExpr.object.type === 'variable' && this.symbolTable.isClass(memberExpr.object.name)) {
        const classMeta = this.symbolTable.getClassInfo(memberExpr.object.name)!;
        const fieldInfo = this.classGen.getFieldInfo(classMeta.className, memberExpr.property);
        if (fieldInfo && (fieldInfo.type === 'number[]' || fieldInfo.type === 'boolean[]')) {
          return true;
        }
      }
      // Check for this.field access
      if ((memberExpr.object as any).type === 'this') {
        // Find current class
        const classNode = this.ast.classes.find(c => true); // Simplified
        if (classNode) {
          const fieldInfo = this.classGen.getFieldInfo(classNode.name, memberExpr.property);
          if (fieldInfo && (fieldInfo.type === 'number[]' || fieldInfo.type === 'boolean[]')) {
            return true;
          }
        }
      }
    }
    return false;
  }

  public isObjectExpression(expr: Expression): boolean {
    if ((expr as any).type === 'object') {
      return true;
    }
    if (expr.type === 'variable') {
      return this.symbolTable.isObject(expr.name);
    }
    return false;
  }

  private isMapExpression(expr: Expression): boolean {
    if ((expr as any).type === 'map') {
      return true;
    }
    if (expr.type === 'variable') {
      return this.symbolTable.isMap(expr.name);
    }
    return false;
  }

  private isSetExpression(expr: Expression): boolean {
    if ((expr as any).type === 'set') {
      return true;
    }
    if (expr.type === 'variable') {
      return this.symbolTable.isSet(expr.name);
    }
    return false;
  }

  public isStringExpression(expr: Expression): boolean {
    if (expr.type === 'string') {
      return true;
    }
    if ((expr as any).type === 'template_literal') {
      return true;
    }
    if (expr.type === 'variable') {
      // Check variable type in SymbolTable
      const varType = this.getVariableType(expr.name);
      if (varType === 'i8*') {
        return true;
      }
      return false;
    }
    if (expr.type === 'binary' && expr.op === '+') {
      return this.isStringExpression(expr.left) || this.isStringExpression(expr.right);
    }
    // Check if it's a member access on an object with TypeScript types
    if (expr.type === 'member_access') {
      const memberExpr = expr as any;
      // Check if it's accessing a string property
      if (memberExpr.object.type === 'variable') {
        const varName = memberExpr.object.name;
        // Check object variables with tracked types
        const objMeta = this.symbolTable.getObjectInfo(varName);
        if (objMeta) {
          const propIndex = objMeta.keys.indexOf(memberExpr.property);
          if (propIndex >= 0 && objMeta.types[propIndex] === 'i8*') {
            return true;
          }
        }
        // Check typed JSON struct properties (from .json<T>())
        const varType = this.getVariableType(varName);
        if (varType && varType.startsWith('%') && varType.endsWith('*') &&
            !varType.includes('Array') && !varType.includes('Response') &&
            !varType.includes('Map') && !varType.includes('Set')) {
          const structTypeName = varType.substring(1, varType.length - 1);
          if (this.typeChecker) {
            const interfaceDef = this.typeChecker.getInterfaceDefinition(structTypeName);
            if (interfaceDef) {
              const prop = interfaceDef.properties.find((p: any) => p.name === memberExpr.property);
              if (prop && prop.type === 'string') {
                return true;
              }
            }
          }
        }
        // Check class instances
        if (this.symbolTable.isClass(varName)) {
          const classMeta = this.symbolTable.getClassInfo(varName)!;
          const fieldInfo = this.classGen.getFieldInfo(classMeta.className, memberExpr.property);
          if (fieldInfo && fieldInfo.type === 'string') {
            return true;
          }
        }
        // Check TypeScript types for function parameters
        if (this.typeChecker && this.currentFunction && this.getVariableAlloca(varName) !== undefined) {
          const typeInfo = this.typeChecker.getPropertyType(varName, memberExpr.property, this.currentFunction);
          if (typeInfo && typeInfo.llvmType === 'i8*') {
            return true;
          }
        }
      }
      // Check for this.field access to string fields
      if (memberExpr.object.type === 'this') {
        // Check both this instance's currentClassName and the classGen's
        const className = this.currentClassName || (this.classGen as any).currentClassName;
        if (className) {
          const fieldInfo = this.classGen.getFieldInfo(className, memberExpr.property);
          if (fieldInfo && fieldInfo.type === 'string') {
            return true;
          }
        }
      }
    }
    // Check if it's process.argv[i] or stringArray[i]
    if (expr.type === 'index_access') {
      const indexExpr = expr as any;
      // Check for process.argv[i]
      if (indexExpr.object.type === 'member_access') {
        const memberAccess = indexExpr.object;
        if (memberAccess.object.type === 'variable' &&
            memberAccess.object.name === 'process' &&
            memberAccess.property === 'argv') {
          return true;
        }
      }
      // Check for stringArray[i]
      if (indexExpr.object.type === 'variable') {
        const varName = indexExpr.object.name;
        // Check variable type in SymbolTable
        const varType = this.getVariableType(varName);
        if (varType === '%StringArray*') {
          return true;
        }
      }
      // Check for this.field[i] where field is a string array
      if (indexExpr.object.type === 'member_access') {
        const memberAccess = indexExpr.object;
        if (memberAccess.object.type === 'variable' && memberAccess.object.name === 'this') {
          // Check if this field is a string array in the current class
          const className = this.currentClassName || (this.classGen as any).currentClassName;
          if (className) {
            const fieldInfo = this.classGen.getFieldInfo(className, memberAccess.property);
            if (fieldInfo && fieldInfo.type === 'string[]') {
              return true;
            }
          }
        }
      }
    }
    // Check if it's a function call that returns a string
    if (expr.type === 'call') {
      const funcExpr = expr as any;
      // String() constructor returns a string
      if (funcExpr.name === 'String') {
        return true;
      }
    }
    // Check if it's a method call that returns a string
    if (expr.type === 'method_call') {
      const methodExpr = expr as any as MethodCallNode;
      // fs.readFileSync returns a string
      if (methodExpr.object.type === 'variable' &&
          (methodExpr.object as any).name === 'fs' &&
          methodExpr.method === 'readFileSync') {
        return true;
      }
      // path methods that return strings
      if (methodExpr.object.type === 'variable' &&
          (methodExpr.object as any).name === 'path' &&
          (methodExpr.method === 'resolve' || methodExpr.method === 'dirname')) {
        return true;
      }
      // JSON.stringify returns a string
      if (methodExpr.object.type === 'variable' &&
          (methodExpr.object as any).name === 'JSON' &&
          methodExpr.method === 'stringify') {
        return true;
      }
      // String methods that return strings
      if (methodExpr.method === 'substr' || methodExpr.method === 'substring' ||
          methodExpr.method === 'concat' || methodExpr.method === 'repeat' ||
          methodExpr.method === 'padStart' || methodExpr.method === 'charAt' ||
          methodExpr.method === 'trim' || methodExpr.method === 'slice' ||
          methodExpr.method === 'text') {  // 🎓 Response.text() returns string
        return true;
      }
      // Check class instance method return types
      if (methodExpr.object.type === 'variable' && this.symbolTable.isClass(methodExpr.object.name)) {
        const classMeta = this.symbolTable.getClassInfo(methodExpr.object.name)!;
        const classNode = this.ast.classes.find(c => c.name === classMeta.className);
        if (classNode) {
          const method = classNode.methods.find(m => m.name === methodExpr.method && !m.isConstructor);
          if (method && method.returnType === 'string') {
            return true;
          }
        }
      }
    }
    return false;
  }

  private isRegexExpression(expr: Expression): boolean {
    if ((expr as any).type === 'regex') {
      return true;
    }
    if (expr.type === 'variable') {
      return this.symbolTable.isRegex(expr.name);
    }
    return false;
  }

  private isClassInstanceExpression(expr: Expression): boolean {
    if ((expr as any).type === 'new') {
      return true;
    }
    if (expr.type === 'variable') {
      return this.symbolTable.isClass(expr.name);
    }
    return false;
  }

  /**
   * Check if an expression returns a Response object (from fetch())
   */
  private isResponseExpression(expr: Expression): boolean {
    // fetch() returns Response*
    if (expr.type === 'call' && expr.name === 'fetch') {
      return true;
    }
    // Variables that hold Response objects
    if (expr.type === 'variable') {
      const varType = this.getVariableType(expr.name);
      if (varType === '%Response*') {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if an expression returns a typed JSON struct (from .json<T>())
   * Returns the interface name if it's a typed JSON call, null otherwise
   */
  private getTypedJsonInterface(expr: any): string | null {
    // Check for .json<T>() method call
    if (expr.type === 'method_call' && expr.method === 'json' && expr.typeParameter) {
      return expr.typeParameter;
    }
    return null;
  }

  private isJSONParseExpression(expr: Expression): boolean {
    // Check if this is a JSON.parse() call
    if (expr.type === 'method_call') {
      const methodCall = expr as any;
      return methodCall.method === 'parse' &&
             methodCall.object.type === 'variable' &&
             methodCall.object.name === 'JSON';
    }
    if (expr.type === 'variable') {
      return this.symbolTable.isJSON(expr.name);
    }
    return false;
  }

  public isStringArrayExpression(expr: Expression): boolean {
    if (expr.type === 'variable') {
      // Check variable type in SymbolTable
      const varType = this.getVariableType(expr.name);
      if (varType === '%StringArray*') {
        return true;
      }
      return false;
    }
    // Check if it's an array literal with all string elements
    if (expr.type === 'array') {
      const elements = (expr as any).elements || [];

      // For empty arrays, use expectedArrayElementType (set from declaredType)
      if (elements.length === 0 && this.expectedArrayElementType === 'string') {
        return true;
      }

      return elements.length > 0 && elements.every((elem: Expression) => elem.type === 'string');
    }
    // Check if it's a method call that returns a StringArray (e.g., .split())
    if (expr.type === 'method_call') {
      const method = (expr as any).method;
      return method === 'split';
    }
    // Check if it's a member access to a string array field
    if (expr.type === 'member_access') {
      const memberExpr = expr as any;
      if (memberExpr.object.type === 'variable' && this.symbolTable.isClass(memberExpr.object.name)) {
        const classMeta = this.symbolTable.getClassInfo(memberExpr.object.name)!;
        const fieldInfo = this.classGen.getFieldInfo(classMeta.className, memberExpr.property);
        if (fieldInfo && fieldInfo.type === 'string[]') {
          return true;
        }
      }
      // Check for this.field access
      if ((memberExpr.object as any).type === 'this') {
        // Find current class
        const classNode = this.ast.classes.find(c => true); // Simplified
        if (classNode) {
          const fieldInfo = this.classGen.getFieldInfo(classNode.name, memberExpr.property);
          if (fieldInfo && fieldInfo.type === 'string[]') {
            return true;
          }
        }
      }
    }
    return false;
  }

  private generateMain(): string {
    let ir = 'define i32 @main(i32 %argc, i8** %argv) {\n';
    ir += 'entry:\n';

    // Store argc and argv in global variables for process.argv
    ir += '  store i32 %argc, i32* @__argc\n';
    ir += '  store i8** %argv, i8*** @__argv\n';

    this.tempCounter = 0;
    this.output = [];

    // Process top-level variable declarations using the shared allocateVariable method
    for (const stmt of this.ast.topLevelStatements) {
      this.allocateVariable(stmt, []);
    }

    // Save top-level object variables so they can be accessed from functions
    this.topLevelObjectVariables = new Map();
    for (const symbol of this.symbolTable.getAll()) {
      if (symbol.kind === SymbolKind.Object && symbol.scope === 'global' && symbol.objectMetadata) {
        this.topLevelObjectVariables.set(symbol.name, {
          ptr: symbol.allocaRegister,
          keys: symbol.objectMetadata.keys,
          types: symbol.objectMetadata.types
        });
      }
    }

    // Execute all top-level expressions in order
    for (const expr of this.ast.topLevelExpressions) {
      // Handle statement types (if, while, for, etc.)
      if ((expr as any).type === 'if') {
        this.syncStateToGenerators();
        this.controlFlowGen.generateIfStatement(expr as any, []);
      } else if ((expr as any).type === 'while') {
        this.syncStateToGenerators();
        this.controlFlowGen.generateWhileStatement(expr as any, []);
      } else if ((expr as any).type === 'for') {
        this.syncStateToGenerators();
        this.controlFlowGen.generateForStatement(expr as any, []);
      } else if ((expr as any).type === 'for_of') {
        this.syncStateToGenerators();
        this.controlFlowGen.generateForOfStatement(expr as any, []);
      } else {
        // Expression statement
        this.generateExpression(expr, []);
      }
    }

    if (this.output.length > 0) {
      ir += this.output.map(line => '  ' + line).join('\n') + '\n';
    }

    // Always return 0 for success (process.exit() will override this if called)
    ir += '  ret i32 0\n';

    ir += '}\n';

    return ir;
  }

  // Generate HTTP server - creates a TCP server that parses HTTP and calls handler
  private generateHttpServe(expr: any, params: string[]): string {
    if (expr.args.length < 2) {
      throw new Error('httpServe() requires 2 arguments: port and handler function');
    }

    const portValue = this.generateExpression(expr.args[0], params);
    const handlerName = (expr.args[1] as any).name; // Handler function name

    if (!handlerName) {
      throw new Error('httpServe() handler must be a function reference');
    }

    // Call the runtime http_serve function
    const temp = this.nextTemp();
    this.emit(`${temp} = call i32 @http_serve(i32 ${portValue}, i32 (i8*, i8*)* @${handlerName})`);

    return temp;
  }

  // Sync state to sub-generators - share Maps/arrays by reference
  // Note: Counters are already shared via bound methods (nextTemp, nextLabel, nextString)
  // Note: ALL generators now use context pattern - no state syncing needed! 🎉
  private syncStateToGenerators() {
    // No generators left to sync - all use context pattern!
    // This method kept for backward compatibility but is now a no-op
  }
}
