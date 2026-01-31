/**
 * Method Call Expression Generator
 *
 * Handles method call expressions: object.method(args)
 *
 * Delegates to specialized generators based on the method type:
 * - ConsoleGenerator: console.log, console.error
 * - ProcessGenerator: process.exit
 * - FilesystemGenerator: fs.readFileSync, fs.writeFileSync, etc.
 * - PathGenerator: path.resolve, path.dirname
 * - JsonGenerator: JSON.parse, JSON.stringify
 * - MathGenerator: Math.*, etc.
 * - StringGenerator: string methods (substr, split, concat, etc.)
 * - ArrayGenerator: array methods (push, map, filter, etc.)
 * - MapGenerator: Map methods (set, get, has)
 * - SetGenerator: Set methods (add, has, delete)
 * - ClassGenerator: class instance methods
 * - RegexGenerator: regex.test
 *
 * This class acts as a dispatcher/orchestrator for method call routing.
 */

import { Expression } from '../../ast/types.js';

interface MethodCallNode {
  type: 'method_call';
  object: Expression;
  method: string;
  args: Expression[];
}

interface NewNode {
  type: 'new';
  className: string;
  args: Expression[];
}

export class MethodCallGenerator {
  constructor(private ctx: any) {}

  // Helper methods delegate to context
  private nextTemp() { return this.ctx.nextTemp(); }
  private emit(instruction: string) { this.ctx.emit(instruction); }
  private convertToI32(value: string): string {
    const temp = this.nextTemp();
    this.emit(`${temp} = fptosi double ${value} to i32`);
    return temp;
  }

  /**
   * Generate code for method call expression
   *
   * @example
   * Input: { type: 'method_call', object: str, method: 'substr', args: [0, 5] }
   * Output: result register with method call result
   */
  generate(expr: MethodCallNode, params: string[]): string {
    const method = expr.method;

    // Handle console.log and console.error (delegated to ConsoleGenerator)
    if (this.ctx.consoleGen.canHandle(expr)) {
      return this.ctx.consoleGen.generateConsoleCall(expr.method, expr.args, params);
    }

    // Handle process.exit() (delegated to ProcessGenerator)
    if (this.ctx.processGen.canHandle(expr)) {
      return this.ctx.processGen.generateProcessExit(expr, params);
    }

    // Handle fs.* methods (delegated to FilesystemGenerator)
    if (this.ctx.fsGen.canHandle(expr)) {
      switch (expr.method) {
        case 'readFileSync':
          return this.ctx.fsGen.generateReadFileSync(expr, params);
        case 'writeFileSync':
          return this.ctx.fsGen.generateWriteFileSync(expr, params);
        case 'existsSync':
          return this.ctx.fsGen.generateExistsSync(expr, params);
        case 'unlinkSync':
          return this.ctx.fsGen.generateUnlinkSync(expr, params);
        default:
          throw new Error('Unsupported fs method: ' + expr.method);
      }
    }

    // Handle path.resolve() and path.dirname() (delegated to PathGenerator)
    if (method === 'resolve' && expr.object.type === 'variable' && (expr.object as any).name === 'path') {
      return this.ctx.pathGen.generateResolve(expr, params);
    }
    if (method === 'dirname' && expr.object.type === 'variable' && (expr.object as any).name === 'path') {
      return this.ctx.pathGen.generateDirname(expr, params);
    }

    // Handle execSync() from child_process
    if (method === 'execSync' && expr.object.type === 'variable' &&
        ((expr.object as any).name === 'child_process' || (expr.object as any).name === 'cp')) {
      return this.handleExecSync(expr, params);
    }

    // Handle JSON.parse() and JSON.stringify() (delegated to JsonGenerator)
    if (this.ctx.jsonGen.canHandle(expr)) {
      if (method === 'parse') {
        return this.ctx.jsonGen.generateParse(expr, params);
      } else if (method === 'stringify') {
        return this.ctx.jsonGen.generateStringify(expr, params);
      }
    }

    // Handle Math.* methods (delegated to MathGenerator)
    if (this.ctx.mathGen.canHandle(expr)) {
      return this.ctx.mathGen.generateMathMethod(expr, params);
    }

    // Handle JSON.stringify() (legacy implementation)
    if (method === 'stringify' && expr.object.type === 'variable' && (expr.object as any).name === 'JSON') {
      return this.handleJsonStringify(expr, params);
    }

    // Handle regex methods
    if (method === 'test') {
      const isRegex = this.ctx.isRegexExpression(expr.object);
      if (isRegex) {
        return this.handleRegexTest(expr, params);
      }
    }

    // Handle Response methods (from fetch())
    if (method === 'text' || method === 'json') {
      try {
        this.ctx.syncStateToGenerators();
        const responsePtr = this.ctx.generateExpression(expr.object, params);

        if (method === 'text') {
          return this.ctx.responseGen.generateText(responsePtr);
        } else if (method === 'json') {
          return this.ctx.responseGen.generateJson(responsePtr);
        }
      } catch (e) {
        // Log error and rethrow so we can see what's happening
        console.error('[Response method error]:', e);
        throw e;
      }
    }

    // Handle string methods
    if (method === 'substr') {
      return this.handleSubstr(expr, params);
    }
    if (method === 'substring') {
      return this.handleSubstring(expr, params);
    }
    if (method === 'concat') {
      return this.handleConcat(expr, params);
    }
    if (method === 'repeat') {
      return this.handleRepeat(expr, params);
    }
    if (method === 'padStart') {
      return this.handlePadStart(expr, params);
    }
    if (method === 'split') {
      return this.handleSplit(expr, params);
    }
    if (method === 'startsWith') {
      return this.handleStartsWith(expr, params);
    }
    if (method === 'trim') {
      return this.handleTrim(expr, params);
    }
    if (method === 'indexOf') {
      return this.handleIndexOf(expr, params);
    }
    if (method === 'includes' && !this.ctx.isArrayExpression(expr.object) && !this.ctx.isStringArrayExpression(expr.object)) {
      return this.handleStringIncludes(expr, params);
    }
    if (method === 'slice') {
      return this.handleSlice(expr, params);
    }
    if (method === 'charAt') {
      return this.handleCharAt(expr, params);
    }

    // Handle Map methods
    if (method === 'set' || method === 'get' || method === 'has') {
      if (expr.object.type === 'variable' && this.ctx.symbolTable.isMap(expr.object.name)) {
        this.ctx.syncStateToGenerators();
        if (method === 'set') {
          return this.ctx.mapGen.generateMapSet(expr, params, this.ctx.generateExpression.bind(this.ctx));
        } else if (method === 'get') {
          return this.ctx.mapGen.generateMapGet(expr, params, this.ctx.generateExpression.bind(this.ctx));
        } else {
          return this.ctx.mapGen.generateMapHas(expr, params, this.ctx.generateExpression.bind(this.ctx));
        }
      }
    }

    // Handle Set methods
    if (method === 'add' || method === 'has' || method === 'delete') {
      if (expr.object.type === 'variable' && this.ctx.symbolTable.isSet(expr.object.name)) {
        this.ctx.syncStateToGenerators();
        if (method === 'add') {
          return this.ctx.setGen.generateSetAdd(expr, params, this.ctx.generateExpression.bind(this.ctx));
        } else if (method === 'has') {
          return this.ctx.setGen.generateSetHas(expr, params, this.ctx.generateExpression.bind(this.ctx));
        } else {
          return this.ctx.setGen.generateSetDelete(expr, params, this.ctx.generateExpression.bind(this.ctx));
        }
      }
    }

    // Handle array methods (arrayGen uses context pattern - no sync needed! 🎯)
    if (method === 'push') {
      return this.ctx.arrayGen.generateArrayPush(expr, params, this.ctx.generateExpression.bind(this.ctx));
    } else if (method === 'pop') {
      return this.ctx.arrayGen.generateArrayPop(expr, params, this.ctx.generateExpression.bind(this.ctx));
    } else if (method === 'includes' && this.ctx.isArrayExpression(expr.object)) {
      return this.ctx.arrayGen.generateArrayIncludes(expr, params, this.ctx.generateExpression.bind(this.ctx));
    } else if (method === 'map') {
      return this.ctx.arrayGen.generateArrayMap(expr, params, this.ctx.generateExpression.bind(this.ctx));
    } else if (method === 'join') {
      return this.ctx.arrayGen.generateArrayJoin(expr, params, this.ctx.generateExpression.bind(this.ctx));
    } else if (method === 'find') {
      return this.ctx.arrayGen.generateArrayFind(expr, params, this.ctx.generateExpression.bind(this.ctx));
    } else if (method === 'some') {
      return this.ctx.arrayGen.generateArraySome(expr, params, this.ctx.generateExpression.bind(this.ctx));
    } else if (method === 'filter') {
      return this.ctx.arrayGen.generateArrayFilter(expr, params, this.ctx.generateExpression.bind(this.ctx));
    } else if (method === 'forEach') {
      return this.ctx.arrayGen.generateArrayForEach(expr, params, this.ctx.generateExpression.bind(this.ctx));
    }

    // Handle class instance methods
    const classResult = this.handleClassMethods(expr, params);
    if (classResult !== null) {
      return classResult;
    }

    // Handle object methods
    const objectResult = this.handleObjectMethods(expr, params);
    if (objectResult !== null) {
      return objectResult;
    }

    // Build a helpful error message with supported methods
    this.throwUnsupportedMethodError(method);
  }

  private handleExecSync(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      throw new Error('execSync() requires 1 argument (command)');
    }

    this.ctx.syncStateToGenerators();

    // Get command argument
    const commandPtr = this.ctx.generateExpression(expr.args[0], params);

    // Call system: system(command) returns exit code
    const result = this.nextTemp();
    this.emit(`\${result} = call i32 @system(i8* \${commandPtr})`);

    return result;
  }

  private handleJsonStringify(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      throw new Error('JSON.stringify() requires 1 argument');
    }

    this.ctx.syncStateToGenerators();

    const arg = expr.args[0];

    // Check if it's a string
    if (this.ctx.isStringExpression(arg)) {
      const strPtr = this.ctx.generateExpression(arg, params);

      // For strings, we need to add quotes: "value"
      // Calculate: 2 (quotes) + strlen + 1 (null) = strlen + 3
      const strLen = this.nextTemp();
      this.emit(`\${strLen} = call i64 @strlen(i8* \${strPtr})`);
      const bufferSize = this.nextTemp();
      this.emit(`\${bufferSize} = add i64 \${strLen}, 3`);
      const buffer = this.nextTemp();
      this.emit(`\${buffer} = call i8* @GC_malloc_atomic(i64 \${bufferSize})`);

      // Create format string: "\"%s\""
      const formatStr = this.ctx.stringGen.createStringConstant('"%s"');
      const sprintfResult = this.nextTemp();
      this.emit(`\${sprintfResult} = call i32 (i8*, i8*, ...) @sprintf(i8* \${buffer}, i8* \${formatStr}, i8* \${strPtr})`);

      return buffer;
    } else {
      // For numbers, convert to string
      const numValue = this.ctx.generateExpression(arg, params);

      // Allocate buffer for number string (30 chars should be enough for double)
      const buffer = this.nextTemp();
      this.emit(`\${buffer} = call i8* @GC_malloc_atomic(i64 30)`);

      // Create format string: "%f"
      const formatStr = this.ctx.stringGen.createStringConstant('%f');
      const sprintfResult = this.nextTemp();
      this.emit(`\${sprintfResult} = call i32 (i8*, i8*, ...) @sprintf(i8* \${buffer}, i8* \${formatStr}, double \${numValue})`);

      return buffer;
    }
  }

  private handleRegexTest(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const regexPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length !== 1) {
      throw new Error(`test() expects 1 argument, got \${expr.args.length}`);
    }

    const testStr = this.ctx.generateExpression(expr.args[0], params);
    return this.ctx.regexGen.generateRegexTest(regexPtr, testStr);
  }

  private handleSubstr(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length < 1 || expr.args.length > 2) {
      throw new Error(`substr() expects 1 or 2 arguments, got \${expr.args.length}`);
    }

    const startIndexDouble = this.ctx.generateExpression(expr.args[0], params);
    const startIndex = this.convertToI32(startIndexDouble);
    const length = expr.args.length === 2 ? this.convertToI32(this.ctx.generateExpression(expr.args[1], params)) : null;

    return this.ctx.stringGen.generateSubstr(strPtr, startIndex, length);
  }

  private handleSubstring(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length < 1 || expr.args.length > 2) {
      throw new Error(`substring() expects 1 or 2 arguments, got \${expr.args.length}`);
    }

    const startIndexDouble = this.ctx.generateExpression(expr.args[0], params);
    const startIndex = this.convertToI32(startIndexDouble);

    let length: string | null = null;
    if (expr.args.length === 2) {
      const endIndexDouble = this.ctx.generateExpression(expr.args[1], params);
      const endIndex = this.convertToI32(endIndexDouble);
      length = this.nextTemp();
      this.emit(`\${length} = sub i32 \${endIndex}, \${startIndex}`);
    }

    return this.ctx.stringGen.generateSubstr(strPtr, startIndex, length);
  }

  private handleConcat(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length < 1) {
      throw new Error(`concat() expects at least 1 argument, got \${expr.args.length}`);
    }

    let result = strPtr;
    for (const arg of expr.args) {
      const argStr = this.ctx.generateExpression(arg, params);
      result = this.ctx.stringGen.generateStringConcatDirect(result, argStr);
    }

    return result;
  }

  private handleRepeat(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length !== 1) {
      throw new Error(`repeat() expects 1 argument, got \${expr.args.length}`);
    }

    const countDouble = this.ctx.generateExpression(expr.args[0], params);
    const count = this.convertToI32(countDouble);
    return this.ctx.stringGen.generateRepeat(strPtr, count);
  }

  private handlePadStart(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length < 1 || expr.args.length > 2) {
      throw new Error(`padStart() expects 1 or 2 arguments, got \${expr.args.length}`);
    }

    const targetLengthDouble = this.ctx.generateExpression(expr.args[0], params);
    const targetLength = this.convertToI32(targetLengthDouble);
    const padString = expr.args.length === 2
      ? this.ctx.generateExpression(expr.args[1], params)
      : this.ctx.stringGen.createStringConstant(' ');

    return this.ctx.stringGen.generatePadStart(strPtr, targetLength, padString);
  }

  private handleSplit(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length !== 1) {
      throw new Error(`split() expects 1 argument, got \${expr.args.length}`);
    }

    const delimiter = this.ctx.generateExpression(expr.args[0], params);
    return this.ctx.stringGen.generateSplit(strPtr, delimiter);
  }

  private handleStartsWith(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length !== 1) {
      throw new Error(`startsWith() expects 1 argument, got \${expr.args.length}`);
    }

    const prefix = this.ctx.generateExpression(expr.args[0], params);
    return this.ctx.stringGen.generateStartsWith(strPtr, prefix);
  }

  private handleTrim(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length !== 0) {
      throw new Error(`trim() expects 0 arguments, got \${expr.args.length}`);
    }

    return this.ctx.stringGen.generateTrim(strPtr);
  }

  private handleIndexOf(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length !== 1) {
      throw new Error(`indexOf() expects 1 argument, got \${expr.args.length}`);
    }

    const substring = this.ctx.generateExpression(expr.args[0], params);
    return this.ctx.stringGen.generateIndexOf(strPtr, substring);
  }

  private handleStringIncludes(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length !== 1) {
      throw new Error(`includes() expects 1 argument, got \${expr.args.length}`);
    }

    const substring = this.ctx.generateExpression(expr.args[0], params);
    return this.ctx.stringGen.generateIncludes(strPtr, substring);
  }

  private handleSlice(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length < 1 || expr.args.length > 2) {
      throw new Error(`slice() expects 1 or 2 arguments, got \${expr.args.length}`);
    }

    const startDouble = this.ctx.generateExpression(expr.args[0], params);
    const startI32 = this.nextTemp();
    this.emit(`\${startI32} = fptosi double \${startDouble} to i32`);

    let endI32: string | null = null;
    if (expr.args.length === 2) {
      const endDouble = this.ctx.generateExpression(expr.args[1], params);
      endI32 = this.nextTemp();
      this.emit(`\${endI32} = fptosi double \${endDouble} to i32`);
    }

    return this.ctx.stringGen.generateSlice(strPtr, startI32, endI32);
  }

  private handleCharAt(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length !== 1) {
      throw new Error('charAt() expects 1 argument, got ' + expr.args.length);
    }

    const indexDouble = this.ctx.generateExpression(expr.args[0], params);
    const indexI32 = this.ctx.nextTemp();
    this.ctx.emit(indexI32 + ' = fptosi double ' + indexDouble + ' to i32');
    return this.ctx.stringGen.generateCharAt(strPtr, indexI32);
  }

  private handleClassMethods(expr: MethodCallNode, params: string[]): string | null {
    const method = expr.method;
    let className: string | null = null;
    let instancePtr: string | null = null;

    if (expr.object.type === 'variable' && this.ctx.symbolTable.isClass(expr.object.name)) {
      const classMeta = this.ctx.symbolTable.getClassInfo(expr.object.name)!;
      className = classMeta.className;
      instancePtr = this.ctx.generateExpression(expr.object, params);
    } else if ((expr.object as any).type === 'new') {
      const newExpr = expr.object as any as NewNode;
      className = newExpr.className;
      instancePtr = this.ctx.generateExpression(expr.object, params);
    } else if ((expr.object as any).type === 'this') {
      if (!this.ctx.thisPointer) {
        throw new Error('this.method() called outside of class method');
      }
      instancePtr = this.ctx.thisPointer;
      const classWithMethod = this.ctx.ast.classes.find((c: any) =>
        c.methods.some((m: any) => m.name === method && !m.isConstructor)
      );
      if (!classWithMethod) {
        throw new Error(`Method \${method} not found in any class`);
      }
      className = classWithMethod.name;
    } else if ((expr.object as any).type === 'super') {
      if (!this.ctx.thisPointer) {
        throw new Error('super.method() called outside of class method');
      }
      if (!this.ctx.currentClassName) {
        throw new Error('super.method() called outside of class context');
      }
      const currentClass = this.ctx.ast.classes.find((c: any) => c.name === this.ctx.currentClassName);
      if (!currentClass || !currentClass.extends) {
        throw new Error(`super.method() called but current class \${this.ctx.currentClassName} has no parent class`);
      }
      instancePtr = this.ctx.thisPointer;
      className = currentClass.extends;

      if (method === '') {
        return '0'; // super() constructor call - no-op for now
      }
    }

    if (className && instancePtr) {
      const classNode = this.ctx.ast.classes.find((c: any) => c.name === className);
      if (!classNode) {
        throw new Error(`Class \${className} not found`);
      }
      const methodExists = classNode.methods.some((m: any) => m.name === method && !m.isConstructor);
      if (!methodExists) {
        throw new Error(`Method \${method} not found in class \${className}`);
      }

      this.ctx.syncStateToGenerators();
      return this.ctx.classGen.generateMethodCall(instancePtr, className, method, expr.args, params);
    }

    return null;
  }

  private handleObjectMethods(expr: MethodCallNode, params: string[]): string | null {
    const method = expr.method;
    let isObjectMethod = false;

    if (expr.object.type === 'variable' && this.ctx.symbolTable.isObject(expr.object.name)) {
      const objMeta = this.ctx.symbolTable.getObjectInfo(expr.object.name)!;
      isObjectMethod = objMeta.keys.includes(method);
    } else if ((expr.object as any).type === 'object') {
      const objExpr = expr.object as any;
      isObjectMethod = objExpr.properties.some((p: any) => p.key === method);
    }

    if (!isObjectMethod) {
      return null;
    }

    const funcExists = this.ctx.ast.functions.some((f: any) => f.name === method);
    if (!funcExists) {
      throw new Error(`Function \${method} not found for object method call`);
    }

    // Get function type from type checker for correct parameter/return types
    let returnType = 'double';
    let paramTypes: string[] = [];

    if (this.ctx.typeChecker) {
      try {
        const funcType = this.ctx.typeChecker.getFunctionType(method);
        if (funcType) {
          returnType = funcType.returnType === 'string' ? 'i8*' : 'double';
          paramTypes = funcType.parameters.map((p: any) => p.type === 'string' ? 'i8*' : 'double');
        }
      } catch (e) {
        // Fall back to double
      }
    }

    // Generate arguments
    const args = expr.args.map((arg, i) => {
      const result = this.ctx.generateExpression(arg, params);
      const paramType = paramTypes[i] || 'double';
      return `\${paramType} \${result}`;
    }).join(', ');

    const temp = this.nextTemp();
    this.emit(`\${temp} = call \${returnType} @\${method}(\${args})`);
    return temp;
  }

  private throwUnsupportedMethodError(method: string): never {
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
      `\\x1b[33mSupported methods:\\x1b[0m\\n\\n` +
      `\\x1b[36mString methods:\\x1b[0m\\n  \${stringMethods.join(', ')}\\n\\n` +
      `\\x1b[36mArray methods:\\x1b[0m\\n  \${arrayMethods.join(', ')}\\n\\n` +
      `\\x1b[36mMap methods:\\x1b[0m\\n  \${mapMethods.join(', ')}\\n\\n` +
      `\\x1b[36mSet methods:\\x1b[0m\\n  \${setMethods.join(', ')}\\n\\n` +
      `\\x1b[36mOther built-in methods:\\x1b[0m\\n  \${otherMethods.join(', ')}\\n\\n` +
      `\\x1b[33mIf you need '\${method}', consider:\\x1b[0m\\n` +
      `  • Using a similar method from the list above\\n` +
      `  • Implementing it using supported operations\\n` +
      `  • Opening an issue: https://github.com/your-repo/issues`;

    throw new Error(this.ctx.formatCodegenError(
      `Method '\${method}' is not supported yet.`,
      suggestion
    ));
  }
}
