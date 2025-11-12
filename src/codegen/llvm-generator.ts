import { AST, Expression, FunctionNode, BlockStatement, MethodCallNode, NewNode, ThisNode } from '../ast/types.js';
import { BaseGenerator } from './generators/base-generator.js';
import { ArrayGenerator } from './generators/array-generator.js';
import { StringGenerator } from './generators/string-generator.js';
import { ObjectGenerator } from './generators/object-generator.js';
import { MapGenerator } from './generators/map-generator.js';
import { SetGenerator } from './generators/set-generator.js';
import { ControlFlowGenerator } from './generators/control-flow-generator.js';
import { ClassGenerator } from './generators/class-generator.js';
import { RegexGenerator } from './generators/regex-generator.js';
import { TypeChecker } from '../typescript/type-checker.js';
import { logger } from '../utils/logger.js';

// ============================================
// LLVM IR CODE GENERATOR - Main Orchestrator
// ============================================

export class LLVMGenerator extends BaseGenerator {
  private ast: AST;
  private typeChecker: TypeChecker | null;
  private externalFunctions: Set<string> = new Set();
  private liftedFunctions: FunctionNode[] = []; // Anonymous functions lifted to top level
  private anonFuncCounter: number = 0;
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
        llvmType = 'i32';
      }

      types.push(llvmType);
    }

    return { keys, types };
  }

  constructor(ast: AST, typeChecker: TypeChecker | null = null) {
    super();
    this.ast = ast;
    this.typeChecker = typeChecker;

    // Initialize specialized generators
    this.arrayGen = new ArrayGenerator();
    this.stringGen = new StringGenerator();
    this.objectGen = new ObjectGenerator();
    this.mapGen = new MapGenerator();
    this.setGen = new SetGenerator();
    this.controlFlowGen = new ControlFlowGenerator();
    this.classGen = new ClassGenerator();
    this.regexGen = new RegexGenerator();

    // Wire up delegates so sub-generators can call back
    this.arrayGen.generateExpression = this.generateExpression.bind(this);
    this.stringGen.generateExpression = this.generateExpression.bind(this);
    this.objectGen.generateExpression = this.generateExpression.bind(this);
    this.mapGen.generateExpression = this.generateExpression.bind(this);
    this.setGen.generateExpression = this.generateExpression.bind(this);
    this.controlFlowGen.generateExpression = this.generateExpression.bind(this);
    this.controlFlowGen.generateBlock = this.generateBlock.bind(this);
    this.classGen.generateExpression = this.generateExpression.bind(this);
    this.classGen.generateBlock = this.generateBlock.bind(this);
    this.regexGen.generateExpression = this.generateExpression.bind(this);
    // Pass AST to classGen for method lookups
    (this.classGen as any).ast = ast;

    // Override counter methods to use parent's counters
    for (const gen of [this.arrayGen, this.stringGen, this.objectGen, this.mapGen, this.setGen, this.controlFlowGen, this.classGen, this.regexGen]) {
      gen.nextTemp = this.nextTemp.bind(this);
      gen.nextLabel = this.nextLabel.bind(this);
      gen.nextString = this.nextString.bind(this);
      // Also provide a way to reset tempCounter
      const self = this;
      (gen as any).resetTempCounter = function() { self.tempCounter = 0; };
    }

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
      this.objectVariables.set(name, meta);
    });
  }

  generate(): string {
    let ir = '';

    // Define array struct type: { i32* data, i32 length, i32 capacity }
    ir += '%Array = type { i32*, i32, i32 }\n';

    // Define string array struct type: { i8** data, i32 length, i32 capacity }
    ir += '%StringArray = type { i8**, i32, i32 }\n';

    // Define Map struct type: { i32* keys, i32* values, i32 size, i32 capacity }
    ir += '%Map = type { i32*, i32*, i32, i32 }\n';

    // Define Set struct type: { i32* values, i32 size, i32 capacity }
    ir += '%Set = type { i32*, i32, i32 }\n\n';

    // Declare external C functions for string operations
    ir += 'declare i8* @malloc(i64)\n';
    ir += 'declare void @free(i8*)\n';
    ir += 'declare i8* @strcpy(i8*, i8*)\n';
    ir += 'declare i8* @strcat(i8*, i8*)\n';
    ir += 'declare i64 @strlen(i8*)\n';
    ir += 'declare i32 @strcmp(i8*, i8*)\n';
    ir += 'declare i32 @strncmp(i8*, i8*, i64)\n';
    ir += 'declare void @llvm.memcpy.p0i8.p0i8.i64(i8*, i8*, i64, i1)\n';
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
    ir += this.generateFetchRuntime();
    ir += '\n';

    // JSON parsing runtime
    ir += this.generateJSONRuntime();
    ir += '\n';

    // Global variables for process.argv
    ir += '@__argc = global i32 0\n';
    ir += '@__argv = global i8** null\n';
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
    for (const func of this.liftedFunctions) {
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

  private generateFunction(func: FunctionNode): string {
    this.reset();
    this.syncStateToGenerators();
    this.currentFunction = func.name; // Track current function for type checking

    // Determine parameter and return types using TypeChecker
    const paramTypes: string[] = [];
    const paramLLVMTypes: string[] = [];
    let returnType = 'i32';
    let returnTypeIsString = false;

    if (this.typeChecker) {
      try {
        // Get function signature from TypeChecker
        const funcType = this.typeChecker.getFunctionType(func.name);
        if (funcType) {
          // Check return type
          if (funcType.returnType === 'string') {
            returnType = 'i8*';
            returnTypeIsString = true;
          }

          // Check parameter types
          for (let i = 0; i < func.params.length; i++) {
            const paramType = funcType.parameters[i]?.type || 'number';
            paramTypes.push(paramType);
            if (paramType === 'string') {
              paramLLVMTypes.push('i8*');
            } else {
              paramLLVMTypes.push('i32');
            }
          }
        }
      } catch (e) {
        // Type checker failed, fall back to i32
      }
    }

    // Fill in missing parameter types with i32
    while (paramLLVMTypes.length < func.params.length) {
      paramTypes.push('number');
      paramLLVMTypes.push('i32');
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
        this.stringVariables.set(paramName, allocaReg);
        this.emit(`${allocaReg} = alloca i8*`);
        this.emit(`store i8* %arg${i}, i8** ${allocaReg}`);
      } else {
        // Numeric parameter
        this.variables.set(paramName, allocaReg);
        this.emit(`${allocaReg} = alloca i32`);
        this.emit(`store i32 %arg${i}, i32* ${allocaReg}`);
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
      // If block returned a value, use it; otherwise return default
      if (result !== null) {
        ir += `  ret ${returnType} ${result}\n`;
      } else {
        if (returnTypeIsString) {
          // Return empty string
          this.syncStateToGenerators();
          const emptyStr = this.stringGen.createStringConstant('');
          ir += `  ret i8* ${emptyStr}\n`;
        } else {
          ir += '  ret i32 0\n';
        }
      }
    }
    ir += '}\n';

    return ir;
  }

  private generateBlock(block: BlockStatement, params: string[]): string | null {
    let lastValue: string | null = null;
    let hasTerminator = false;

    // Sync thisPointer from classGen if it's set (for constructor/method contexts)
    if (this.classGen.thisPointer !== null) {
      this.thisPointer = this.classGen.thisPointer;
    }

    for (const stmt of block.statements) {
      // Stop processing if we've already generated a terminator
      if (hasTerminator) {
        break;
      }

      if (stmt.type === 'variable_declaration') {
        // Handle uninitialized variables (e.g., let x;)
        if (stmt.value === null) {
          // For uninitialized variables, just allocate space and initialize to 0
          const allocaReg = this.nextTemp();
          this.variables.set(stmt.name, allocaReg);
          this.emit(`${allocaReg} = alloca i32`);
          this.emit(`store i32 0, i32* ${allocaReg}`);
          continue;
        }

        // Set expected array element type from TypeScript type annotation if available
        // This helps properly type empty arrays like: const x: string[] = []
        if (stmt.declaredType) {
          if (stmt.declaredType === 'string[]') {
            this.expectedArrayElementType = 'string';
          } else if (stmt.declaredType === 'number[]' || stmt.declaredType === 'boolean[]') {
            this.expectedArrayElementType = 'number';
          }
        }

        // Determine if this is a string, array, string array, object, map, set, regex, class instance, JSON object, or numeric value
        // NOTE: Check isStringArray BEFORE isArray since string arrays are also arrays
        const isString = this.isStringExpression(stmt.value);
        const isStringArray = this.isStringArrayExpression(stmt.value);
        const isArray = !isStringArray && this.isArrayExpression(stmt.value);
        const isJSONObject = this.isJSONParseExpression(stmt.value);
        const isObject = !isJSONObject && this.isObjectExpression(stmt.value);
        const isMap = this.isMapExpression(stmt.value);
        const isSet = this.isSetExpression(stmt.value);
        const isRegex = this.isRegexExpression(stmt.value);
        const isClassInstance = this.isClassInstanceExpression(stmt.value);

        if (isClassInstance) {
          // Allocate stack space for class instance pointer
          const allocaReg = this.nextTemp();
          const newExpr = stmt.value as any as NewNode;
          const className = newExpr.className;
          const fields = this.classGen.getClassFields(className);
          const ptrType = fields.length > 0 ? `%${className}_struct*` : 'i32*';

          this.classInstanceVariables.set(stmt.name, { ptr: allocaReg, className });
          this.emit(`${allocaReg} = alloca ${ptrType}`);

          // Generate the new expression and store it
          const instancePtr = this.generateExpression(stmt.value, params);
          this.emit(`store ${ptrType} ${instancePtr}, ${ptrType}* ${allocaReg}`);
        } else if (isJSONObject) {
          // JSON.parse() result - store as special JSON object variable
          const allocaReg = this.nextTemp();
          this.jsonObjectVariables.set(stmt.name, allocaReg);
          this.emit(`${allocaReg} = alloca i8*`);

          // Generate JSON.parse() call
          const jsonPtr = this.generateExpression(stmt.value, params);
          this.emit(`store i8* ${jsonPtr}, i8** ${allocaReg}`);
        } else if (isObject) {
          // Allocate stack space for object pointer (i8*) BEFORE generating the expression
          const allocaReg = this.nextTemp();
          const metadata = this.getObjectMetadata(stmt.value as any);
          this.objectVariables.set(stmt.name, { ptr: allocaReg, keys: metadata.keys, types: metadata.types });
          this.emit(`${allocaReg} = alloca i8*`);

          // Now generate the expression
          const objExpr = this.generateExpression(stmt.value, params);
          this.emit(`store i8* ${objExpr}, i8** ${allocaReg}`);
        } else if (isMap) {
          // Allocate stack space for map struct (%Map*)
          const allocaReg = this.nextTemp();
          this.mapVariables.set(stmt.name, allocaReg);
          this.emit(`${allocaReg} = alloca %Map`);

          // Compute initial value and store it
          const value = this.generateExpression(stmt.value, params);
          // value is a %Map*, copy the struct
          const loadedMap = this.nextTemp();
          this.emit(`${loadedMap} = load %Map, %Map* ${value}`);
          this.emit(`store %Map ${loadedMap}, %Map* ${allocaReg}`);
        } else if (isSet) {
          // Allocate stack space for set struct (%Set*)
          const allocaReg = this.nextTemp();
          this.setVariables.set(stmt.name, allocaReg);
          this.emit(`${allocaReg} = alloca %Set`);

          // Compute initial value and store it
          const value = this.generateExpression(stmt.value, params);
          // value is a %Set*, copy the struct
          const loadedSet = this.nextTemp();
          this.emit(`${loadedSet} = load %Set, %Set* ${value}`);
          this.emit(`store %Set ${loadedSet}, %Set* ${allocaReg}`);
        } else if (isStringArray) {
          // Allocate stack space for string array struct (%StringArray*)
          // NOTE: This must come BEFORE isArray check since string arrays are also arrays
          const allocaReg = this.nextTemp();
          this.variables.set(stmt.name, allocaReg);
          this.variableTypes.set(stmt.name, '%StringArray*');  // Track string array type!
          this.stringArrayVariables.set(stmt.name, allocaReg);
          this.emit(`${allocaReg} = alloca %StringArray`);

          // Compute initial value and store it
          const value = this.generateExpression(stmt.value, params);
          // value is a %StringArray*, copy the struct
          const loadedStringArray = this.nextTemp();
          this.emit(`${loadedStringArray} = load %StringArray, %StringArray* ${value}`);
          this.emit(`store %StringArray ${loadedStringArray}, %StringArray* ${allocaReg}`);
        } else if (isArray) {
          // Allocate stack space for array struct (%Array*)
          const allocaReg = this.nextTemp();
          this.variables.set(stmt.name, allocaReg);
          this.variableTypes.set(stmt.name, '%Array*');  // Track array type!
          this.arrayVariables.set(stmt.name, allocaReg);
          this.emit(`${allocaReg} = alloca %Array`);

          // Compute initial value and store it
          const value = this.generateExpression(stmt.value, params);
          // value is a %Array*, copy the struct
          const loadedArray = this.nextTemp();
          this.emit(`${loadedArray} = load %Array, %Array* ${value}`);
          this.emit(`store %Array ${loadedArray}, %Array* ${allocaReg}`);
        } else if (isRegex) {
          // Allocate stack space for regex pointer (i8*)
          const allocaReg = this.nextTemp();
          this.variables.set(stmt.name, allocaReg);
          this.variableTypes.set(stmt.name, 'i8*');  // Track regex type!
          this.regexVariables.set(stmt.name, allocaReg);
          this.emit(`${allocaReg} = alloca i8*`);

          // Compute initial value and store it
          const value = this.generateExpression(stmt.value, params);
          this.emit(`store i8* ${value}, i8** ${allocaReg}`);
        } else if (isString) {
          // Allocate stack space for string pointer (i8*)
          const allocaReg = this.nextTemp();
          this.variables.set(stmt.name, allocaReg);
          this.variableTypes.set(stmt.name, 'i8*');  // Track string type!
          this.stringVariables.set(stmt.name, allocaReg);
          this.emit(`${allocaReg} = alloca i8*`);

          // Compute initial value and store it
          const value = this.generateExpression(stmt.value, params);
          this.emit(`store i8* ${value}, i8** ${allocaReg}`);
        } else {
          // Allocate stack space for i32
          const allocaReg = this.nextTemp();
          this.variables.set(stmt.name, allocaReg);
          this.variableTypes.set(stmt.name, 'i32');  // Track numeric type!
          this.emit(`${allocaReg} = alloca i32`);

          // Compute initial value and store it
          const value = this.generateExpression(stmt.value, params);
          this.emit(`store i32 ${value}, i32* ${allocaReg}`);
        }

        // Reset expected array element type after variable declaration is complete
        this.expectedArrayElementType = null;
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

            if (object.type === 'variable' && this.classInstanceVariables.has(object.name)) {
              const classMeta = this.classInstanceVariables.get(object.name)!;
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
            if (object.type === 'variable' && this.classInstanceVariables.has(object.name)) {
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
                      const varType = this.variableTypes.get(memberAccessValue.value.name);
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
                    // Store i32
                    this.emit(`store i32 ${value}, i32* ${fieldPtr}`);
                  }
                } else {
                  // Backward compat: no declared fields
                  this.emit(`${fieldPtr} = getelementptr inbounds i32, i32* ${instancePtr}, i32 ${fieldInfo.index}`);
                  this.emit(`store i32 ${value}, i32* ${fieldPtr}`);
                }
              } else if (fields.length === 0) {
                // Backward compat: no declared fields, use index 0
                const fieldPtr = this.nextTemp();
                this.emit(`${fieldPtr} = getelementptr inbounds i32, i32* ${instancePtr}, i32 0`);
                this.emit(`store i32 ${value}, i32* ${fieldPtr}`);
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
          const stringAllocaReg = this.stringVariables.get(stmt.name);
          if (stringAllocaReg) {
            this.emit(`store i8* ${value}, i8** ${stringAllocaReg}`);
            return '';
          }

          // Check for array variable
          const arrayAllocaReg = this.arrayVariables.get(stmt.name);
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
          const allocaReg = this.variables.get(stmt.name);
          if (!allocaReg) {
            throw new Error(`Unknown variable: ${stmt.name}`);
          }
          this.emit(`store i32 ${value}, i32* ${allocaReg}`);
        }
      } else if (stmt.type === 'return') {
        lastValue = this.generateExpression(stmt.value, params);
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

  private generateExpression(expr: Expression, params: string[]): string {
    if (expr.type === 'number') {
      return String(expr.value);
    }

    if (expr.type === 'boolean') {
      // In LLVM, i1 0 = false, i1 1 = true
      return expr.value ? '1' : '0';
    }

    if (expr.type === 'string') {
      this.syncStateToGenerators();
      return this.stringGen.createStringConstant(expr.value);
    }

    if ((expr as any).type === 'regex') {
      this.syncStateToGenerators();
      const regexExpr = expr as any;
      return this.regexGen.generateRegexCompile(regexExpr.pattern, regexExpr.flags);
    }

    if (expr.type === 'array') {
      this.syncStateToGenerators();
      return this.arrayGen.generateArrayLiteral(expr, params);
    }

    if ((expr as any).type === 'object') {
      this.syncStateToGenerators();
      return this.objectGen.generateObjectLiteral(expr, params);
    }

    if ((expr as any).type === 'map') {
      this.syncStateToGenerators();
      return this.mapGen.generateMapLiteral(expr, params);
    }

    if ((expr as any).type === 'set') {
      this.syncStateToGenerators();
      return this.setGen.generateSetLiteral(expr, params);
    }

    if ((expr as any).type === 'new') {
      this.syncStateToGenerators();
      const newExpr = expr as any as NewNode;
      return this.classGen.generateNewExpression(newExpr.className, newExpr.args, params);
    }

    if ((expr as any).type === 'this') {
      // Return the current 'this' pointer
      // Check both this.thisPointer and classGen.thisPointer (for constructor/method contexts)
      const thisPtr = this.thisPointer || this.classGen.thisPointer;
      if (!thisPtr) {
        throw new Error('this keyword used outside of class method or constructor');
      }
      return thisPtr;
    }

    if (expr.type === 'variable') {
      // Check if it's a class instance variable
      const classInstanceMeta = this.classInstanceVariables.get(expr.name);
      if (classInstanceMeta) {
        const fields = this.classGen.getClassFields(classInstanceMeta.className);
        const ptrType = fields.length > 0 ? `%${classInstanceMeta.className}_struct*` : 'i32*';

        const temp = this.nextTemp();
        this.emit(`${temp} = load ${ptrType}, ${ptrType}* ${classInstanceMeta.ptr}`);
        // Track the loaded value's type
        this.variableTypes.set(temp, ptrType);
        return temp;
      }

      // Check if it's a regex variable
      const regexAllocaReg = this.regexVariables.get(expr.name);
      if (regexAllocaReg) {
        const temp = this.nextTemp();
        this.emit(`${temp} = load i8*, i8** ${regexAllocaReg}`);
        // Track the loaded value's type
        this.variableTypes.set(temp, 'i8*');
        return temp;
      }

      // Check if it's a map variable
      const mapAllocaReg = this.mapVariables.get(expr.name);
      if (mapAllocaReg) {
        return mapAllocaReg;
      }

      // Check if it's a set variable
      const setAllocaReg = this.setVariables.get(expr.name);
      if (setAllocaReg) {
        return setAllocaReg;
      }

      // Check if it's an array variable
      const arrayAllocaReg = this.arrayVariables.get(expr.name);
      if (arrayAllocaReg) {
        return arrayAllocaReg;
      }

      // Check if it's a string array variable
      const stringArrayAllocaReg = this.stringArrayVariables.get(expr.name);
      if (stringArrayAllocaReg) {
        return stringArrayAllocaReg;
      }

      // Check if it's a string variable
      const stringAllocaReg = this.stringVariables.get(expr.name);
      if (stringAllocaReg) {
        const temp = this.nextTemp();
        this.emit(`${temp} = load i8*, i8** ${stringAllocaReg}`);
        // Track the loaded value's type
        this.variableTypes.set(temp, 'i8*');
        return temp;
      }

      // Check if it's an object variable
      const objectMeta = this.objectVariables.get(expr.name);
      if (objectMeta) {
        // Load object pointer
        const temp = this.nextTemp();
        this.emit(`${temp} = load i8*, i8** ${objectMeta.ptr}`);
        // Convert pointer to i32 for passing as argument
        const asInt = this.nextTemp();
        this.emit(`${asInt} = ptrtoint i8* ${temp} to i32`);
        return asInt;
      }
      // Load variable with proper type from variableTypes map
      if (!expr.name) {
        throw new Error(`Variable expression has no name property. Expression: ${JSON.stringify(expr, null, 2)}`);
      }
      const allocaReg = this.variables.get(expr.name);
      if (allocaReg) {
        const temp = this.nextTemp();
        const varType = this.variableTypes.get(expr.name) || 'i32';
        logger.debug(`Loading variable "${expr.name}", type: "${varType}", alloca: "${allocaReg}"`);
        this.emit(`${temp} = load ${varType}, ${varType}* ${allocaReg}`);
        return temp;
      }

      throw new Error(`Unknown variable: ${expr.name}`);
    }

    if (expr.type === 'member_access') {
      // Handle process.argv - special case
      if (expr.object.type === 'variable' && (expr.object as any).name === 'process' && expr.property === 'argv') {
        // Return the argv pointer - it will be treated as a pseudo-array
        // We need to mark this as a process.argv array for later indexing
        const temp = this.nextTemp();
        this.emit(`${temp} = load i8**, i8*** @__argv`);
        // Store this as a special variable so indexing works
        this.processArgvVariables.add(temp);
        return temp;
      }

      // Handle class instance property access (this.field or instance.field)
      let className: string | null = null;
      let instancePtr: string | null = null;

      if (expr.object.type === 'variable' && this.classInstanceVariables.has(expr.object.name)) {
        const classMeta = this.classInstanceVariables.get(expr.object.name)!;
        className = classMeta.className;
        instancePtr = this.generateExpression(expr.object, params);
      } else if ((expr.object as any).type === 'new') {
        const newExpr = expr.object as any as NewNode;
        className = newExpr.className;
        instancePtr = this.generateExpression(expr.object, params);
      } else if ((expr.object as any).type === 'this') {
        // Get this pointer - check both this.thisPointer and classGen.thisPointer
        const thisPtr = this.thisPointer || this.classGen.thisPointer;
        if (!thisPtr) {
          throw new Error('this.field accessed outside of class method or constructor');
        }
        instancePtr = thisPtr;
        // Find which class we're in - we'll need to track this better later
        // For now, search for a class that might have this field
        // This is a simplified approach - in a full implementation we'd track the current class
        const classWithField = this.ast.classes.find(c => {
          // Check if constructor or any method assigns this field
          return c.methods.some(m => {
            // Simple check - look for assignment statements with this.field
            // For now, we'll just assume any class could have this field
            return true;
          });
        });
        if (classWithField) {
          className = classWithField.name;
        }
      }

      if (className && instancePtr) {
        // Get field info from class generator
        const fieldInfo = this.classGen.getFieldInfo(className, expr.property);
        const fields = this.classGen.getClassFields(className);

        if (fieldInfo) {
          // Typed field - use struct getelementptr
          const fieldPtr = this.nextTemp();
          if (fields.length > 0) {
            this.emit(`${fieldPtr} = getelementptr inbounds %${className}_struct, %${className}_struct* ${instancePtr}, i32 0, i32 ${fieldInfo.index}`);

            if (fieldInfo.type === 'string') {
              // Load string pointer (i8*)
              const value = this.nextTemp();
              this.emit(`${value} = load i8*, i8** ${fieldPtr}`);
              return value;
            } else if (fieldInfo.type === 'string[]') {
              // Load string array pointer (%StringArray*)
              const value = this.nextTemp();
              this.emit(`${value} = load %StringArray*, %StringArray** ${fieldPtr}`);
              // Track this as a string array variable for subsequent operations
              this.stringArrayVariables.set(value, value);
              return value;
            } else if (fieldInfo.type.endsWith('[]')) {
              // Load number/boolean array pointer (%Array*)
              const value = this.nextTemp();
              this.emit(`${value} = load %Array*, %Array** ${fieldPtr}`);
              // Track this as an array variable for subsequent operations
              this.arrayVariables.set(value, value);
              return value;
            } else {
              // Load i32
              const value = this.nextTemp();
              this.emit(`${value} = load i32, i32* ${fieldPtr}`);
              return value;
            }
          } else {
            // Backward compat: no declared fields
            this.emit(`${fieldPtr} = getelementptr inbounds i32, i32* ${instancePtr}, i32 ${fieldInfo.index}`);
            const value = this.nextTemp();
            this.emit(`${value} = load i32, i32* ${fieldPtr}`);
            return value;
          }
        } else if (fields.length === 0) {
          // Backward compat: no declared fields, use index 0
          const fieldPtr = this.nextTemp();
          this.emit(`${fieldPtr} = getelementptr inbounds i32, i32* ${instancePtr}, i32 0`);
          const value = this.nextTemp();
          this.emit(`${value} = load i32, i32* ${fieldPtr}`);
          return value;
        } else {
          throw new Error(`Field '${expr.property}' not found in class ${className}. Did you forget to declare it with a type annotation?`);
        }
      }

      // Check if accessing a JSON object property
      if (expr.object.type === 'variable' && this.jsonObjectVariables.has(expr.object.name)) {
        // Load JSON object pointer
        const jsonObjPtrPtr = this.jsonObjectVariables.get(expr.object.name)!;
        const jsonObjPtr = this.nextTemp();
        this.emit(`${jsonObjPtr} = load i8*, i8** ${jsonObjPtrPtr}`);

        this.syncStateToGenerators();
        const fieldNameStr = this.stringGen.createStringConstant(expr.property);

        // Get the field from JSON object
        const fieldItem = this.nextTemp();
        this.emit(`${fieldItem} = call i8* @cJSON_GetObjectItem(i8* ${jsonObjPtr}, i8* ${fieldNameStr})`);

        // Check if field exists
        const fieldExists = this.nextTemp();
        this.emit(`${fieldExists} = icmp ne i8* ${fieldItem}, null`);

        const hasFieldLabel = this.nextLabel('json_has_field');
        const noFieldLabel = this.nextLabel('json_no_field');
        const fieldEndLabel = this.nextLabel('json_field_end');

        this.emit(`br i1 ${fieldExists}, label %${hasFieldLabel}, label %${noFieldLabel}`);

        // Field exists: check type and extract value
        this.emit(`${hasFieldLabel}:`);

        // Check if it's a number
        const isNumber = this.nextTemp();
        this.emit(`${isNumber} = call i32 @cJSON_IsNumber(i8* ${fieldItem})`);
        const isNumBool = this.nextTemp();
        this.emit(`${isNumBool} = icmp ne i32 ${isNumber}, 0`);

        const numberLabel = this.nextLabel('json_number');
        const stringLabel = this.nextLabel('json_string');

        this.emit(`br i1 ${isNumBool}, label %${numberLabel}, label %${stringLabel}`);

        // Number field
        this.emit(`${numberLabel}:`);
        const numValue = this.nextTemp();
        this.emit(`${numValue} = call i32 @cJSON_GetNumberValueAsInt(i8* ${fieldItem})`);
        this.emit(`br label %${fieldEndLabel}`);

        // String field
        this.emit(`${stringLabel}:`);
        const strValue = this.nextTemp();
        this.emit(`${strValue} = call i8* @cJSON_GetStringValue(i8* ${fieldItem})`);
        // Convert i8* to i32 for now (will be cast back when used)
        const strAsInt = this.nextTemp();
        this.emit(`${strAsInt} = ptrtoint i8* ${strValue} to i32`);
        this.emit(`br label %${fieldEndLabel}`);

        // Field doesn't exist: return 0
        this.emit(`${noFieldLabel}:`);
        this.emit(`br label %${fieldEndLabel}`);

        // Merge
        this.emit(`${fieldEndLabel}:`);
        const result = this.nextTemp();
        this.emit(`${result} = phi i32 [ ${numValue}, %${numberLabel} ], [ ${strAsInt}, %${stringLabel} ], [ 0, %${noFieldLabel} ]`);

        return result;
      }

      // Check if accessing an object property (variable or literal)
      let objPtr: string;
      let keys: string[];
      let types: string[];

      if (expr.object.type === 'variable' && this.jsonObjectVariables.has(expr.object.name)) {
        // JSON object variable - use cJSON API to access fields
        this.syncStateToGenerators();

        const jsonPtrPtr = this.jsonObjectVariables.get(expr.object.name)!;
        const jsonPtr = this.nextTemp();
        this.emit(`${jsonPtr} = load i8*, i8** ${jsonPtrPtr}`);

        const fieldNameStr = this.stringGen.createStringConstant(expr.property);

        // Get the field from JSON object
        const fieldItem = this.nextTemp();
        this.emit(`${fieldItem} = call i8* @cJSON_GetObjectItem(i8* ${jsonPtr}, i8* ${fieldNameStr})`);

        // Check if field exists
        const fieldExists = this.nextTemp();
        this.emit(`${fieldExists} = icmp ne i8* ${fieldItem}, null`);

        const hasFieldLabel = this.nextLabel('json_has_field');
        const noFieldLabel = this.nextLabel('json_no_field');
        const fieldEndLabel = this.nextLabel('json_field_end');

        this.emit(`br i1 ${fieldExists}, label %${hasFieldLabel}, label %${noFieldLabel}`);

        // Field exists: check type and extract value
        this.emit(`${hasFieldLabel}:`);

        // Check if it's a number
        const isNumber = this.nextTemp();
        this.emit(`${isNumber} = call i32 @cJSON_IsNumber(i8* ${fieldItem})`);
        const isNumBool = this.nextTemp();
        this.emit(`${isNumBool} = icmp ne i32 ${isNumber}, 0`);

        const numberLabel = this.nextLabel('json_number');
        const stringLabel = this.nextLabel('json_string');

        this.emit(`br i1 ${isNumBool}, label %${numberLabel}, label %${stringLabel}`);

        // Number field
        this.emit(`${numberLabel}:`);
        const numValue = this.nextTemp();
        this.emit(`${numValue} = call i32 @cJSON_GetNumberValueAsInt(i8* ${fieldItem})`);
        this.emit(`br label %${fieldEndLabel}`);

        // String field
        this.emit(`${stringLabel}:`);
        const strValue = this.nextTemp();
        this.emit(`${strValue} = call i8* @cJSON_GetStringValue(i8* ${fieldItem})`);
        // Convert i8* to i32 for now (will be cast back when used)
        const strAsInt = this.nextTemp();
        this.emit(`${strAsInt} = ptrtoint i8* ${strValue} to i32`);
        this.emit(`br label %${fieldEndLabel}`);

        // Field doesn't exist: return 0
        this.emit(`${noFieldLabel}:`);
        this.emit(`br label %${fieldEndLabel}`);

        // Merge
        this.emit(`${fieldEndLabel}:`);
        const result = this.nextTemp();
        this.emit(`${result} = phi i32 [ ${numValue}, %${numberLabel} ], [ ${strAsInt}, %${stringLabel} ], [ 0, %${noFieldLabel} ]`);

        return result;
      } else if (expr.object.type === 'variable' && this.objectVariables.has(expr.object.name)) {
        // Object stored in variable
        const objMeta = this.objectVariables.get(expr.object.name)!;
        keys = objMeta.keys;
        types = objMeta.types;

        // Load object pointer
        const objPtrPtr = objMeta.ptr;
        objPtr = this.nextTemp();
        this.emit(`${objPtr} = load i8*, i8** ${objPtrPtr}`);
      } else if ((expr.object as any).type === 'object') {
        // Object literal - generate it and extract metadata
        const metadata = this.getObjectMetadata(expr.object as any);
        keys = metadata.keys;
        types = metadata.types;
        objPtr = this.generateExpression(expr.object, params);
      } else if (expr.object.type === 'method_call') {
        // Check if this is JSON.parse() result
        const methodCall = expr.object as any as MethodCallNode;
        if (methodCall.method === 'parse' &&
            methodCall.object.type === 'variable' &&
            (methodCall.object as any).name === 'JSON') {
          // This is accessing a field on JSON.parse() result
          // Use cJSON_GetObjectItem to extract the field
          this.syncStateToGenerators();

          const jsonObjPtr = this.generateExpression(expr.object, params);
          const fieldNameStr = this.stringGen.createStringConstant(expr.property);

          // Get the field from JSON object
          const fieldItem = this.nextTemp();
          this.emit(`${fieldItem} = call i8* @cJSON_GetObjectItem(i8* ${jsonObjPtr}, i8* ${fieldNameStr})`);

          // Check if field exists
          const fieldExists = this.nextTemp();
          this.emit(`${fieldExists} = icmp ne i8* ${fieldItem}, null`);

          const hasFieldLabel = this.nextLabel('json_has_field');
          const noFieldLabel = this.nextLabel('json_no_field');
          const fieldEndLabel = this.nextLabel('json_field_end');

          this.emit(`br i1 ${fieldExists}, label %${hasFieldLabel}, label %${noFieldLabel}`);

          // Field exists: check type and extract value
          this.emit(`${hasFieldLabel}:`);

          // Check if it's a number
          const isNumber = this.nextTemp();
          this.emit(`${isNumber} = call i32 @cJSON_IsNumber(i8* ${fieldItem})`);
          const isNumBool = this.nextTemp();
          this.emit(`${isNumBool} = icmp ne i32 ${isNumber}, 0`);

          const numberLabel = this.nextLabel('json_number');
          const stringLabel = this.nextLabel('json_string');

          this.emit(`br i1 ${isNumBool}, label %${numberLabel}, label %${stringLabel}`);

          // Number field
          this.emit(`${numberLabel}:`);
          const numValue = this.nextTemp();
          this.emit(`${numValue} = call i32 @cJSON_GetNumberValueAsInt(i8* ${fieldItem})`);
          this.emit(`br label %${fieldEndLabel}`);

          // String field
          this.emit(`${stringLabel}:`);
          const strValue = this.nextTemp();
          this.emit(`${strValue} = call i8* @cJSON_GetStringValue(i8* ${fieldItem})`);
          // Convert i8* to i32 for now (will be cast back when used)
          const strAsInt = this.nextTemp();
          this.emit(`${strAsInt} = ptrtoint i8* ${strValue} to i32`);
          this.emit(`br label %${fieldEndLabel}`);

          // Field doesn't exist: return 0
          this.emit(`${noFieldLabel}:`);
          this.emit(`br label %${fieldEndLabel}`);

          // Merge
          this.emit(`${fieldEndLabel}:`);
          const result = this.nextTemp();
          this.emit(`${result} = phi i32 [ ${numValue}, %${numberLabel} ], [ ${strAsInt}, %${stringLabel} ], [ 0, %${noFieldLabel} ]`);

          return result;
        }

        // Not a JSON.parse result, fall through
        keys = [];
        types = [];
        objPtr = '';
      } else {
        // Not an object, fall through to .length handling
        keys = [];
        types = [];
        objPtr = '';
      }

      // If we have an object, access its property
      if (keys.length > 0 && objPtr) {
        const propIndex = keys.indexOf(expr.property);
        if (propIndex === -1) {
          const objDesc = expr.object.type === 'variable' ? (expr.object as any).name : 'literal';
          throw new Error(`Unknown property: ${expr.property} on object ${objDesc}. Available properties: ${keys.join(', ')}`);
        }

        const propType = types[propIndex];
        const structType = `{ ${types.join(', ')} }`;

        // Cast generic pointer to typed struct
        const typedPtr = this.nextTemp();
        this.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${structType}*`);

        // Get pointer to property field
        const fieldPtr = this.nextTemp();
        this.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${propIndex}`);

        // Load property value with correct type
        const value = this.nextTemp();
        this.emit(`${value} = load ${propType}, ${propType}* ${fieldPtr}`);
        return value;
      }

      // Handle .length property
      if (expr.property === 'length') {
        // Check if it's an array
        if (expr.object.type === 'variable' && this.arrayVariables.has(expr.object.name)) {
          const arrayPtr = this.generateExpression(expr.object, params);
          const lenPtr = this.nextTemp();
          this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
          const len = this.nextTemp();
          this.emit(`${len} = load i32, i32* ${lenPtr}`);
          return len;
        } else if (expr.object.type === 'variable' && this.stringArrayVariables.has(expr.object.name)) {
          // Check if it's a string array
          const stringArrayPtr = this.generateExpression(expr.object, params);
          const lenPtr = this.nextTemp();
          this.emit(`${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${stringArrayPtr}, i32 0, i32 1`);
          const len = this.nextTemp();
          this.emit(`${len} = load i32, i32* ${lenPtr}`);
          return len;
        } else {
          // String length
          const objPtr = this.generateExpression(expr.object, params);
          const lenI64 = this.nextTemp();
          this.emit(`${lenI64} = call i64 @strlen(i8* ${objPtr})`);
          const lenI32 = this.nextTemp();
          this.emit(`${lenI32} = trunc i64 ${lenI64} to i32`);
          return lenI32;
        }
      }

      // Handle .size property (for Map and Set)
      if (expr.property === 'size') {
        // Check if it's a Map
        if (expr.object.type === 'variable' && this.mapVariables.has(expr.object.name)) {
          const mapPtr = this.generateExpression(expr.object, params);
          this.syncStateToGenerators();
          return this.mapGen.generateMapSize(mapPtr);
        }
        // Check if it's a Set
        if (expr.object.type === 'variable' && this.setVariables.has(expr.object.name)) {
          const setPtr = this.generateExpression(expr.object, params);
          this.syncStateToGenerators();
          return this.setGen.generateSetSize(setPtr);
        }
      }

      // If we reach here, it's an unsupported property access pattern
      if (expr.object.type === 'variable') {
        const varName = (expr.object as any).name;

        // Check if this variable is a function parameter
        if (params.includes(varName)) {
          // Try to get type information from TypeScript if available
          if (this.typeChecker && this.currentFunction) {
            const typeInfo = this.typeChecker.getPropertyType(varName, expr.property, this.currentFunction);

            if (typeInfo && typeInfo.properties) {
              // We have TypeScript type information! Generate proper struct access
              const properties = Array.from(typeInfo.properties.entries());
              const propInfo = typeInfo.properties.get(expr.property);

              if (propInfo) {
                // Build struct type from TypeScript type information
                const structTypes = properties.map(([_, info]) => info.type);
                const structType = `{ ${structTypes.join(', ')} }`;
                const propIndex = properties.findIndex(([name, _]) => name === expr.property);

                // Load parameter (it's an i8* pointer to the object)
                const paramPtr = this.variables.get(varName);
                if (!paramPtr) {
                  throw new Error(`Parameter ${varName} not found in variables`);
                }
                const objPtrI32 = this.nextTemp();
                this.emit(`${objPtrI32} = load i32, i32* ${paramPtr}`);

                // Cast i32 to i8*
                const objPtr = this.nextTemp();
                this.emit(`${objPtr} = inttoptr i32 ${objPtrI32} to i8*`);

                // Cast to typed struct pointer
                const typedPtr = this.nextTemp();
                this.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${structType}*`);

                // Get field pointer
                const fieldPtr = this.nextTemp();
                this.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${propIndex}`);

                // Load field value with correct type
                const value = this.nextTemp();
                this.emit(`${value} = load ${propInfo.type}, ${propInfo.type}* ${fieldPtr}`);

                // Convert to i32 if needed (for compatibility)
                if (propInfo.type === 'i8*') {
                  // String pointer - keep as is, but need to return as "i32" for now
                  // TODO: Better type system
                  return value;
                } else {
                  return value;
                }
              }
            }
          }

          // No TypeScript info available - show helpful error
          const suggestion =
            `\x1b[33mWhy this happens:\x1b[0m\n` +
            `ChadScript needs TypeScript type annotations to compile object parameters.\n\n` +
            `\x1b[33mSolution:\x1b[0m Add a TypeScript interface:\n` +
            `  \x1b[32minterface MyType {\x1b[0m\n` +
            `  \x1b[32m  ${expr.property}: string;  // or number, etc.\x1b[0m\n` +
            `  \x1b[32m}\x1b[0m\n` +
            `  \x1b[32mfunction ${this.currentFunction}(${varName}: MyType) { ... }\x1b[0m\n\n` +
            `Without TypeScript types, ChadScript can't determine struct layout at compile-time.\n` +
            `Use \x1b[36m.ts\x1b[0m files instead of \x1b[36m.js\x1b[0m to enable type-aware compilation.`;

          throw new Error(this.formatCodegenError(
            `Cannot access property '${expr.property}' on function parameter '${varName}'.`,
            suggestion
          ));
        }

        const suggestion =
          `\x1b[33mThis variable exists but ChadScript doesn't know its type.\x1b[0m\n\n` +
          `ChadScript tracks these types automatically:\n` +
          `  • Objects: \x1b[32mconst obj = { x: 5, y: 10 }; obj.x\x1b[0m ✅\n` +
          `  • Arrays: \x1b[32mconst arr = [1,2,3]; arr[0]\x1b[0m ✅\n` +
          `  • Classes: \x1b[32mconst p = new Point(1, 2); p.x\x1b[0m ✅\n` +
          `  • Maps/Sets: \x1b[32mconst m = new Map(); m.set(...)\x1b[0m ✅\n\n` +
          `Common issues:\n` +
          `  • Variable assigned from function return? Return type might be unclear.\n` +
          `  • Variable assigned conditionally? Type tracking might lose it.\n` +
          `  • Imported from another file? Cross-file tracking not implemented yet.\n\n` +
          `\x1b[33mDebug tip:\x1b[0m Where is '${varName}' assigned? Does it come from an object literal?`;

        throw new Error(this.formatCodegenError(
          `Cannot access property '${expr.property}' on variable '${varName}'.`,
          suggestion
        ));
      }

      throw new Error(this.formatCodegenError(`Unknown property: ${expr.property}`));
    }

    if (expr.type === 'index_access') {
      // Check if it's process.argv
      if (expr.object.type === 'member_access') {
        const memberAccess = expr.object as any;
        if (memberAccess.object.type === 'variable' &&
            memberAccess.object.name === 'process' &&
            memberAccess.property === 'argv') {
          // Index into argv: process.argv[i]
          const argvPtr = this.generateExpression(expr.object, params);
          const index = this.generateExpression(expr.index, params);

          // Get pointer to i-th argument
          const indexI64 = this.nextTemp();
          this.emit(`${indexI64} = sext i32 ${index} to i64`);

          const argPtr = this.nextTemp();
          this.emit(`${argPtr} = getelementptr inbounds i8*, i8** ${argvPtr}, i64 ${indexI64}`);

          const arg = this.nextTemp();
          this.emit(`${arg} = load i8*, i8** ${argPtr}`);

          // Mark this as a string variable
          this.stringVariables.set(arg, arg);

          return arg;
        }
      }

      // Determine if we're indexing into a string array or numeric array
      // We use isStringArrayExpression/isArrayExpression which check types comprehensively
      const isStringArray = this.isStringArrayExpression(expr.object);
      const isNumericArray = !isStringArray && this.isArrayExpression(expr.object);

      if (isStringArray) {
        const stringArrayPtr = this.generateExpression(expr.object, params);
        const index = this.generateExpression(expr.index, params);

        const dataPtr = this.nextTemp();
        this.emit(`${dataPtr} = getelementptr inbounds %StringArray, %StringArray* ${stringArrayPtr}, i32 0, i32 0`);

        const data = this.nextTemp();
        this.emit(`${data} = load i8**, i8*** ${dataPtr}`);

        const elemPtr = this.nextTemp();
        this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${data}, i32 ${index}`);

        const elem = this.nextTemp();
        this.emit(`${elem} = load i8*, i8** ${elemPtr}`);
        // Track that this loaded value is a string
        this.variableTypes.set(elem, 'i8*');
        return elem;
      }
      // Check if it's a numeric array
      else if (isNumericArray) {
        const arrayPtr = this.generateExpression(expr.object, params);
        const index = this.generateExpression(expr.index, params);

        const dataPtr = this.nextTemp();
        this.emit(`${dataPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);

        const data = this.nextTemp();
        this.emit(`${data} = load i32*, i32** ${dataPtr}`);

        const elemPtr = this.nextTemp();
        this.emit(`${elemPtr} = getelementptr inbounds i32, i32* ${data}, i32 ${index}`);

        const elem = this.nextTemp();
        this.emit(`${elem} = load i32, i32* ${elemPtr}`);
        return elem;
      } else {
        // Handle string[index] - returns character code as i32
        const objPtr = this.generateExpression(expr.object, params);
        const index = this.generateExpression(expr.index, params);

        const indexI64 = this.nextTemp();
        this.emit(`${indexI64} = sext i32 ${index} to i64`);

        const charPtr = this.nextTemp();
        this.emit(`${charPtr} = getelementptr inbounds i8, i8* ${objPtr}, i64 ${indexI64}`);

        const charI8 = this.nextTemp();
        this.emit(`${charI8} = load i8, i8* ${charPtr}`);

        const charI32 = this.nextTemp();
        this.emit(`${charI32} = zext i8 ${charI8} to i32`);

        return charI32;
      }
    }

    if (expr.type === 'unary') {
      const operand = this.generateExpression(expr.operand, params);

      if (expr.op === '!') {
        const cmpResult = this.nextTemp();
        this.emit(`${cmpResult} = icmp eq i32 ${operand}, 0`);
        const result = this.nextTemp();
        this.emit(`${result} = zext i1 ${cmpResult} to i32`);
        return result;
      }

      if (expr.op === '-') {
        const result = this.nextTemp();
        this.emit(`${result} = sub i32 0, ${operand}`);
        return result;
      }

      if (expr.op === '+') {
        // Unary + is a no-op for numbers, just return the operand
        return operand;
      }

      throw new Error(`Unknown unary operator: ${expr.op}`);
    }

    if (expr.type === 'binary') {
      // Logical operators need short-circuit evaluation
      if (expr.op === '&&' || expr.op === '||') {
        this.syncStateToGenerators();
        return this.controlFlowGen.generateLogicalOp(expr.op, expr.left, expr.right, params);
      }

      // Check for string concatenation (+ with at least one string operand)
      if (expr.op === '+' && (this.isStringExpression(expr.left) || this.isStringExpression(expr.right))) {
        this.syncStateToGenerators();
        return this.stringGen.generateStringConcat(expr.left, expr.right, params);
      }

      // Arithmetic operators
      const arithMap: { [key: string]: string } = {
        '+': 'add',
        '-': 'sub',
        '*': 'mul',
        '/': 'sdiv'
      };

      // Comparison operators (icmp returns i1, need to extend to i32)
      const cmpMap: { [key: string]: string } = {
        '<': 'slt',
        '>': 'sgt',
        '<=': 'sle',
        '>=': 'sge',
        '==': 'eq',
        '!=': 'ne',
        '===': 'eq',  // Strict equality (same as == for i32)
        '!==': 'ne'   // Strict inequality (same as != for i32)
      };

      // Check if we're comparing strings
      const leftIsString = this.isStringExpression(expr.left);
      const rightIsString = this.isStringExpression(expr.right);

      const left = this.generateExpression(expr.left, params);
      const right = this.generateExpression(expr.right, params);

      // Also check if generated values are tracked as strings
      const leftType = this.variableTypes.get(left) || 'i32';
      const rightType = this.variableTypes.get(right) || 'i32';
      const leftIsStringType = leftType === 'i8*' || left.startsWith('@.str');
      const rightIsStringType = rightType === 'i8*' || right.startsWith('@.str');

      if (arithMap[expr.op]) {
        const temp = this.nextTemp();
        const op = arithMap[expr.op];
        this.emit(`${temp} = ${op} i32 ${left}, ${right}`);
        return temp;
      } else if (cmpMap[expr.op]) {
        // String comparison uses strcmp (check both static and runtime types)
        if ((leftIsString || leftIsStringType) && (rightIsString || rightIsStringType) &&
            (expr.op === '==' || expr.op === '===' || expr.op === '!=' || expr.op === '!==')) {
          this.syncStateToGenerators();
          const strcmpResult = this.nextTemp();
          this.emit(`${strcmpResult} = call i32 @strcmp(i8* ${left}, i8* ${right})`);
          const cmpResult = this.nextTemp();
          if (expr.op === '==' || expr.op === '===') {
            this.emit(`${cmpResult} = icmp eq i32 ${strcmpResult}, 0`);
          } else { // '!=' or '!=='
            this.emit(`${cmpResult} = icmp ne i32 ${strcmpResult}, 0`);
          }
          const extResult = this.nextTemp();
          this.emit(`${extResult} = zext i1 ${cmpResult} to i32`);
          return extResult;
        }

        // Numeric comparison uses icmp
        const cond = cmpMap[expr.op];
        const cmpResult = this.nextTemp();
        this.emit(`${cmpResult} = icmp ${cond} i32 ${left}, ${right}`);
        const extResult = this.nextTemp();
        this.emit(`${extResult} = zext i1 ${cmpResult} to i32`);
        return extResult;
      } else {
        throw new Error(`Unknown operator: ${expr.op}`);
      }
    }

    if (expr.type === 'call') {
      // Handle httpServe() special built-in function
      if (expr.name === 'httpServe') {
        return this.generateHttpServe(expr, params);
      }

      // Handle fetch() special built-in function
      if (expr.name === 'fetch') {
        if (expr.args.length < 1) {
          throw new Error('fetch() requires at least 1 argument (URL)');
        }
        const urlValue = this.generateExpression(expr.args[0], params);
        const temp = this.nextTemp();
        this.emit(`${temp} = call i8* @fetch(i8* ${urlValue})`);
        return temp;
      }

      const args = expr.args.map(arg => {
        const result = this.generateExpression(arg, params);
        return `i32 ${result}`;
      }).join(', ');

      const temp = this.nextTemp();
      this.emit(`${temp} = call i32 @${expr.name}(${args})`);

      return temp;
    }

    if (expr.type === 'method_call') {
      return this.generateMethodCall(expr, params);
    }

    if ((expr as any).type === 'arrow_function') {
      // Lambda lifting: convert inline function to top-level function
      const arrowFunc = expr as any;
      const funcName = `__lambda_${this.anonFuncCounter++}`;

      // Create a FunctionNode
      const liftedFunc: FunctionNode = {
        name: funcName,
        params: arrowFunc.params,
        body: arrowFunc.body.type === 'block' ? arrowFunc.body : {
          type: 'block',
          statements: [{ type: 'return', value: arrowFunc.body }]
        }
      };

      // Add to lifted functions list
      this.liftedFunctions.push(liftedFunc);

      // Return the function name as a variable reference
      // This allows it to be used with array methods
      return funcName;
    }

    if ((expr as any).type === 'conditional') {
      const conditionalExpr = expr as any;

      // Generate unique labels
      const trueLabel = this.nextLabel('cond_true');
      const falseLabel = this.nextLabel('cond_false');
      const mergeLabel = this.nextLabel('cond_merge');

      // Evaluate condition
      const condValue = this.generateExpression(conditionalExpr.condition, params);

      // Convert i32 to i1 for branch (non-zero is true)
      const condBool = this.nextTemp();
      this.emit(`${condBool} = icmp ne i32 ${condValue}, 0`);

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
      this.emit(`${result} = phi i32 [ ${trueValue}, %${trueLabelEnd} ], [ ${falseValue}, %${falseLabelEnd} ]`);

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

  private generateMethodCall(expr: MethodCallNode, params: string[]): string {
    const method = expr.method;

    // Handle console.log and console.error
    if ((method === 'log' || method === 'error') && expr.object.type === 'variable' && (expr.object as any).name === 'console') {
      return this.generateConsoleCall(method, expr.args, params);
    }

    // Handle process.exit()
    if (method === 'exit' && expr.object.type === 'variable' && (expr.object as any).name === 'process') {
      const exitCode = expr.args.length > 0 ? this.generateExpression(expr.args[0], params) : '0';
      // Flush stdout before exiting to ensure all output is printed
      const stdoutPtr = this.nextTemp();
      this.emit(`${stdoutPtr} = load i8*, i8** @stdout`);
      const flushResult = this.nextTemp();
      this.emit(`${flushResult} = call i32 @fflush(i8* ${stdoutPtr})`);
      this.emit(`call void @exit(i32 ${exitCode})`);
      // Return a dummy value since exit doesn't return
      return '0';
    }

    // Handle fs.readFileSync()
    if (method === 'readFileSync' && expr.object.type === 'variable' && (expr.object as any).name === 'fs') {
      if (expr.args.length < 1) {
        throw new Error('fs.readFileSync() requires at least 1 argument (filename)');
      }

      this.syncStateToGenerators();

      // Get filename argument
      const filenamePtr = this.generateExpression(expr.args[0], params);

      // Create "r" mode string for fopen
      const modeStr = this.stringGen.createStringConstant('r');

      // Open file: FILE* fp = fopen(filename, "r")
      const filePtr = this.nextTemp();
      this.emit(`${filePtr} = call i8* @fopen(i8* ${filenamePtr}, i8* ${modeStr})`);

      // Check if file opened successfully (if NULL, return empty string for now)
      const isNull = this.nextTemp();
      this.emit(`${isNull} = icmp eq i8* ${filePtr}, null`);

      const failLabel = this.nextLabel('read_fail');
      const successLabel = this.nextLabel('read_success');
      const endLabel = this.nextLabel('read_end');

      this.emit(`br i1 ${isNull}, label %${failLabel}, label %${successLabel}`);

      // Failure case: return empty string
      this.emit(`${failLabel}:`);
      const emptyStr = this.stringGen.createStringConstant('');
      this.emit(`br label %${endLabel}`);

      // Success case: read file
      this.emit(`${successLabel}:`);

      // Seek to end to get file size: fseek(fp, 0, SEEK_END)
      const seekEnd = this.nextTemp();
      this.emit(`${seekEnd} = call i32 @fseek(i8* ${filePtr}, i64 0, i32 2)`);

      // Get file size: size = ftell(fp)
      const fileSize = this.nextTemp();
      this.emit(`${fileSize} = call i64 @ftell(i8* ${filePtr})`);

      // Seek back to beginning: fseek(fp, 0, SEEK_SET)
      const seekStart = this.nextTemp();
      this.emit(`${seekStart} = call i32 @fseek(i8* ${filePtr}, i64 0, i32 0)`);

      // Allocate buffer: malloc(size + 1) for null terminator
      const bufferSize = this.nextTemp();
      this.emit(`${bufferSize} = add i64 ${fileSize}, 1`);
      const buffer = this.nextTemp();
      this.emit(`${buffer} = call i8* @malloc(i64 ${bufferSize})`);

      // Read file: fread(buffer, 1, size, fp)
      const bytesRead = this.nextTemp();
      this.emit(`${bytesRead} = call i64 @fread(i8* ${buffer}, i64 1, i64 ${fileSize}, i8* ${filePtr})`);

      // Null-terminate the string
      const nullPos = this.nextTemp();
      this.emit(`${nullPos} = getelementptr inbounds i8, i8* ${buffer}, i64 ${fileSize}`);
      this.emit(`store i8 0, i8* ${nullPos}`);

      // Close file: fclose(fp)
      const closeResult = this.nextTemp();
      this.emit(`${closeResult} = call i32 @fclose(i8* ${filePtr})`);

      this.emit(`br label %${endLabel}`);

      // End: phi node to select result
      this.emit(`${endLabel}:`);
      const result = this.nextTemp();
      this.emit(`${result} = phi i8* [ ${emptyStr}, %${failLabel} ], [ ${buffer}, %${successLabel} ]`);

      return result;
    }

    // Handle fs.writeFileSync()
    if (method === 'writeFileSync' && expr.object.type === 'variable' && (expr.object as any).name === 'fs') {
      if (expr.args.length < 2) {
        throw new Error('fs.writeFileSync() requires at least 2 arguments (filename, data)');
      }

      this.syncStateToGenerators();

      // Get filename and data arguments
      const filenamePtr = this.generateExpression(expr.args[0], params);
      const dataPtr = this.generateExpression(expr.args[1], params);

      // Create "w" mode string for fopen
      const modeStr = this.stringGen.createStringConstant('w');

      // Open file: FILE* fp = fopen(filename, "w")
      const filePtr = this.nextTemp();
      this.emit(`${filePtr} = call i8* @fopen(i8* ${filenamePtr}, i8* ${modeStr})`);

      // Check if file opened successfully
      const isNull = this.nextTemp();
      this.emit(`${isNull} = icmp eq i8* ${filePtr}, null`);

      const failLabel = this.nextLabel('write_fail');
      const successLabel = this.nextLabel('write_success');
      const endLabel = this.nextLabel('write_end');

      this.emit(`br i1 ${isNull}, label %${failLabel}, label %${successLabel}`);

      // Failure case: return -1
      this.emit(`${failLabel}:`);
      this.emit(`br label %${endLabel}`);

      // Success case: write file
      this.emit(`${successLabel}:`);

      // Get data length: strlen(data)
      const dataLen = this.nextTemp();
      this.emit(`${dataLen} = call i64 @strlen(i8* ${dataPtr})`);

      // Write data: fwrite(data, 1, len, fp)
      const fwriteDecl = 'declare i64 @fwrite(i8*, i64, i64, i8*)';
      // Note: fwrite declaration should be added to the top, but for now we'll declare it inline if needed
      const bytesWritten = this.nextTemp();
      this.emit(`${bytesWritten} = call i64 @fwrite(i8* ${dataPtr}, i64 1, i64 ${dataLen}, i8* ${filePtr})`);

      // Close file: fclose(fp)
      const closeResult = this.nextTemp();
      this.emit(`${closeResult} = call i32 @fclose(i8* ${filePtr})`);

      this.emit(`br label %${endLabel}`);

      // End: phi node to return success/failure
      this.emit(`${endLabel}:`);
      const result = this.nextTemp();
      this.emit(`${result} = phi i32 [ -1, %${failLabel} ], [ 0, %${successLabel} ]`);

      return result;
    }

    // Handle fs.existsSync()
    if (method === 'existsSync' && expr.object.type === 'variable' && (expr.object as any).name === 'fs') {
      if (expr.args.length < 1) {
        throw new Error('fs.existsSync() requires 1 argument (filename)');
      }

      this.syncStateToGenerators();

      // Get filename argument
      const filenamePtr = this.generateExpression(expr.args[0], params);

      // Try to open file in read mode
      const modeStr = this.stringGen.createStringConstant('r');
      const filePtr = this.nextTemp();
      this.emit(`${filePtr} = call i8* @fopen(i8* ${filenamePtr}, i8* ${modeStr})`);

      // Check if file opened successfully (NULL means doesn't exist)
      const isNull = this.nextTemp();
      this.emit(`${isNull} = icmp eq i8* ${filePtr}, null`);

      const existsLabel = this.nextLabel('exists');
      const notExistsLabel = this.nextLabel('not_exists');
      const endLabel = this.nextLabel('exists_end');

      this.emit(`br i1 ${isNull}, label %${notExistsLabel}, label %${existsLabel}`);

      // File exists: close it and return 1
      this.emit(`${existsLabel}:`);
      const closeResult = this.nextTemp();
      this.emit(`${closeResult} = call i32 @fclose(i8* ${filePtr})`);
      this.emit(`br label %${endLabel}`);

      // File doesn't exist: return 0
      this.emit(`${notExistsLabel}:`);
      this.emit(`br label %${endLabel}`);

      // End: phi node to return 1 (exists) or 0 (doesn't exist)
      this.emit(`${endLabel}:`);
      const result = this.nextTemp();
      this.emit(`${result} = phi i32 [ 1, %${existsLabel} ], [ 0, %${notExistsLabel} ]`);

      return result;
    }

    // Handle fs.unlinkSync()
    if (method === 'unlinkSync' && expr.object.type === 'variable' && (expr.object as any).name === 'fs') {
      if (expr.args.length < 1) {
        throw new Error('fs.unlinkSync() requires 1 argument (filename)');
      }

      this.syncStateToGenerators();

      // Get filename argument
      const filenamePtr = this.generateExpression(expr.args[0], params);

      // Call unlink: unlink(filename) returns 0 on success, -1 on error
      const result = this.nextTemp();
      this.emit(`${result} = call i32 @unlink(i8* ${filenamePtr})`);

      return result;
    }

    // Handle path.resolve()
    if (method === 'resolve' && expr.object.type === 'variable' && (expr.object as any).name === 'path') {
      if (expr.args.length < 1) {
        throw new Error('path.resolve() requires at least 1 argument');
      }

      this.syncStateToGenerators();

      // Get path argument (for now, only support single argument)
      const pathPtr = this.generateExpression(expr.args[0], params);

      // Allocate buffer for resolved path (PATH_MAX = 4096)
      const bufferSize = this.nextTemp();
      this.emit(`${bufferSize} = add i64 0, 4096`);
      const buffer = this.nextTemp();
      this.emit(`${buffer} = call i8* @malloc(i64 ${bufferSize})`);

      // Call realpath: realpath(path, buffer)
      const resolvedPtr = this.nextTemp();
      this.emit(`${resolvedPtr} = call i8* @realpath(i8* ${pathPtr}, i8* ${buffer})`);

      // If realpath returns NULL, return the original path
      const isNull = this.nextTemp();
      this.emit(`${isNull} = icmp eq i8* ${resolvedPtr}, null`);

      const successLabel = this.nextLabel('resolve_success');
      const failLabel = this.nextLabel('resolve_fail');
      const endLabel = this.nextLabel('resolve_end');

      this.emit(`br i1 ${isNull}, label %${failLabel}, label %${successLabel}`);

      // Success: return resolved path
      this.emit(`${successLabel}:`);
      this.emit(`br label %${endLabel}`);

      // Failure: free buffer and return original path
      this.emit(`${failLabel}:`);
      this.emit(`call void @free(i8* ${buffer})`);
      this.emit(`br label %${endLabel}`);

      // End: phi node
      this.emit(`${endLabel}:`);
      const result = this.nextTemp();
      this.emit(`${result} = phi i8* [ ${resolvedPtr}, %${successLabel} ], [ ${pathPtr}, %${failLabel} ]`);

      return result;
    }

    // Handle path.dirname()
    if (method === 'dirname' && expr.object.type === 'variable' && (expr.object as any).name === 'path') {
      if (expr.args.length < 1) {
        throw new Error('path.dirname() requires 1 argument');
      }

      this.syncStateToGenerators();

      // Get path argument
      const pathPtr = this.generateExpression(expr.args[0], params);

      // dirname() modifies its argument, so we need to make a copy
      const pathLen = this.nextTemp();
      this.emit(`${pathLen} = call i64 @strlen(i8* ${pathPtr})`);
      const copySize = this.nextTemp();
      this.emit(`${copySize} = add i64 ${pathLen}, 1`);
      const pathCopy = this.nextTemp();
      this.emit(`${pathCopy} = call i8* @malloc(i64 ${copySize})`);
      const copyResult = this.nextTemp();
      this.emit(`${copyResult} = call i8* @strcpy(i8* ${pathCopy}, i8* ${pathPtr})`);

      // Call dirname: dirname(pathCopy)
      const result = this.nextTemp();
      this.emit(`${result} = call i8* @dirname(i8* ${pathCopy})`);

      return result;
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

    // Handle JSON.parse<T>()
    if (method === 'parse' && expr.object.type === 'variable' && (expr.object as any).name === 'JSON') {
      if (expr.args.length < 1) {
        throw new Error('JSON.parse() requires 1 argument (JSON string)');
      }

      this.syncStateToGenerators();

      const jsonStr = this.generateExpression(expr.args[0], params);

      // Parse JSON using cJSON
      const jsonRoot = this.nextTemp();
      this.emit(`${jsonRoot} = call i8* @cJSON_Parse(i8* ${jsonStr})`);

      // Check if parse succeeded
      const isNull = this.nextTemp();
      this.emit(`${isNull} = icmp eq i8* ${jsonRoot}, null`);

      const successLabel = this.nextLabel('json_success');
      const errorLabel = this.nextLabel('json_error');
      const endLabel = this.nextLabel('json_end');

      this.emit(`br i1 ${isNull}, label %${errorLabel}, label %${successLabel}`);

      // Error case: return null (0) as i8* or error object
      this.emit(`${errorLabel}:`);
      const errorPtr = this.nextTemp();
      this.emit(`${errorPtr} = inttoptr i32 0 to i8*`);
      this.emit(`br label %${endLabel}`);

      // Success case: extract fields based on TypeScript type information
      this.emit(`${successLabel}:`);

      // Check if we have TypeScript type information for the result
      // For now, we'll return the raw cJSON object pointer
      // The TypeScript type checker will provide struct layout information
      // that we can use to extract specific fields

      // If there's TypeScript generic type parameter (JSON.parse<T>),
      // we should extract fields according to interface T
      // For now, return as opaque pointer that can be accessed via member access
      const resultPtr = this.nextTemp();
      this.emit(`${resultPtr} = bitcast i8* ${jsonRoot} to i8*`);
      this.emit(`br label %${endLabel}`);

      // Merge: return result or error
      this.emit(`${endLabel}:`);
      const result = this.nextTemp();
      this.emit(`${result} = phi i8* [ ${errorPtr}, %${errorLabel} ], [ ${resultPtr}, %${successLabel} ]`);

      // Store as object variable for later property access
      // The caller should assign this to a variable with TypeScript type annotation
      return result;
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

        // Allocate buffer for number string (20 chars should be enough for i32)
        const buffer = this.nextTemp();
        this.emit(`${buffer} = call i8* @malloc(i64 20)`);

        // Create format string: "%d"
        const formatStr = this.stringGen.createStringConstant('%d');
        const sprintfResult = this.nextTemp();
        this.emit(`${sprintfResult} = call i32 (i8*, i8*, ...) @sprintf(i8* ${buffer}, i8* ${formatStr}, i32 ${numValue})`);

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

      const startIndex = this.generateExpression(expr.args[0], params);
      const length = expr.args.length === 2 ? this.generateExpression(expr.args[1], params) : null;

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

      const startIndex = this.generateExpression(expr.args[0], params);

      // If end is provided, calculate length = end - start
      // Otherwise, length is null (to end of string)
      let length: string | null = null;
      if (expr.args.length === 2) {
        const endIndex = this.generateExpression(expr.args[1], params);
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

      const count = this.generateExpression(expr.args[0], params);
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

      const targetLength = this.generateExpression(expr.args[0], params);
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
      if (expr.object.type === 'variable' && this.mapVariables.has(expr.object.name)) {
        this.syncStateToGenerators();
        if (method === 'set') {
          return this.mapGen.generateMapSet(expr, params);
        } else if (method === 'get') {
          return this.mapGen.generateMapGet(expr, params);
        } else {
          return this.mapGen.generateMapHas(expr, params);
        }
      }
    }

    // Handle Set methods
    if (method === 'add' || method === 'has' || method === 'delete') {
      // Check if the object is a Set
      if (expr.object.type === 'variable' && this.setVariables.has(expr.object.name)) {
        this.syncStateToGenerators();
        if (method === 'add') {
          return this.setGen.generateSetAdd(expr, params);
        } else if (method === 'has') {
          return this.setGen.generateSetHas(expr, params);
        } else {
          return this.setGen.generateSetDelete(expr, params);
        }
      }
    }

    // Handle array methods
    if (method === 'push') {
      this.syncStateToGenerators();
      return this.arrayGen.generateArrayPush(expr, params);
    } else if (method === 'map') {
      this.syncStateToGenerators();
      return this.arrayGen.generateArrayMap(expr, params);
    } else if (method === 'join') {
      this.syncStateToGenerators();
      return this.arrayGen.generateArrayJoin(expr, params);
    } else if (method === 'find') {
      this.syncStateToGenerators();
      return this.arrayGen.generateArrayFind(expr, params);
    } else if (method === 'some') {
      this.syncStateToGenerators();
      return this.arrayGen.generateArraySome(expr, params);
    } else if (method === 'filter') {
      this.syncStateToGenerators();
      return this.arrayGen.generateArrayFilter(expr, params);
    } else if (method === 'forEach') {
      this.syncStateToGenerators();
      return this.arrayGen.generateArrayForEach(expr, params);
    }

    // Handle class instance methods
    let className: string | null = null;
    let instancePtr: string | null = null;

    if (expr.object.type === 'variable' && this.classInstanceVariables.has(expr.object.name)) {
      const classMeta = this.classInstanceVariables.get(expr.object.name)!;
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
    if (expr.object.type === 'variable' && this.objectVariables.has(expr.object.name)) {
      const objMeta = this.objectVariables.get(expr.object.name)!;
      isObjectMethod = objMeta.keys.includes(method);
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

      // Generate arguments
      const args = expr.args.map(arg => {
        const result = this.generateExpression(arg, params);
        return `i32 ${result}`;
      }).join(', ');

      const temp = this.nextTemp();
      this.emit(`${temp} = call i32 @${method}(${args})`);
      return temp;
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

  private generateConsoleCall(method: string, args: Expression[], params: string[]): string {
    // Generate format string and arguments for printf/fprintf
    this.syncStateToGenerators();

    if (args.length === 0) {
      // console.log() with no args - just print newline
      const formatStr = this.stringGen.createStringConstant('\n');
      const temp = this.nextTemp();
      if (method === 'error') {
        this.emit(`${temp} = load i8*, i8** @stderr`);
        const temp2 = this.nextTemp();
        this.emit(`${temp2} = call i32 (i8*, i8*, ...) @fprintf(i8* ${temp}, i8* ${formatStr})`);
        return temp2;
      } else {
        this.emit(`${temp} = call i32 (i8*, ...) @printf(i8* ${formatStr})`);
        return temp;
      }
    }

    // For simplicity, we'll handle one argument at a time
    const arg = args[0];
    const argValue = this.generateExpression(arg, params);

    // Determine if it's a string or integer
    const isString = this.isStringExpression(arg);

    if (isString) {
      // Format string for string: "%s\n"
      const formatStr = this.stringGen.createStringConstant('%s\n');
      const temp = this.nextTemp();

      if (method === 'error') {
        this.emit(`${temp} = load i8*, i8** @stderr`);
        const temp2 = this.nextTemp();
        this.emit(`${temp2} = call i32 (i8*, i8*, ...) @fprintf(i8* ${temp}, i8* ${formatStr}, i8* ${argValue})`);
        return temp2;
      } else {
        this.emit(`${temp} = call i32 (i8*, ...) @printf(i8* ${formatStr}, i8* ${argValue})`);
        return temp;
      }
    } else {
      // Format string for integer: "%d\n"
      const formatStr = this.stringGen.createStringConstant('%d\n');
      const temp = this.nextTemp();

      if (method === 'error') {
        this.emit(`${temp} = load i8*, i8** @stderr`);
        const temp2 = this.nextTemp();
        this.emit(`${temp2} = call i32 (i8*, i8*, ...) @fprintf(i8* ${temp}, i8* ${formatStr}, i32 ${argValue})`);
        return temp2;
      } else {
        this.emit(`${temp} = call i32 (i8*, ...) @printf(i8* ${formatStr}, i32 ${argValue})`);
        return temp;
      }
    }
  }

  private isArrayExpression(expr: Expression): boolean {
    if (expr.type === 'array') {
      return true;
    }
    if (expr.type === 'variable') {
      // Check both arrayVariables (legacy) and variableTypes (new system)
      if (this.arrayVariables.has(expr.name)) {
        return true;
      }
      const varType = this.variableTypes.get(expr.name);
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
      if (memberExpr.object.type === 'variable' && this.classInstanceVariables.has(memberExpr.object.name)) {
        const classMeta = this.classInstanceVariables.get(memberExpr.object.name)!;
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

  private isObjectExpression(expr: Expression): boolean {
    if ((expr as any).type === 'object') {
      return true;
    }
    if (expr.type === 'variable') {
      return this.objectVariables.has(expr.name);
    }
    return false;
  }

  private isMapExpression(expr: Expression): boolean {
    if ((expr as any).type === 'map') {
      return true;
    }
    if (expr.type === 'variable') {
      return this.mapVariables.has(expr.name);
    }
    return false;
  }

  private isSetExpression(expr: Expression): boolean {
    if ((expr as any).type === 'set') {
      return true;
    }
    if (expr.type === 'variable') {
      return this.setVariables.has(expr.name);
    }
    return false;
  }

  private isStringExpression(expr: Expression): boolean {
    if (expr.type === 'string') {
      return true;
    }
    if ((expr as any).type === 'template_literal') {
      return true;
    }
    // Check for fetch() call - returns string
    if (expr.type === 'call' && expr.name === 'fetch') {
      return true;
    }
    if (expr.type === 'variable') {
      // Check both stringVariables (legacy) and variableTypes (new system)
      if (this.stringVariables.has(expr.name)) {
        return true;
      }
      const varType = this.variableTypes.get(expr.name);
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
        const objMeta = this.objectVariables.get(varName);
        if (objMeta) {
          const propIndex = objMeta.keys.indexOf(memberExpr.property);
          if (propIndex >= 0 && objMeta.types[propIndex] === 'i8*') {
            return true;
          }
        }
        // Check class instances
        if (this.classInstanceVariables.has(varName)) {
          const classMeta = this.classInstanceVariables.get(varName)!;
          const fieldInfo = this.classGen.getFieldInfo(classMeta.className, memberExpr.property);
          if (fieldInfo && fieldInfo.type === 'string') {
            return true;
          }
        }
        // Check TypeScript types for function parameters
        if (this.typeChecker && this.currentFunction && this.variables.has(varName)) {
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
        // Check both stringArrayVariables (legacy) and variableTypes (new system)
        if (this.stringArrayVariables.has(varName)) {
          return true;
        }
        const varType = this.variableTypes.get(varName);
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
          methodExpr.method === 'padStart' || methodExpr.method === 'charAt') {
        return true;
      }
      // Check class instance method return types
      if (methodExpr.object.type === 'variable' && this.classInstanceVariables.has(methodExpr.object.name)) {
        const classMeta = this.classInstanceVariables.get(methodExpr.object.name)!;
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
      return this.regexVariables.has(expr.name);
    }
    return false;
  }

  private isClassInstanceExpression(expr: Expression): boolean {
    if ((expr as any).type === 'new') {
      return true;
    }
    if (expr.type === 'variable') {
      return this.classInstanceVariables.has(expr.name);
    }
    return false;
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
      return this.jsonObjectVariables.has(expr.name);
    }
    return false;
  }

  private isStringArrayExpression(expr: Expression): boolean {
    if (expr.type === 'variable') {
      // Check both stringArrayVariables (legacy) and variableTypes (new system)
      if (this.stringArrayVariables.has(expr.name)) {
        return true;
      }
      const varType = this.variableTypes.get(expr.name);
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
      if (memberExpr.object.type === 'variable' && this.classInstanceVariables.has(memberExpr.object.name)) {
        const classMeta = this.classInstanceVariables.get(memberExpr.object.name)!;
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

    // Process top-level variable declarations first
    // (inline the variable declaration logic from generateBlock)
    for (const stmt of this.ast.topLevelStatements) {
      // Handle uninitialized variables (e.g., let x;)
      if (stmt.value === null) {
        // For uninitialized variables, just allocate space and initialize to 0
        const allocaReg = this.nextTemp();
        this.variables.set(stmt.name, allocaReg);
        this.emit(`${allocaReg} = alloca i32`);
        this.emit(`store i32 0, i32* ${allocaReg}`);
        continue;
      }

      // Determine if this is a string, array, string array, object, map, set, regex, class instance, JSON object, or numeric value
      // NOTE: Check isStringArray BEFORE isArray since string arrays are also arrays
      const isString = this.isStringExpression(stmt.value);
      const isStringArray = this.isStringArrayExpression(stmt.value);
      const isArray = !isStringArray && this.isArrayExpression(stmt.value);
      const isJSONObject = this.isJSONParseExpression(stmt.value);
      const isObject = !isJSONObject && this.isObjectExpression(stmt.value);
      const isMap = this.isMapExpression(stmt.value);
      const isSet = this.isSetExpression(stmt.value);
      const isRegex = this.isRegexExpression(stmt.value);
      const isClassInstance = this.isClassInstanceExpression(stmt.value);

      if (isClassInstance) {
        // Allocate stack space for class instance pointer
        const allocaReg = this.nextTemp();
        const newExpr = stmt.value as any as NewNode;
        const className = newExpr.className;
        const fields = this.classGen.getClassFields(className);
        const ptrType = fields.length > 0 ? `%${className}_struct*` : 'i32*';

        this.classInstanceVariables.set(stmt.name, { ptr: allocaReg, className });
        this.emit(`${allocaReg} = alloca ${ptrType}`);

        // Generate the new expression and store it
        const instancePtr = this.generateExpression(stmt.value, []);
        this.emit(`store ${ptrType} ${instancePtr}, ${ptrType}* ${allocaReg}`);
      } else if (isJSONObject) {
        // JSON.parse() result - store as special JSON object variable
        const allocaReg = this.nextTemp();
        this.jsonObjectVariables.set(stmt.name, allocaReg);
        this.emit(`${allocaReg} = alloca i8*`);

        // Generate JSON.parse() call
        const jsonPtr = this.generateExpression(stmt.value, []);
        this.emit(`store i8* ${jsonPtr}, i8** ${allocaReg}`);
      } else if (isObject) {
        // Allocate stack space for object pointer (i8*) BEFORE generating the expression
        const allocaReg = this.nextTemp();
        const metadata = this.getObjectMetadata(stmt.value as any);
        this.objectVariables.set(stmt.name, { ptr: allocaReg, keys: metadata.keys, types: metadata.types });
        this.emit(`${allocaReg} = alloca i8*`);

        // Now generate the expression
        const objExpr = this.generateExpression(stmt.value, []);
        this.emit(`store i8* ${objExpr}, i8** ${allocaReg}`);
      } else if (isMap) {
        // Allocate stack space for map struct (%Map*)
        const allocaReg = this.nextTemp();
        this.mapVariables.set(stmt.name, allocaReg);
        this.emit(`${allocaReg} = alloca %Map`);

        // Compute initial value and store it
        const value = this.generateExpression(stmt.value, []);
        // value is a %Map*, copy the struct
        const loadedMap = this.nextTemp();
        this.emit(`${loadedMap} = load %Map, %Map* ${value}`);
        this.emit(`store %Map ${loadedMap}, %Map* ${allocaReg}`);
      } else if (isSet) {
        // Allocate stack space for set struct (%Set*)
        const allocaReg = this.nextTemp();
        this.setVariables.set(stmt.name, allocaReg);
        this.emit(`${allocaReg} = alloca %Set`);

        // Compute initial value and store it
        const value = this.generateExpression(stmt.value, []);
        // value is a %Set*, copy the struct
        const loadedSet = this.nextTemp();
        this.emit(`${loadedSet} = load %Set, %Set* ${value}`);
        this.emit(`store %Set ${loadedSet}, %Set* ${allocaReg}`);
      } else if (isStringArray) {
        // Allocate stack space for string array struct (%StringArray*)
        // NOTE: This must come BEFORE isArray check since string arrays are also arrays
        const allocaReg = this.nextTemp();
        this.stringArrayVariables.set(stmt.name, allocaReg);
        this.emit(`${allocaReg} = alloca %StringArray`);

        // Compute initial value and store it
        const value = this.generateExpression(stmt.value, []);
        // value is a %StringArray*, copy the struct
        const loadedStringArray = this.nextTemp();
        this.emit(`${loadedStringArray} = load %StringArray, %StringArray* ${value}`);
        this.emit(`store %StringArray ${loadedStringArray}, %StringArray* ${allocaReg}`);
      } else if (isArray) {
        // Allocate stack space for array struct (%Array*)
        const allocaReg = this.nextTemp();
        this.arrayVariables.set(stmt.name, allocaReg);
        this.emit(`${allocaReg} = alloca %Array`);

        // Compute initial value and store it
        const value = this.generateExpression(stmt.value, []);
        // value is a %Array*, copy the struct
        const loadedArray = this.nextTemp();
        this.emit(`${loadedArray} = load %Array, %Array* ${value}`);
        this.emit(`store %Array ${loadedArray}, %Array* ${allocaReg}`);
      } else if (isRegex) {
        // Allocate stack space for regex pointer (i8*)
        const allocaReg = this.nextTemp();
        this.regexVariables.set(stmt.name, allocaReg);
        this.emit(`${allocaReg} = alloca i8*`);

        // Compute initial value and store it
        const value = this.generateExpression(stmt.value, []);
        this.emit(`store i8* ${value}, i8** ${allocaReg}`);
      } else if (isString) {
        // Allocate stack space for string (i8*)
        const allocaReg = this.nextTemp();
        this.stringVariables.set(stmt.name, allocaReg);
        this.emit(`${allocaReg} = alloca i8*`);

        // Compute initial value and store it
        const value = this.generateExpression(stmt.value, []);
        this.emit(`store i8* ${value}, i8** ${allocaReg}`);
      } else {
        // Numeric value (i32)
        const allocaReg = this.nextTemp();
        this.variables.set(stmt.name, allocaReg);
        this.emit(`${allocaReg} = alloca i32`);

        // Compute initial value and store it
        const value = this.generateExpression(stmt.value, []);
        this.emit(`store i32 ${value}, i32* ${allocaReg}`);
      }
    }

    // Save top-level object variables so they can be accessed from functions
    this.topLevelObjectVariables = new Map();
    this.objectVariables.forEach((value, key) => {
      this.topLevelObjectVariables.set(key, value);
    });

    // Execute all top-level expressions in order
    for (const expr of this.ast.topLevelExpressions) {
      this.generateExpression(expr, []);
    }

    if (this.output.length > 0) {
      ir += this.output.map(line => '  ' + line).join('\n') + '\n';
    }

    // Always return 0 for success (process.exit() will override this if called)
    ir += '  ret i32 0\n';

    ir += '}\n';

    return ir;
  }

  // Generate fetch() runtime using libcurl
  private generateFetchRuntime(): string {
    let ir = '; fetch() API implementation using libcurl\n';

    // Response buffer structure: { data: i8*, size: i64, capacity: i64 }
    ir += '%FetchBuffer = type { i8*, i64, i64 }\n\n';

    // Write callback for libcurl (collects response data)
    ir += 'define i64 @fetch_write_callback(i8* %data, i64 %size, i64 %nmemb, i8* %userdata) {\n';
    ir += 'entry:\n';
    ir += '  ; Calculate total size\n';
    ir += '  %total_size = mul i64 %size, %nmemb\n';
    ir += '  \n';
    ir += '  ; Cast userdata to buffer pointer\n';
    ir += '  %buffer = bitcast i8* %userdata to %FetchBuffer*\n';
    ir += '  \n';
    ir += '  ; Get current size\n';
    ir += '  %size_ptr = getelementptr %FetchBuffer, %FetchBuffer* %buffer, i32 0, i32 1\n';
    ir += '  %current_size = load i64, i64* %size_ptr\n';
    ir += '  \n';
    ir += '  ; Calculate new size\n';
    ir += '  %new_size = add i64 %current_size, %total_size\n';
    ir += '  \n';
    ir += '  ; Reallocate if needed (simple: just allocate enough space)\n';
    ir += '  %data_ptr_ptr = getelementptr %FetchBuffer, %FetchBuffer* %buffer, i32 0, i32 0\n';
    ir += '  %old_data = load i8*, i8** %data_ptr_ptr\n';
    ir += '  %alloc_size = add i64 %new_size, 1\n'; // +1 for null terminator
    ir += '  %new_data = call i8* @realloc(i8* %old_data, i64 %alloc_size)\n';
    ir += '  store i8* %new_data, i8** %data_ptr_ptr\n';
    ir += '  \n';
    ir += '  ; Copy new data\n';
    ir += '  %dest = getelementptr i8, i8* %new_data, i64 %current_size\n';
    ir += '  call void @llvm.memcpy.p0i8.p0i8.i64(i8* %dest, i8* %data, i64 %total_size, i1 false)\n';
    ir += '  \n';
    ir += '  ; Update size\n';
    ir += '  store i64 %new_size, i64* %size_ptr\n';
    ir += '  \n';
    ir += '  ; Null terminate\n';
    ir += '  %null_pos = getelementptr i8, i8* %new_data, i64 %new_size\n';
    ir += '  store i8 0, i8* %null_pos\n';
    ir += '  \n';
    ir += '  ret i64 %total_size\n';
    ir += '}\n\n';

    // Main fetch() function
    ir += '; fetch(url: string) -> string (response body)\n';
    ir += 'define i8* @fetch(i8* %url) {\n';
    ir += 'entry:\n';
    ir += '  ; Initialize curl\n';
    ir += '  %curl = call i8* @curl_easy_init()\n';
    ir += '  %curl_null = icmp eq i8* %curl, null\n';
    ir += '  br i1 %curl_null, label %error, label %curl_ok\n\n';

    ir += 'curl_ok:\n';
    ir += '  ; Create response buffer\n';
    ir += '  %buffer = alloca %FetchBuffer\n';
    ir += '  %data_ptr = getelementptr %FetchBuffer, %FetchBuffer* %buffer, i32 0, i32 0\n';
    ir += '  store i8* null, i8** %data_ptr\n';
    ir += '  %size_ptr = getelementptr %FetchBuffer, %FetchBuffer* %buffer, i32 0, i32 1\n';
    ir += '  store i64 0, i64* %size_ptr\n';
    ir += '  %cap_ptr = getelementptr %FetchBuffer, %FetchBuffer* %buffer, i32 0, i32 2\n';
    ir += '  store i64 0, i64* %cap_ptr\n';
    ir += '  \n';
    ir += '  ; Set URL\n';
    ir += '  %url_opt = load i32, i32* @CURLOPT_URL\n';
    ir += '  %url_result = call i32 (i8*, i32, ...) @curl_easy_setopt(i8* %curl, i32 %url_opt, i8* %url)\n';
    ir += '  \n';
    ir += '  ; Set User-Agent header\n';
    ir += '  %user_agent = getelementptr [17 x i8], [17 x i8]* @.str.user_agent, i32 0, i32 0\n';
    ir += '  %ua_opt = load i32, i32* @CURLOPT_USERAGENT\n';
    ir += '  %ua_result = call i32 (i8*, i32, ...) @curl_easy_setopt(i8* %curl, i32 %ua_opt, i8* %user_agent)\n';
    ir += '  \n';
    ir += '  ; Set write callback\n';
    ir += '  %write_fn_opt = load i32, i32* @CURLOPT_WRITEFUNCTION\n';
    ir += '  %write_fn = bitcast i64 (i8*, i64, i64, i8*)* @fetch_write_callback to i8*\n';
    ir += '  %write_fn_result = call i32 (i8*, i32, ...) @curl_easy_setopt(i8* %curl, i32 %write_fn_opt, i8* %write_fn)\n';
    ir += '  \n';
    ir += '  ; Set write data (our buffer)\n';
    ir += '  %write_data_opt = load i32, i32* @CURLOPT_WRITEDATA\n';
    ir += '  %buffer_ptr = bitcast %FetchBuffer* %buffer to i8*\n';
    ir += '  %write_data_result = call i32 (i8*, i32, ...) @curl_easy_setopt(i8* %curl, i32 %write_data_opt, i8* %buffer_ptr)\n';
    ir += '  \n';
    ir += '  ; Follow redirects\n';
    ir += '  %follow_opt = load i32, i32* @CURLOPT_FOLLOWLOCATION\n';
    ir += '  %follow_result = call i32 (i8*, i32, ...) @curl_easy_setopt(i8* %curl, i32 %follow_opt, i64 1)\n';
    ir += '  \n';
    ir += '  ; Perform request\n';
    ir += '  %perform_result = call i32 @curl_easy_perform(i8* %curl)\n';
    ir += '  %perform_ok = icmp eq i32 %perform_result, 0\n';
    ir += '  \n';
    ir += '  ; Cleanup curl\n';
    ir += '  call void @curl_easy_cleanup(i8* %curl)\n';
    ir += '  \n';
    ir += '  ; Return response or error\n';
    ir += '  br i1 %perform_ok, label %success, label %fetch_error\n\n';

    ir += 'success:\n';
    ir += '  %response_data = load i8*, i8** %data_ptr\n';
    ir += '  %has_data = icmp ne i8* %response_data, null\n';
    ir += '  br i1 %has_data, label %return_data, label %error\n\n';

    ir += 'return_data:\n';
    ir += '  ret i8* %response_data\n\n';

    ir += 'fetch_error:\n';
    ir += '  ; Print error and return empty string\n';
    ir += '  %err_str = call i8* @curl_easy_strerror(i32 %perform_result)\n';
    ir += '  %err_fmt = getelementptr [17 x i8], [17 x i8]* @.str.fetch_error, i32 0, i32 0\n';
    ir += '  call i32 (i8*, ...) @printf(i8* %err_fmt, i8* %err_str)\n';
    ir += '  br label %error\n\n';

    ir += 'error:\n';
    ir += '  %empty = getelementptr [1 x i8], [1 x i8]* @.str.empty, i32 0, i32 0\n';
    ir += '  ret i8* %empty\n';
    ir += '}\n\n';

    // Add required string constants
    ir += '@.str.fetch_error = private constant [17 x i8] c"fetch error: %s\\0A\\00"\n';
    ir += '@.str.empty = private constant [1 x i8] c"\\00"\n';
    ir += '@.str.user_agent = private constant [17 x i8] c"ChadScript/1.0.0\\00"\n';

    // Declare realloc (memcpy already declared elsewhere)
    // Note: libcurl will automatically use http_proxy/https_proxy env vars
    ir += 'declare i8* @realloc(i8*, i64)\n';

    return ir;
  }

  // Generate JSON parsing runtime using cJSON
  private generateJSONRuntime(): string {
    let ir = '; JSON parsing using cJSON library\n';

    // cJSON library declarations
    ir += 'declare i8* @cJSON_Parse(i8*)\n';
    ir += 'declare i8* @cJSON_GetObjectItem(i8*, i8*)\n';
    ir += 'declare void @cJSON_Delete(i8*)\n';
    ir += 'declare i32 @cJSON_IsNumber(i8*)\n';
    ir += 'declare i32 @cJSON_IsString(i8*)\n';
    ir += '\n';

    // Use cJSON's official API functions (portable across all platforms)
    // cJSON_GetNumberValue returns double, cJSON_GetStringValue returns char*
    ir += 'declare double @cJSON_GetNumberValue(i8*)\n';
    ir += 'declare i8* @cJSON_GetStringValue(i8*)\n\n';

    // Helper to convert double to i32 for integer JSON values
    ir += 'define i32 @cJSON_GetNumberValueAsInt(i8* %item) {\n';
    ir += 'entry:\n';
    ir += '  %double_val = call double @cJSON_GetNumberValue(i8* %item)\n';
    ir += '  %int_val = fptosi double %double_val to i32\n';
    ir += '  ret i32 %int_val\n';
    ir += '}\n\n';

    return ir;
  }

  // Generate HTTP server runtime - the actual implementation
  private generateHttpServerRuntime(): string {
    let ir = '; HTTP Server Runtime\n';
    ir += '; Struct for sockaddr_in (16 bytes)\n';
    ir += '%struct.sockaddr_in = type { i16, i16, i32, [8 x i8] }\n';
    ir += '\n';

    // Helper function to parse HTTP method from request
    ir += 'define i8* @parse_http_method(i8* %buffer) {\n';
    ir += 'entry:\n';
    ir += '  ; Extract method from "METHOD /path HTTP/1.1"\n';
    ir += '  ; For now, just return a pointer to the start\n';
    ir += '  ret i8* %buffer\n';
    ir += '}\n\n';

    // Helper function to parse HTTP path
    ir += 'define i8* @parse_http_path(i8* %buffer) {\n';
    ir += 'entry:\n';
    ir += '  ; Find first space (after method)\n';
    ir += '  %ptr = alloca i8*\n';
    ir += '  store i8* %buffer, i8** %ptr\n';
    ir += '  br label %loop\n\n';
    ir += 'loop:\n';
    ir += '  %curr_ptr = load i8*, i8** %ptr\n';
    ir += '  %char = load i8, i8* %curr_ptr\n';
    ir += '  %is_space = icmp eq i8 %char, 32\n'; // ASCII space
    ir += '  br i1 %is_space, label %found_space, label %continue\n\n';
    ir += 'continue:\n';
    ir += '  %next_ptr = getelementptr i8, i8* %curr_ptr, i32 1\n';
    ir += '  store i8* %next_ptr, i8** %ptr\n';
    ir += '  br label %loop\n\n';
    ir += 'found_space:\n';
    ir += '  ; Move past the space to get path start\n';
    ir += '  %path_start = getelementptr i8, i8* %curr_ptr, i32 1\n';
    ir += '  ret i8* %path_start\n';
    ir += '}\n\n';

    // Main HTTP server function
    ir += '; Main HTTP server function\n';
    ir += '; Takes port number and handler function pointer\n';
    ir += '; Handler signature: i32 handler(i8* method, i8* path)\n';
    ir += 'define i32 @http_serve(i32 %port, i32 (i8*, i8*)* %handler) {\n';
    ir += 'entry:\n';
    ir += '  ; Constants\n';
    ir += '  %AF_INET = alloca i32\n';
    ir += '  store i32 2, i32* %AF_INET\n';
    ir += '  %SOCK_STREAM = alloca i32\n';
    ir += '  store i32 1, i32* %SOCK_STREAM\n';
    ir += '  %af_inet = load i32, i32* %AF_INET\n';
    ir += '  %sock_stream = load i32, i32* %SOCK_STREAM\n';
    ir += '\n';
    ir += '  ; Create socket\n';
    ir += '  %sock = call i32 @socket(i32 %af_inet, i32 %sock_stream, i32 0)\n';
    ir += '  %sock_valid = icmp sge i32 %sock, 0\n';
    ir += '  br i1 %sock_valid, label %socket_ok, label %error\n\n';
    ir += 'socket_ok:\n';
    ir += '  ; Setup sockaddr_in\n';
    ir += '  %addr = alloca %struct.sockaddr_in\n';
    ir += '  %addr_family_ptr = getelementptr %struct.sockaddr_in, %struct.sockaddr_in* %addr, i32 0, i32 0\n';
    ir += '  store i16 2, i16* %addr_family_ptr\n'; // AF_INET
    ir += '  ; Convert port to network byte order\n';
    ir += '  %port_i16 = trunc i32 %port to i16\n';
    ir += '  %port_net = call i16 @htons(i16 %port_i16)\n';
    ir += '  %addr_port_ptr = getelementptr %struct.sockaddr_in, %struct.sockaddr_in* %addr, i32 0, i32 1\n';
    ir += '  store i16 %port_net, i16* %addr_port_ptr\n';
    ir += '  ; Set address to INADDR_ANY (0.0.0.0)\n';
    ir += '  %addr_addr_ptr = getelementptr %struct.sockaddr_in, %struct.sockaddr_in* %addr, i32 0, i32 2\n';
    ir += '  store i32 0, i32* %addr_addr_ptr\n';
    ir += '\n';
    ir += '  ; Bind socket\n';
    ir += '  %addr_cast = bitcast %struct.sockaddr_in* %addr to i8*\n';
    ir += '  %bind_result = call i32 @bind(i32 %sock, i8* %addr_cast, i32 16)\n';
    ir += '  %bind_ok = icmp sge i32 %bind_result, 0\n';
    ir += '  br i1 %bind_ok, label %bind_success, label %error\n\n';
    ir += 'bind_success:\n';
    ir += '  ; Listen for connections\n';
    ir += '  %listen_result = call i32 @listen(i32 %sock, i32 10)\n';
    ir += '  %listen_ok = icmp sge i32 %listen_result, 0\n';
    ir += '  br i1 %listen_ok, label %listen_success, label %error\n\n';
    ir += 'listen_success:\n';
    ir += '  ; Print server started message\n';
    ir += '  %fmt = getelementptr [29 x i8], [29 x i8]* @.str.http_started, i32 0, i32 0\n';
    ir += '  call i32 (i8*, ...) @printf(i8* %fmt, i32 %port)\n';
    ir += '  br label %accept_loop\n\n';
    ir += 'accept_loop:\n';
    ir += '  ; Accept incoming connection\n';
    ir += '  %client_sock = call i32 @accept(i32 %sock, i8* null, i8* null)\n';
    ir += '  %client_valid = icmp sge i32 %client_sock, 0\n';
    ir += '  br i1 %client_valid, label %handle_request, label %accept_loop\n\n';
    ir += 'handle_request:\n';
    ir += '  ; Read HTTP request (up to 4096 bytes)\n';
    ir += '  %buffer = alloca [4096 x i8]\n';
    ir += '  %buffer_ptr = getelementptr [4096 x i8], [4096 x i8]* %buffer, i32 0, i32 0\n';
    ir += '  %bytes_read = call i64 @read(i32 %client_sock, i8* %buffer_ptr, i64 4096)\n';
    ir += '\n';
    ir += '  ; Parse HTTP method and path\n';
    ir += '  %method = call i8* @parse_http_method(i8* %buffer_ptr)\n';
    ir += '  %path = call i8* @parse_http_path(i8* %buffer_ptr)\n';
    ir += '\n';
    ir += '  ; Call user handler\n';
    ir += '  %response_str = call i8* %handler(i8* %method, i8* %path)\n';
    ir += '\n';
    ir += '  ; Build HTTP response\n';
    ir += '  %response_buffer = alloca [8192 x i8]\n';
    ir += '  %response_ptr = getelementptr [8192 x i8], [8192 x i8]* %response_buffer, i32 0, i32 0\n';
    ir += '  %http_header = getelementptr [65 x i8], [65 x i8]* @.str.http_header, i32 0, i32 0\n';
    ir += '  %header_len = call i64 @strlen(i8* %http_header)\n';
    ir += '  call void @llvm.memcpy.p0i8.p0i8.i64(i8* %response_ptr, i8* %http_header, i64 %header_len, i1 false)\n';
    ir += '  %body_start = getelementptr i8, i8* %response_ptr, i64 %header_len\n';
    ir += '  %body_len = call i64 @strlen(i8* %response_str)\n';
    ir += '  call void @llvm.memcpy.p0i8.p0i8.i64(i8* %body_start, i8* %response_str, i64 %body_len, i1 false)\n';
    ir += '  %total_len = add i64 %header_len, %body_len\n';
    ir += '\n';
    ir += '  ; Send response\n';
    ir += '  %bytes_written = call i64 @write(i32 %client_sock, i8* %response_ptr, i64 %total_len)\n';
    ir += '\n';
    ir += '  ; Close client socket\n';
    ir += '  call i32 @close(i32 %client_sock)\n';
    ir += '  br label %accept_loop\n\n';
    ir += 'error:\n';
    ir += '  ret i32 1\n';
    ir += '}\n\n';

    // Add required string constants
    ir += '@.str.http_started = private constant [29 x i8] c"HTTP server listening on %d\\0A\\00"\n';
    ir += '@.str.http_header = private constant [65 x i8] c"HTTP/1.1 200 OK\\0D\\0AContent-Type: text/plain\\0D\\0AConnection: close\\0D\\0A\\0D\\0A\\00"\n';

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
  private syncStateToGenerators() {
    for (const gen of [this.arrayGen, this.stringGen, this.objectGen, this.mapGen, this.setGen, this.controlFlowGen, this.classGen, this.regexGen]) {
      gen.output = this.output;
      gen.globalStrings = this.globalStrings;
      gen.variables = this.variables;
      gen.variableTypes = this.variableTypes;  // CRITICAL: Share type tracking!
      gen.stringVariables = this.stringVariables;
      gen.arrayVariables = this.arrayVariables;
      gen.stringArrayVariables = this.stringArrayVariables;
      gen.objectVariables = this.objectVariables;
      gen.mapVariables = this.mapVariables;
      gen.setVariables = this.setVariables;
      gen.classInstanceVariables = this.classInstanceVariables;
      gen.regexVariables = this.regexVariables;
      gen.jsonObjectVariables = this.jsonObjectVariables;
      gen.thisPointer = this.thisPointer;
      gen.expectedArrayElementType = this.expectedArrayElementType;
    }
  }

  // Sync state FROM generators back to this (for thisPointer updates)
  private syncStateFromGenerators() {
    // Sync thisPointer from classGen back to this
    if (this.classGen.thisPointer !== null) {
      this.thisPointer = this.classGen.thisPointer;
    }
    // Sync variableTypes from classGen back to this (for types tracked during class method generation)
    for (const [key, value] of this.classGen.variableTypes.entries()) {
      this.variableTypes.set(key, value);
    }
  }
}
