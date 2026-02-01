import { Expression } from '../../ast/types.js';

/**
 * CallExpressionGenerator
 *
 * Handles function call expressions:
 * - Built-in functions (httpServe, fetch, parseInt)
 * - C library functions (malloc, free, socket, close, htons)
 * - User-defined functions with type checking
 */
export class CallExpressionGenerator {
  constructor(private ctx: any) {}

  /**
   * Generate function call expression
   * @param expr - Call expression node
   * @param params - Function parameter names
   * @param generateExpressionFn - Callback to generate sub-expressions
   */
  generate(expr: any, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    // Handle httpServe() special built-in function
    if (expr.name === 'httpServe') {
      return this.ctx.generateHttpServe(expr, params);
    }

    // Handle setTimeout() - libuv timer (one-shot)
    if (expr.name === 'setTimeout') {
      return this.generateSetTimeout(expr, params, generateExpressionFn);
    }

    // Handle setInterval() - libuv timer (repeating)
    if (expr.name === 'setInterval') {
      return this.generateSetInterval(expr, params, generateExpressionFn);
    }

    // Handle clearTimeout() / clearInterval() - stop timer
    if (expr.name === 'clearTimeout' || expr.name === 'clearInterval') {
      return this.generateClearTimer(expr, params, generateExpressionFn);
    }

    // Handle runEventLoop() - run libuv event loop
    if (expr.name === 'runEventLoop') {
      return this.generateRunEventLoop();
    }

    // Handle fetch() special built-in function
    // Returns a Promise that resolves to a Response object
    if (expr.name === 'fetch') {
      if (expr.args.length < 1) {
        throw new Error('fetch() requires at least 1 argument (URL)');
      }
      const urlValue = generateExpressionFn(expr.args[0], params);
      const temp = this.ctx.nextTemp();
      this.ctx.usesPromises = true;
      this.ctx.emit(`${temp} = call %Promise* @fetch_async(i8* ${urlValue})`);
      this.ctx.variableTypes.set(temp, '%Promise*');
      return temp;
    }

    // Handle parseInt(str, radix?) global function
    if (expr.name === 'parseInt') {
      return this.generateParseInt(expr, params, generateExpressionFn);
    }

    // Handle C built-in functions with proper signatures
    if (expr.name === 'malloc') {
      return this.generateMalloc(expr, params, generateExpressionFn);
    }

    if (expr.name === 'free') {
      return this.generateFree(expr, params, generateExpressionFn);
    }

    if (expr.name === 'socket') {
      return this.generateSocket(expr, params, generateExpressionFn);
    }

    if (expr.name === 'close') {
      return this.generateClose(expr, params, generateExpressionFn);
    }

    if (expr.name === 'htons') {
      return this.generateHtons(expr, params, generateExpressionFn);
    }

    // Generic function call with type checking
    return this.generateGenericCall(expr, params, generateExpressionFn);
  }

  private generateParseInt(expr: any, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    if (expr.args.length < 1 || expr.args.length > 2) {
      throw new Error('parseInt() requires 1 or 2 arguments (string, radix?)');
    }

    this.ctx.syncStateToGenerators();

    // Get the string argument
    const strValue = generateExpressionFn(expr.args[0], params);

    // Get the radix argument (default to 10 if not provided)
    let radixValue: string;
    if (expr.args.length === 2) {
      const radixDouble = generateExpressionFn(expr.args[1], params);
      // Convert double to i32
      radixValue = this.ctx.nextTemp();
      this.ctx.emit(`${radixValue} = fptosi double ${radixDouble} to i32`);
    } else {
      // Default radix is 10
      radixValue = '10';
    }

    // Call strtol(str, null, radix)
    // strtol returns i64, we'll truncate to i32 and then convert to double
    const nullPtr = this.ctx.nextTemp();
    this.ctx.emit(`${nullPtr} = inttoptr i32 0 to i8**`);

    const resultI64 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI64} = call i64 @strtol(i8* ${strValue}, i8** ${nullPtr}, i32 ${radixValue})`);

    // Convert i64 to double for compatibility with ChadScript's numeric type
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i64 ${resultI64} to double`);

    return resultDouble;
  }

  private generateMalloc(expr: any, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    // malloc(size: number) -> i8*
    const sizeDouble = generateExpressionFn(expr.args[0], params);
    const sizeI64 = this.ctx.nextTemp();
    this.ctx.emit(`${sizeI64} = fptosi double ${sizeDouble} to i64`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i8* @malloc(i64 ${sizeI64})`);
    // Store pointer as i32 for compatibility
    const resultI32 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI32} = ptrtoint i8* ${result} to i32`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  private generateFree(expr: any, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    // free(ptr: number) -> void
    const ptrDouble = generateExpressionFn(expr.args[0], params);
    const ptrI32 = this.ctx.nextTemp();
    this.ctx.emit(`${ptrI32} = fptosi double ${ptrDouble} to i32`);
    const ptr = this.ctx.nextTemp();
    this.ctx.emit(`${ptr} = inttoptr i32 ${ptrI32} to i8*`);
    this.ctx.emit(`call void @free(i8* ${ptr})`);
    return '0.0'; // Return dummy value
  }

  private generateSocket(expr: any, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    // socket(domain: number, type: number, protocol: number) -> i32
    const domainDouble = generateExpressionFn(expr.args[0], params);
    const typeDouble = generateExpressionFn(expr.args[1], params);
    const protocolDouble = generateExpressionFn(expr.args[2], params);
    const domain = this.ctx.nextTemp();
    this.ctx.emit(`${domain} = fptosi double ${domainDouble} to i32`);
    const type = this.ctx.nextTemp();
    this.ctx.emit(`${type} = fptosi double ${typeDouble} to i32`);
    const protocol = this.ctx.nextTemp();
    this.ctx.emit(`${protocol} = fptosi double ${protocolDouble} to i32`);
    const resultI32 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI32} = call i32 @socket(i32 ${domain}, i32 ${type}, i32 ${protocol})`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  private generateClose(expr: any, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    // close(fd: number) -> i32
    const fdDouble = generateExpressionFn(expr.args[0], params);
    const fd = this.ctx.nextTemp();
    this.ctx.emit(`${fd} = fptosi double ${fdDouble} to i32`);
    const resultI32 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI32} = call i32 @close(i32 ${fd})`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  private generateHtons(expr: any, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    // htons(hostshort: number) -> i16
    const hostshortDouble = generateExpressionFn(expr.args[0], params);
    const hostshort = this.ctx.nextTemp();
    this.ctx.emit(`${hostshort} = fptosi double ${hostshortDouble} to i16`);
    const resultI16 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI16} = call i16 @htons(i16 ${hostshort})`);
    const resultI32 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI32} = zext i16 ${resultI16} to i32`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  private generateGenericCall(expr: any, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    if (this.ctx.symbolTable.isClosure(expr.name)) {
      return this.generateClosureCall(expr, params, generateExpressionFn);
    }

    let returnType = 'double';
    let paramTypes: string[] = [];

    const func = this.ctx.ast.functions?.find((f: any) => f.name === expr.name);
    const hasOptionalParams = func?.parameters?.some((p: any) => p.optional || p.defaultValue);

    if (func && func.async) {
      returnType = '%Promise*';
      this.ctx.usesPromises = true;
    } else if (func && func.paramTypes && func.paramTypes.length > 0) {
      if (func.returnType === 'string') {
        returnType = 'i8*';
      } else if (func.returnType && func.returnType !== 'number' && func.returnType !== 'boolean' && func.returnType !== 'void') {
        returnType = 'i8*';
      }
      paramTypes = func.paramTypes.map((p: string) => {
        if (p === 'string') return 'i8*';
        if (p === 'string[]') return '%StringArray*';
        if (p === 'number[]' || p === 'boolean[]') return '%Array*';
        if (p !== 'number' && p !== 'boolean') return 'i8*';
        return 'double';
      });
    } else if (this.ctx.typeChecker) {
      try {
        const funcType = this.ctx.typeChecker.getFunctionType(expr.name);
        if (funcType) {
          if (funcType.returnType === 'string') {
            returnType = 'i8*';
          } else if (funcType.returnType !== 'number' && funcType.returnType !== 'boolean' && funcType.returnType !== 'void') {
            returnType = 'i8*';
          }
          paramTypes = funcType.parameters.map((p: any) => {
            if (p.type === 'string') return 'i8*';
            if (p.type === 'string[]') return '%StringArray*';
            if (p.type === 'number[]' || p.type === 'boolean[]') return '%Array*';
            if (p.type !== 'number' && p.type !== 'boolean') return 'i8*';
            return 'double';
          });
        }
      } catch (e) {
      }
    }

    const argsList: string[] = [];

    if (hasOptionalParams) {
      argsList.push(`i32 ${expr.args.length}`);
    }

    for (let i = 0; i < (func?.params?.length || expr.args.length); i++) {
      if (i < expr.args.length) {
        const result = generateExpressionFn(expr.args[i], params);
        const paramType = paramTypes[i] || 'double';
        argsList.push(`${paramType} ${result}`);
      } else {
        const paramType = paramTypes[i] || 'double';
        const defaultVal = paramType === 'double' ? '0.0' : 'null';
        argsList.push(`${paramType} ${defaultVal}`);
      }
    }

    const temp = this.ctx.nextTemp();
    this.ctx.emit(`${temp} = call ${returnType} @${expr.name}(${argsList.join(', ')})`);
    this.ctx.variableTypes.set(temp, returnType);

    return temp;
  }

  private generateClosureCall(expr: any, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    const closureMetadata = this.ctx.symbolTable.getClosureMetadata(expr.name);
    if (!closureMetadata) {
      throw new Error(`Closure metadata not found for: ${expr.name}`);
    }

    const { lambdaName, envPtrRegister, captures } = closureMetadata;

    const returnType = 'double';

    const argsList: string[] = [];
    if (captures && captures.length > 0) {
      argsList.push(`i8* ${envPtrRegister}`);
    } else {
      argsList.push('i8* null');
    }

    for (const arg of expr.args) {
      const result = generateExpressionFn(arg, params);
      argsList.push(`double ${result}`);
    }

    const temp = this.ctx.nextTemp();
    this.ctx.emit(`${temp} = call ${returnType} @${lambdaName}(${argsList.join(', ')})`);
    this.ctx.variableTypes.set(temp, returnType);

    return temp;
  }

  private generateSetTimeout(expr: any, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    if (expr.args.length < 2) {
      throw new Error('setTimeout() requires 2 arguments (callback, delay_ms)');
    }

    this.ctx.usesTimers = true;

    const callbackArg = expr.args[0];
    if (!callbackArg.name) {
      throw new Error('setTimeout() callback must be a function reference');
    }
    const callbackName = callbackArg.name;

    const delayValue = generateExpressionFn(expr.args[1], params);

    const callbackPtr = this.ctx.nextTemp();
    this.ctx.emit(`${callbackPtr} = bitcast void ()* @${callbackName} to void ()*`);

    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i8* @__setTimeout(void ()* ${callbackPtr}, double ${delayValue})`);
    this.ctx.variableTypes.set(result, 'i8*');

    return result;
  }

  private generateSetInterval(expr: any, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    if (expr.args.length < 2) {
      throw new Error('setInterval() requires 2 arguments (callback, interval_ms)');
    }

    this.ctx.usesTimers = true;

    const callbackArg = expr.args[0];
    if (!callbackArg.name) {
      throw new Error('setInterval() callback must be a function reference');
    }
    const callbackName = callbackArg.name;

    const intervalValue = generateExpressionFn(expr.args[1], params);

    const callbackPtr = this.ctx.nextTemp();
    this.ctx.emit(`${callbackPtr} = bitcast void ()* @${callbackName} to void ()*`);

    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i8* @__setInterval(void ()* ${callbackPtr}, double ${intervalValue})`);
    this.ctx.variableTypes.set(result, 'i8*');

    return result;
  }

  private generateClearTimer(expr: any, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    if (expr.args.length < 1) {
      throw new Error('clearTimeout/clearInterval requires 1 argument (timer_id)');
    }

    const timerIdValue = generateExpressionFn(expr.args[0], params);

    this.ctx.emit(`call void @__clearTimer(i8* ${timerIdValue})`);

    return '0.0';
  }

  private generateRunEventLoop(): string {
    this.ctx.usesTimers = true;
    this.ctx.emit('call void @__runEventLoop()');
    return '0.0';
  }
}
