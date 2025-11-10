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

// ============================================
// LLVM IR CODE GENERATOR - Main Orchestrator
// ============================================

export class LLVMGenerator extends BaseGenerator {
  private ast: AST;
  private externalFunctions: Set<string> = new Set();
  private liftedFunctions: FunctionNode[] = []; // Anonymous functions lifted to top level
  private anonFuncCounter: number = 0;

  // Top-level variables (accessible from all functions)
  private topLevelObjectVariables: Map<string, { ptr: string; keys: string[] }> = new Map();

  // Specialized generators
  private arrayGen: ArrayGenerator;
  private stringGen: StringGenerator;
  private objectGen: ObjectGenerator;
  private mapGen: MapGenerator;
  private setGen: SetGenerator;
  private controlFlowGen: ControlFlowGenerator;
  private classGen: ClassGenerator;
  private regexGen: RegexGenerator;

  constructor(ast: AST) {
    super();
    this.ast = ast;

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

    // Declare exit for process.exit()
    ir += 'declare void @exit(i32)\n';
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

    let ir = `define i32 @${func.name}(`;
    ir += func.params.map((_, i) => `i32 %arg${i}`).join(', ');
    ir += ') {\n';
    ir += 'entry:\n';

    // Allocate stack space for parameters so they can be treated like variables
    for (let i = 0; i < func.params.length; i++) {
      const paramName = func.params[i];
      const allocaReg = this.nextTemp();
      this.variables.set(paramName, allocaReg);
      this.emit(`${allocaReg} = alloca i32`);
      this.emit(`store i32 %arg${i}, i32* ${allocaReg}`);
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
      // If block returned a value, use it; otherwise return 0
      if (result !== null) {
        ir += `  ret i32 ${result}\n`;
      } else {
        ir += '  ret i32 0\n';
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

        // Determine if this is a string, array, string array, object, map, set, regex, class instance, or numeric value
        // NOTE: Check isStringArray BEFORE isArray since string arrays are also arrays
        const isString = this.isStringExpression(stmt.value);
        const isStringArray = this.isStringArrayExpression(stmt.value);
        const isArray = !isStringArray && this.isArrayExpression(stmt.value);
        const isObject = this.isObjectExpression(stmt.value);
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
        } else if (isObject) {
          // Allocate stack space for object pointer (i32*) BEFORE generating the expression
          const allocaReg = this.nextTemp();
          const keys = (stmt.value as any).type === 'object' ? (stmt.value as any).properties.map((p: any) => p.key) : [];
          this.objectVariables.set(stmt.name, { ptr: allocaReg, keys });
          this.emit(`${allocaReg} = alloca i32*`);

          // Now generate the expression
          const objExpr = this.generateExpression(stmt.value, params);
          this.emit(`store i32* ${objExpr}, i32** ${allocaReg}`);
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
          this.regexVariables.set(stmt.name, allocaReg);
          this.emit(`${allocaReg} = alloca i8*`);

          // Compute initial value and store it
          const value = this.generateExpression(stmt.value, params);
          this.emit(`store i8* ${value}, i8** ${allocaReg}`);
        } else if (isString) {
          // Allocate stack space for string pointer (i8*)
          const allocaReg = this.nextTemp();
          this.stringVariables.set(stmt.name, allocaReg);
          this.emit(`${allocaReg} = alloca i8*`);

          // Compute initial value and store it
          const value = this.generateExpression(stmt.value, params);
          this.emit(`store i8* ${value}, i8** ${allocaReg}`);
        } else {
          // Allocate stack space for i32
          const allocaReg = this.nextTemp();
          this.variables.set(stmt.name, allocaReg);
          this.emit(`${allocaReg} = alloca i32`);

          // Compute initial value and store it
          const value = this.generateExpression(stmt.value, params);
          this.emit(`store i32 ${value}, i32* ${allocaReg}`);
        }
      } else if (stmt.type === 'assignment') {
        // Check if this is a member access assignment (this.field = value)
        if (stmt.name.startsWith('__member_access__')) {
          // Extract property name and handle member access assignment
          const memberAccessValue = stmt.value as any;
          if (memberAccessValue.type === 'member_access_assignment') {
            const object = memberAccessValue.object;
            const property = memberAccessValue.property;
            const value = this.generateExpression(memberAccessValue.value, params);
            
            // Get instance pointer
            let instancePtr: string | null = null;
            let className: string | null = null;
            
            if (object.type === 'variable' && this.classInstanceVariables.has(object.name)) {
              const classMeta = this.classInstanceVariables.get(object.name)!;
              className = classMeta.className;
              instancePtr = this.generateExpression(object, params);
            } else if ((object as any).type === 'new') {
              const newExpr = object as any as NewNode;
              className = newExpr.className;
              instancePtr = this.generateExpression(object, params);
            } else if ((object as any).type === 'this') {
              if (!this.thisPointer) {
                throw new Error('this.field = value used outside of class method or constructor');
              }
              instancePtr = this.thisPointer;
              // Find class - simplified for now
              const classWithField = this.ast.classes.find(c => true);
              if (classWithField) {
                className = classWithField.name;
              }
            } else {
              throw new Error(`Cannot assign to property of ${object.type}`);
            }
            
            if (instancePtr && className) {
              // Get field info from class generator
              const fieldInfo = this.classGen.getFieldInfo(className, property);
              const fields = this.classGen.getClassFields(className);

              if (fieldInfo) {
                // Typed field - use struct getelementptr
                const fieldPtr = this.nextTemp();
                if (fields.length > 0) {
                  const llvmFieldType = fieldInfo.type === 'string' ? 'i8*' : 'i32';
                  this.emit(`${fieldPtr} = getelementptr inbounds %${className}_struct, %${className}_struct* ${instancePtr}, i32 0, i32 ${fieldInfo.index}`);

                  if (fieldInfo.type === 'string') {
                    // Store string pointer (i8*)
                    // Need to convert i32 to i8* if value came from constructor parameter
                    const strPtr = this.nextTemp();
                    this.emit(`${strPtr} = inttoptr i32 ${value} to i8*`);
                    this.emit(`store i8* ${strPtr}, i8** ${fieldPtr}`);
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
        return temp;
      }

      // Check if it's a regex variable
      const regexAllocaReg = this.regexVariables.get(expr.name);
      if (regexAllocaReg) {
        const temp = this.nextTemp();
        this.emit(`${temp} = load i8*, i8** ${regexAllocaReg}`);
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
        return temp;
      }

      // Check if it's a numeric variable
      if (!expr.name) {
        throw new Error(`Variable expression has no name property. Expression: ${JSON.stringify(expr, null, 2)}`);
      }
      const allocaReg = this.variables.get(expr.name);
      if (allocaReg) {
        const temp = this.nextTemp();
        this.emit(`${temp} = load i32, i32* ${allocaReg}`);
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

      // Check if accessing an object property (variable or literal)
      let objPtr: string;
      let keys: string[];

      if (expr.object.type === 'variable' && this.objectVariables.has(expr.object.name)) {
        // Object stored in variable
        const objMeta = this.objectVariables.get(expr.object.name)!;
        keys = objMeta.keys;
        
        // Load object pointer
        const objPtrPtr = objMeta.ptr;
        objPtr = this.nextTemp();
        this.emit(`${objPtr} = load i32*, i32** ${objPtrPtr}`);
      } else if ((expr.object as any).type === 'object') {
        // Object literal - generate it and extract keys
        const objExpr = expr.object as any;
        keys = objExpr.properties.map((p: any) => p.key);
        objPtr = this.generateExpression(expr.object, params);
      } else {
        // Not an object, fall through to .length handling
        keys = [];
        objPtr = '';
      }

      // If we have an object, access its property
      if (keys.length > 0 && objPtr) {
        const propIndex = keys.indexOf(expr.property);
        if (propIndex === -1) {
          const objDesc = expr.object.type === 'variable' ? expr.object.name : 'literal';
          throw new Error(`Unknown property: ${expr.property} on object ${objDesc}`);
        }

        // Get pointer to property field
        const fieldPtr = this.nextTemp();
        this.emit(`${fieldPtr} = getelementptr inbounds i32, i32* ${objPtr}, i32 ${propIndex}`);

        // Load property value
        const value = this.nextTemp();
        this.emit(`${value} = load i32, i32* ${fieldPtr}`);
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
      throw new Error(`Unknown property: ${expr.property}`);
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

      // Check if it's a string array first
      if (expr.object.type === 'variable' && this.stringArrayVariables.has(expr.object.name)) {
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
        return elem;
      }
      // Check if it's a numeric array
      else if (expr.object.type === 'variable' && this.arrayVariables.has(expr.object.name)) {
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

      const left = this.generateExpression(expr.left, params);
      const right = this.generateExpression(expr.right, params);

      if (arithMap[expr.op]) {
        const temp = this.nextTemp();
        const op = arithMap[expr.op];
        this.emit(`${temp} = ${op} i32 ${left}, ${right}`);
        return temp;
      } else if (cmpMap[expr.op]) {
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
      // Check if the object is a string
      const isString = this.isStringExpression(expr.object);
      if (isString) {
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
      // Check if the object is a string
      const isString = this.isStringExpression(expr.object);
      if (isString) {
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
    }

    if (method === 'repeat') {
      // Check if the object is a string
      const isString = this.isStringExpression(expr.object);
      if (isString) {
        this.syncStateToGenerators();
        const strPtr = this.generateExpression(expr.object, params);

        // repeat() takes 1 argument: count
        if (expr.args.length !== 1) {
          throw new Error(`repeat() expects 1 argument, got ${expr.args.length}`);
        }

        const count = this.generateExpression(expr.args[0], params);
        return this.stringGen.generateRepeat(strPtr, count);
      }
    }

    if (method === 'padStart') {
      // Check if the object is a string
      const isString = this.isStringExpression(expr.object);
      if (isString) {
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

    throw new Error(`Unknown method: ${method}`);
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
      return this.arrayVariables.has(expr.name);
    }
    // Check if it's a method call that returns an array (e.g., .filter(), .map())
    if (expr.type === 'method_call') {
      const method = (expr as any).method;
      return method === 'filter' || method === 'map'; // filter() and map() return new arrays
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
    if (expr.type === 'variable') {
      return this.stringVariables.has(expr.name);
    }
    if (expr.type === 'binary' && expr.op === '+') {
      return this.isStringExpression(expr.left) || this.isStringExpression(expr.right);
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
      if (indexExpr.object.type === 'variable' &&
          this.stringArrayVariables.has(indexExpr.object.name)) {
        return true;
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
          methodExpr.method === 'padStart') {
        return true;
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

  private isStringArrayExpression(expr: Expression): boolean {
    if (expr.type === 'variable') {
      return this.stringArrayVariables.has(expr.name);
    }
    // Check if it's an array literal with all string elements
    if (expr.type === 'array') {
      const elements = (expr as any).elements || [];
      return elements.length > 0 && elements.every((elem: Expression) => elem.type === 'string');
    }
    // Check if it's a method call that returns a StringArray (e.g., .split())
    if (expr.type === 'method_call') {
      const method = (expr as any).method;
      return method === 'split';
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

      // Determine if this is a string, array, string array, object, map, set, regex, class instance, or numeric value
      // NOTE: Check isStringArray BEFORE isArray since string arrays are also arrays
      const isString = this.isStringExpression(stmt.value);
      const isStringArray = this.isStringArrayExpression(stmt.value);
      const isArray = !isStringArray && this.isArrayExpression(stmt.value);
      const isObject = this.isObjectExpression(stmt.value);
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
      } else if (isObject) {
        // Allocate stack space for object pointer (i32*) BEFORE generating the expression
        const allocaReg = this.nextTemp();
        const keys = (stmt.value as any).type === 'object' ? (stmt.value as any).properties.map((p: any) => p.key) : [];
        this.objectVariables.set(stmt.name, { ptr: allocaReg, keys });
        this.emit(`${allocaReg} = alloca i32*`);

        // Now generate the expression
        const objExpr = this.generateExpression(stmt.value, []);
        this.emit(`store i32* ${objExpr}, i32** ${allocaReg}`);
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

    if (this.ast.entryPoint) {
      const result = this.generateExpression(this.ast.entryPoint, []);

      if (this.output.length > 0) {
        ir += this.output.map(line => '  ' + line).join('\n') + '\n';
      }

      ir += `  ret i32 ${result}\n`;
    } else {
      if (this.output.length > 0) {
        ir += this.output.map(line => '  ' + line).join('\n') + '\n';
      }
      ir += '  ret i32 0\n';
    }

    ir += '}\n';

    return ir;
  }

  // Sync state to sub-generators - share Maps/arrays by reference
  // Note: Counters are already shared via bound methods (nextTemp, nextLabel, nextString)
  private syncStateToGenerators() {
    for (const gen of [this.arrayGen, this.stringGen, this.objectGen, this.mapGen, this.setGen, this.controlFlowGen, this.classGen, this.regexGen]) {
      gen.output = this.output;
      gen.globalStrings = this.globalStrings;
      gen.variables = this.variables;
      gen.stringVariables = this.stringVariables;
      gen.arrayVariables = this.arrayVariables;
      gen.objectVariables = this.objectVariables;
      gen.mapVariables = this.mapVariables;
      gen.setVariables = this.setVariables;
      gen.classInstanceVariables = this.classInstanceVariables;
      gen.regexVariables = this.regexVariables;
      gen.thisPointer = this.thisPointer;
    }
  }

  // Sync state FROM generators back to this (for thisPointer updates)
  private syncStateFromGenerators() {
    // Sync thisPointer from classGen back to this
    if (this.classGen.thisPointer !== null) {
      this.thisPointer = this.classGen.thisPointer;
    }
  }
}
