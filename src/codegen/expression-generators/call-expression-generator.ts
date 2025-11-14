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

    // Handle fetch() special built-in function
    if (expr.name === 'fetch') {
      if (expr.args.length < 1) {
        throw new Error('fetch() requires at least 1 argument (URL)');
      }
      const urlValue = generateExpressionFn(expr.args[0], params);
      const temp = this.ctx.nextTemp();
      this.ctx.emit(`${temp} = call i8* @fetch(i8* ${urlValue})`);
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
    // Get function type from type checker for correct parameter/return types
    let returnType = 'double';
    let paramTypes: string[] = [];

    if (this.ctx.typeChecker) {
      try {
        const funcType = this.ctx.typeChecker.getFunctionType(expr.name);
        if (funcType) {
          returnType = funcType.returnType === 'string' ? 'i8*' : 'double';
          paramTypes = funcType.parameters.map((p: any) => {
            if (p.type === 'string') return 'i8*';
            if (p.type !== 'number' && p.type !== 'boolean') return 'i32'; // Object/interface
            return 'double'; // number/boolean
          });
        }
      } catch (e) {
        // Fall back to double
      }
    }

    const args = expr.args.map((arg: any, i: number) => {
      const result = generateExpressionFn(arg, params);
      const paramType = paramTypes[i] || 'double';
      return `${paramType} ${result}`;
    }).join(', ');

    const temp = this.ctx.nextTemp();
    this.ctx.emit(`${temp} = call ${returnType} @${expr.name}(${args})`);

    return temp;
  }
}
