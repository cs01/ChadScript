import { CallNode, FunctionNode, VariableNode, FunctionParameter, ClassNode } from '../../ast/types.js';
import { IGeneratorContext } from '../infrastructure/generator-context.js';
import { stripNullable, mapParamTypeToLLVM, mapReturnTypeToLLVM } from '../infrastructure/type-system.js';

/**
 * CallExpressionGenerator
 *
 * Handles function call expressions:
 * - Built-in functions (httpServe, fetch, parseInt)
 * - C library functions (malloc, free, socket, close, htons)
 * - User-defined functions with type checking
 */
export class CallExpressionGenerator {
  constructor(private ctx: IGeneratorContext) {}

  private getFunctionFromAST(name: string): FunctionNode | null {
    const ast = this.ctx.getAst();
    if (!ast || !ast.functions) return null;
    const resolvedName = this.ctx.resolveImportAlias(name);
    for (let i = 0; i < ast.functions.length; i++) {
      const fn = ast.functions[i] as FunctionNode;
      if (fn.name === resolvedName) {
        return fn;
      }
    }
    return null;
  }

  /**
   * Generate function call expression
   * @param expr - Call expression node
   * @param params - Function parameter names
   */
  generate(expr: CallNode, params: string[]): string {
    // Handle super() constructor call
    if (expr.name === 'super') {
      return this.generateSuperCall(expr, params);
    }

    if (expr.name === '__gc_disable') {
      this.ctx.emit('call void @GC_disable()');
      return '0.0';
    }

    if (expr.name === '__gc_enable') {
      this.ctx.emit('call void @GC_enable()');
      return '0.0';
    }

    if (expr.name === 'execSync') {
      return this.generateExecSync(expr, params);
    }

    // Handle httpServe() special built-in function
    if (expr.name === 'httpServe') {
      return this.ctx.generateHttpServe(expr, params);
    }

    // Handle wsBroadcast() - broadcast message to all WebSocket clients
    if (expr.name === 'wsBroadcast') {
      return this.ctx.generateWsBroadcast(expr, params);
    }

    // Handle setTimeout() - libuv timer (one-shot)
    if (expr.name === 'setTimeout') {
      return this.generateSetTimeout(expr, params);
    }

    // Handle setInterval() - libuv timer (repeating)
    if (expr.name === 'setInterval') {
      return this.generateSetInterval(expr, params);
    }

    // Handle clearTimeout() / clearInterval() - stop timer
    if (expr.name === 'clearTimeout' || expr.name === 'clearInterval') {
      return this.generateClearTimer(expr, params);
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
      const urlValue = this.ctx.generateExpression(expr.args[0], params);
      const temp = this.ctx.nextTemp();
      this.ctx.setUsesPromises(true);
      this.ctx.setUsesCurl(true);
      this.ctx.setUsesJson(true);
      this.ctx.emit(`${temp} = call %Promise* @fetch_async(i8* ${urlValue})`);
      this.ctx.setVariableType(temp, '%Promise*');
      return temp;
    }

    // Handle parseInt(str, radix?) global function
    if (expr.name === 'parseInt') {
      return this.generateParseInt(expr, params);
    }

    // Handle parseFloat(str) global function
    if (expr.name === 'parseFloat') {
      return this.generateParseFloat(expr, params);
    }

    // Handle Number(value) global function
    if (expr.name === 'Number') {
      return this.generateNumber(expr, params);
    }

    // Handle String(value) global function
    if (expr.name === 'String') {
      return this.generateString(expr, params);
    }

    // Handle isNaN(value) global function
    if (expr.name === 'isNaN') {
      return this.generateIsNaN(expr, params);
    }

    // Handle C built-in functions with proper signatures
    if (expr.name === 'malloc') {
      return this.generateMalloc(expr, params);
    }

    if (expr.name === 'free') {
      return this.generateFree(expr, params);
    }

    if (expr.name === 'socket') {
      return this.generateSocket(expr, params);
    }

    if (expr.name === 'close') {
      return this.generateClose(expr, params);
    }

    if (expr.name === 'htons') {
      return this.generateHtons(expr, params);
    }

    if (expr.name === 'bind') {
      return this.generateBind(expr, params);
    }

    if (expr.name === 'listen') {
      return this.generateListen(expr, params);
    }

    if (expr.name === 'accept') {
      return this.generateAccept(expr, params);
    }

    if (expr.name === '__ts_parse_source') {
      this.ctx.setUsesTreeSitter(true);
      return this.generateTsParseSource(expr, params);
    }

    if (expr.name === '__ts_get_root_node') {
      return this.generateTsGetRootNode(expr, params);
    }

    if (expr.name === '__ts_node_type') {
      return this.generateTsNodeType(expr, params);
    }

    if (expr.name === '__ts_node_child_count') {
      return this.generateTsNodeChildCount(expr, params);
    }

    if (expr.name === '__ts_node_named_child_count') {
      return this.generateTsNodeNamedChildCount(expr, params);
    }

    if (expr.name === '__ts_node_child') {
      return this.generateTsNodeChild(expr, params);
    }

    if (expr.name === '__ts_node_named_child') {
      return this.generateTsNodeNamedChild(expr, params);
    }

    if (expr.name === '__ts_node_text') {
      return this.generateTsNodeText(expr, params);
    }

    if (expr.name === '__ts_node_is_null') {
      return this.generateTsNodeIsNull(expr, params);
    }

    if (expr.name === '__ts_node_is_named') {
      return this.generateTsNodeIsNamed(expr, params);
    }

    if (expr.name === '__ts_node_start_byte') {
      return this.generateTsNodeStartByte(expr, params);
    }

    if (expr.name === '__ts_node_end_byte') {
      return this.generateTsNodeEndByte(expr, params);
    }

    if (expr.name === '__ts_node_child_by_field_name') {
      return this.generateTsNodeChildByFieldName(expr, params);
    }

    // Generic function call with type checking
    return this.generateGenericCall(expr, params);
  }

  private generateParseInt(expr: CallNode, params: string[]): string {
    if (expr.args.length < 1 || expr.args.length > 2) {
      throw new Error('parseInt() requires 1 or 2 arguments (string, radix?)');
    }

    this.ctx.syncStateToGenerators();

    // Get the string argument
    const strValue = this.ctx.generateExpression(expr.args[0], params);

    // Get the radix argument (default to 10 if not provided)
    let radixValue: string;
    if (expr.args.length === 2) {
      const radixDouble = this.ctx.generateExpression(expr.args[1], params);
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

  private generateParseFloat(expr: CallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      throw new Error('parseFloat() requires exactly 1 argument (string)');
    }

    this.ctx.syncStateToGenerators();

    const strValue = this.ctx.generateExpression(expr.args[0], params);
    const nullPtr = this.ctx.nextTemp();
    this.ctx.emit(`${nullPtr} = inttoptr i32 0 to i8**`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call double @strtod(i8* ${strValue}, i8** ${nullPtr})`);
    return result;
  }

  private generateNumber(expr: CallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      throw new Error('Number() requires exactly 1 argument');
    }

    this.ctx.syncStateToGenerators();

    const arg = expr.args[0];
    if (this.ctx.isStringExpression(arg)) {
      const strValue = this.ctx.generateExpression(arg, params);
      const nullPtr = this.ctx.nextTemp();
      this.ctx.emit(`${nullPtr} = inttoptr i32 0 to i8**`);
      const resultDouble = this.ctx.nextTemp();
      this.ctx.emit(`${resultDouble} = call double @strtod(i8* ${strValue}, i8** ${nullPtr})`);
      return resultDouble;
    }
    return this.ctx.generateExpression(arg, params);
  }

  private generateString(expr: CallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      throw new Error('String() requires exactly 1 argument');
    }

    this.ctx.syncStateToGenerators();

    const arg = expr.args[0];
    if (this.ctx.isStringExpression(arg)) {
      return this.ctx.generateExpression(arg, params);
    }
    const numValue = this.ctx.generateExpression(arg, params);
    return this.ctx.stringGen.doConvertNumberToString(numValue);
  }

  private generateIsNaN(expr: CallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      throw new Error('isNaN() requires exactly 1 argument');
    }

    this.ctx.syncStateToGenerators();

    const arg = expr.args[0];
    let doubleValue: string;
    if (this.ctx.isStringExpression(arg)) {
      const strValue = this.ctx.generateExpression(arg, params);
      const nullPtr = this.ctx.nextTemp();
      this.ctx.emit(`${nullPtr} = inttoptr i32 0 to i8**`);
      doubleValue = this.ctx.nextTemp();
      this.ctx.emit(`${doubleValue} = call double @strtod(i8* ${strValue}, i8** ${nullPtr})`);
    } else {
      doubleValue = this.ctx.generateExpression(arg, params);
    }
    const cmpResult = this.ctx.nextTemp();
    this.ctx.emit(`${cmpResult} = fcmp uno double ${doubleValue}, ${doubleValue}`);
    const resultI32 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI32} = zext i1 ${cmpResult} to i32`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  private generateExecSync(expr: CallNode, params: string[]): string {
    const cmdStr = this.ctx.generateExpression(expr.args[0], params);
    const modeStr = this.ctx.nextTemp();
    this.ctx.emit(`${modeStr} = getelementptr inbounds [2 x i8], [2 x i8]* @.str.popen_mode, i64 0, i64 0`);
    const fp = this.ctx.nextTemp();
    this.ctx.emit(`${fp} = call i8* @popen(i8* ${cmdStr}, i8* ${modeStr})`);
    const bufSize = '4096';
    const buf = this.ctx.nextTemp();
    this.ctx.emit(`${buf} = call i8* @GC_malloc_atomic(i64 ${bufSize})`);
    const bytesRead = this.ctx.nextTemp();
    this.ctx.emit(`${bytesRead} = call i64 @fread(i8* ${buf}, i64 1, i64 ${bufSize}, i8* ${fp})`);
    const nullIdx = this.ctx.nextTemp();
    this.ctx.emit(`${nullIdx} = getelementptr i8, i8* ${buf}, i64 ${bytesRead}`);
    this.ctx.emit(`store i8 0, i8* ${nullIdx}`);
    const closeResult = this.ctx.nextTemp();
    this.ctx.emit(`${closeResult} = call i32 @pclose(i8* ${fp})`);
    this.ctx.setVariableType(buf, 'i8*');
    return buf;
  }

  private generateMalloc(expr: CallNode, params: string[]): string {
    const sizeDouble = this.ctx.generateExpression(expr.args[0], params);
    const sizeI64 = this.ctx.nextTemp();
    this.ctx.emit(`${sizeI64} = fptosi double ${sizeDouble} to i64`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i8* @malloc(i64 ${sizeI64})`);
    const resultI64 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI64} = ptrtoint i8* ${result} to i64`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i64 ${resultI64} to double`);
    return resultDouble;
  }

  private generateFree(expr: CallNode, params: string[]): string {
    const ptrDouble = this.ctx.generateExpression(expr.args[0], params);
    const ptrI64 = this.ctx.nextTemp();
    this.ctx.emit(`${ptrI64} = fptosi double ${ptrDouble} to i64`);
    const ptr = this.ctx.nextTemp();
    this.ctx.emit(`${ptr} = inttoptr i64 ${ptrI64} to i8*`);
    this.ctx.emit(`call void @free(i8* ${ptr})`);
    return '0.0';
  }

  private generateSocket(expr: CallNode, params: string[]): string {
    // socket(domain: number, type: number, protocol: number) -> i32
    const domainDouble = this.ctx.generateExpression(expr.args[0], params);
    const typeDouble = this.ctx.generateExpression(expr.args[1], params);
    const protocolDouble = this.ctx.generateExpression(expr.args[2], params);
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

  private generateClose(expr: CallNode, params: string[]): string {
    // close(fd: number) -> i32
    const fdDouble = this.ctx.generateExpression(expr.args[0], params);
    const fd = this.ctx.nextTemp();
    this.ctx.emit(`${fd} = fptosi double ${fdDouble} to i32`);
    const resultI32 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI32} = call i32 @close(i32 ${fd})`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  private generateHtons(expr: CallNode, params: string[]): string {
    const hostshortDouble = this.ctx.generateExpression(expr.args[0], params);
    const hostshort = this.ctx.nextTemp();
    this.ctx.emit(`${hostshort} = fptosi double ${hostshortDouble} to i16`);
    const hi = this.ctx.nextTemp();
    this.ctx.emit(`${hi} = lshr i16 ${hostshort}, 8`);
    const lo = this.ctx.nextTemp();
    this.ctx.emit(`${lo} = shl i16 ${hostshort}, 8`);
    const resultI16 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI16} = or i16 ${hi}, ${lo}`);
    const resultI32 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI32} = zext i16 ${resultI16} to i32`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  private generateBind(expr: CallNode, params: string[]): string {
    const fdDouble = this.ctx.generateExpression(expr.args[0], params);
    const addrDouble = this.ctx.generateExpression(expr.args[1], params);
    const addrlenDouble = this.ctx.generateExpression(expr.args[2], params);
    const fd = this.ctx.nextTemp();
    this.ctx.emit(`${fd} = fptosi double ${fdDouble} to i32`);
    const addrI64 = this.ctx.nextTemp();
    this.ctx.emit(`${addrI64} = fptosi double ${addrDouble} to i64`);
    const addr = this.ctx.nextTemp();
    this.ctx.emit(`${addr} = inttoptr i64 ${addrI64} to i8*`);
    const addrlen = this.ctx.nextTemp();
    this.ctx.emit(`${addrlen} = fptosi double ${addrlenDouble} to i32`);
    const resultI32 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI32} = call i32 @bind(i32 ${fd}, i8* ${addr}, i32 ${addrlen})`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  private generateListen(expr: CallNode, params: string[]): string {
    const fdDouble = this.ctx.generateExpression(expr.args[0], params);
    const backlogDouble = this.ctx.generateExpression(expr.args[1], params);
    const fd = this.ctx.nextTemp();
    this.ctx.emit(`${fd} = fptosi double ${fdDouble} to i32`);
    const backlog = this.ctx.nextTemp();
    this.ctx.emit(`${backlog} = fptosi double ${backlogDouble} to i32`);
    const resultI32 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI32} = call i32 @listen(i32 ${fd}, i32 ${backlog})`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  private generateAccept(expr: CallNode, params: string[]): string {
    const fdDouble = this.ctx.generateExpression(expr.args[0], params);
    const addrDouble = this.ctx.generateExpression(expr.args[1], params);
    const addrlenDouble = this.ctx.generateExpression(expr.args[2], params);
    const fd = this.ctx.nextTemp();
    this.ctx.emit(`${fd} = fptosi double ${fdDouble} to i32`);
    const addrI64 = this.ctx.nextTemp();
    this.ctx.emit(`${addrI64} = fptosi double ${addrDouble} to i64`);
    const addr = this.ctx.nextTemp();
    this.ctx.emit(`${addr} = inttoptr i64 ${addrI64} to i8*`);
    const addrlenI64 = this.ctx.nextTemp();
    this.ctx.emit(`${addrlenI64} = fptosi double ${addrlenDouble} to i64`);
    const addrlen = this.ctx.nextTemp();
    this.ctx.emit(`${addrlen} = inttoptr i64 ${addrlenI64} to i32*`);
    const resultI32 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI32} = call i32 @accept(i32 ${fd}, i8* ${addr}, i32* ${addrlen})`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  private generateGenericCall(expr: CallNode, params: string[]): string {
    if (this.ctx.symbolTable.isClosure(expr.name)) {
      return this.generateClosureCall(expr, params);
    }

    const resolvedFuncName = this.ctx.resolveImportAlias(expr.name);
    let returnType = 'double';
    let paramTypes: string[] = [];

    const funcResult = this.getFunctionFromAST(expr.name);
    const func = funcResult as FunctionNode;
    let hasOptionalParams = false;
    if (funcResult && func.parameters) {
      for (let i = 0; i < func.parameters.length; i++) {
        const p = func.parameters[i];
        const pTyped = p as FunctionParameter;
        if (pTyped.optional || pTyped.defaultValue) {
          hasOptionalParams = true;
          break;
        }
      }
    }

    if (funcResult && func.async) {
      returnType = '%Promise*';
      this.ctx.setUsesPromises(true);
    } else if (funcResult && func.paramTypes && func.paramTypes.length > 0) {
      const normalizedReturnType = func.returnType ? stripNullable(func.returnType) : '';
      if (normalizedReturnType) {
        returnType = mapReturnTypeToLLVM(normalizedReturnType, this.ctx.isEnumType(normalizedReturnType));
      }
      for (let i = 0; i < func.paramTypes.length; i++) {
        const p = func.paramTypes[i] as string;
        const paramName = func.params[i] || '';
        paramTypes.push(mapParamTypeToLLVM(p, paramName, this.ctx.isEnumType(stripNullable(p)), false));
      }
    } else {
      const funcNode = this.getFunctionFromAST(expr.name);
      if (funcNode) {
        const normalizedRetType = funcNode.returnType ? stripNullable(funcNode.returnType) : '';
        if (normalizedRetType) {
          returnType = mapReturnTypeToLLVM(normalizedRetType, this.ctx.isEnumType(normalizedRetType));
        }
        if (funcNode.parameters) {
          for (let i = 0; i < funcNode.parameters.length; i++) {
            const p = funcNode.parameters[i] as FunctionParameter;
            const pType = p.type || 'number';
            paramTypes.push(mapParamTypeToLLVM(pType, p.name || '', this.ctx.isEnumType(stripNullable(pType)), false));
          }
        } else if (funcNode.paramTypes) {
          for (let i = 0; i < funcNode.paramTypes.length; i++) {
            const t = funcNode.paramTypes[i];
            const paramName = funcNode.params[i] || '';
            paramTypes.push(mapParamTypeToLLVM(t, paramName, this.ctx.isEnumType(stripNullable(t)), false));
          }
        }
      }
    }

    const argsList: string[] = [];

    if (hasOptionalParams) {
      argsList.push(`i32 ${expr.args.length}`);
    }

    const loopLimit = (func !== null && func.params !== null && func.params.length > 0) ? func.params.length : expr.args.length;
    for (let i = 0; i < loopLimit; i++) {
      if (i < expr.args.length) {
        const paramType = paramTypes[i] || 'double';
        const result = this.ctx.generateExpression(expr.args[i], params);
        const resultType = this.ctx.getVariableType(result);
        if (paramType === 'double' && resultType === 'i8*') {
          argsList.push(`double 0.0`);
        } else if (paramType === 'i8*' && resultType === 'double') {
          const coerced = this.ctx.nextTemp();
          this.ctx.emit(`${coerced} = bitcast double ${result} to i64`);
          const coerced2 = this.ctx.nextTemp();
          this.ctx.emit(`${coerced2} = inttoptr i64 ${coerced} to i8*`);
          argsList.push(`i8* ${coerced2}`);
        } else {
          argsList.push(`${paramType} ${result}`);
        }
      } else {
        const paramType = paramTypes[i] || 'double';
        const defaultVal = paramType === 'double' ? '0.0' : 'null';
        argsList.push(`${paramType} ${defaultVal}`);
      }
    }

    if (returnType === 'void') {
      this.ctx.emit(`call void @${this.ctx.mangleUserName(resolvedFuncName)}(${argsList.join(', ')})`);
      return '0';
    }

    const temp = this.ctx.nextTemp();
    this.ctx.emit(`${temp} = call ${returnType} @${this.ctx.mangleUserName(resolvedFuncName)}(${argsList.join(', ')})`);
    this.ctx.setVariableType(temp, returnType);

    return temp;
  }

  private generateClosureCall(expr: CallNode, params: string[]): string {
    const closureMetadata = this.ctx.symbolTable.getClosureMetadata(expr.name);
    if (!closureMetadata) {
      throw new Error(`Closure metadata not found for: ${expr.name}`);
    }

    const lambdaName = closureMetadata.lambdaName;
    const envPtrRegister = closureMetadata.envPtrRegister;
    const captures = closureMetadata.captures;

    const returnType = 'double';

    const argsList: string[] = [];
    if (captures && captures.length > 0) {
      argsList.push(`i8* ${envPtrRegister}`);
    } else {
      argsList.push('i8* null');
    }

    for (let _cai = 0; _cai < expr.args.length; _cai++) {
      const arg = expr.args[_cai];
      const result = this.ctx.generateExpression(arg, params);
      argsList.push(`double ${result}`);
    }

    const temp = this.ctx.nextTemp();
    this.ctx.emit(`${temp} = call ${returnType} @${lambdaName}(${argsList.join(', ')})`);
    this.ctx.setVariableType(temp, returnType);

    return temp;
  }

  private generateSetTimeout(expr: CallNode, params: string[]): string {
    if (expr.args.length < 2) {
      throw new Error('setTimeout() requires 2 arguments (callback, delay_ms)');
    }

    this.ctx.setUsesTimers(true);

    const callbackArg = expr.args[0];
    if (callbackArg.type !== 'variable') {
      throw new Error('setTimeout() callback must be a function reference');
    }
    const callbackName = (callbackArg as VariableNode).name;

    const delayValue = this.ctx.generateExpression(expr.args[1], params);

    const callbackPtr = this.ctx.nextTemp();
    this.ctx.emit(`${callbackPtr} = bitcast void ()* @${this.ctx.mangleUserName(callbackName)} to void ()*`);

    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i8* @__setTimeout(void ()* ${callbackPtr}, double ${delayValue})`);
    this.ctx.setVariableType(result, 'i8*');

    return result;
  }

  private generateSetInterval(expr: CallNode, params: string[]): string {
    if (expr.args.length < 2) {
      throw new Error('setInterval() requires 2 arguments (callback, interval_ms)');
    }

    this.ctx.setUsesTimers(true);

    const callbackArg = expr.args[0];
    if (callbackArg.type !== 'variable') {
      throw new Error('setInterval() callback must be a function reference');
    }
    const callbackName = (callbackArg as VariableNode).name;

    const intervalValue = this.ctx.generateExpression(expr.args[1], params);

    const callbackPtr = this.ctx.nextTemp();
    this.ctx.emit(`${callbackPtr} = bitcast void ()* @${this.ctx.mangleUserName(callbackName)} to void ()*`);

    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i8* @__setInterval(void ()* ${callbackPtr}, double ${intervalValue})`);
    this.ctx.setVariableType(result, 'i8*');

    return result;
  }

  private generateClearTimer(expr: CallNode, params: string[]): string {
    if (expr.args.length < 1) {
      throw new Error('clearTimeout/clearInterval requires 1 argument (timer_id)');
    }

    const timerIdValue = this.ctx.generateExpression(expr.args[0], params);

    this.ctx.emit(`call void @__clearTimer(i8* ${timerIdValue})`);

    return '0.0';
  }

  private generateRunEventLoop(): string {
    this.ctx.setUsesTimers(true);
    this.ctx.emit('call void @__runEventLoop()');
    return '0.0';
  }

  private generateTsParseSource(expr: CallNode, params: string[]): string {
    const sourceValue = this.ctx.generateExpression(expr.args[0], params);
    const lengthDouble = this.ctx.generateExpression(expr.args[1], params);
    const lengthI32 = this.ctx.nextTemp();
    this.ctx.emit(`${lengthI32} = fptosi double ${lengthDouble} to i32`);
    const resultPtr = this.ctx.nextTemp();
    this.ctx.emit(`${resultPtr} = call %TSTree* @__ts_parse_source(i8* ${sourceValue}, i32 ${lengthI32})`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = bitcast %TSTree* ${resultPtr} to i8*`);
    this.ctx.setVariableType(result, 'i8*');
    return result;
  }

  private generateTsGetRootNode(expr: CallNode, params: string[]): string {
    const treeValue = this.ctx.generateExpression(expr.args[0], params);
    const treePtr = this.ctx.nextTemp();
    this.ctx.emit(`${treePtr} = bitcast i8* ${treeValue} to %TSTree*`);
    const resultPtr = this.ctx.nextTemp();
    this.ctx.emit(`${resultPtr} = call %TSNode* @__ts_get_root_node(%TSTree* ${treePtr})`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = bitcast %TSNode* ${resultPtr} to i8*`);
    this.ctx.setVariableType(result, 'i8*');
    return result;
  }

  private generateTsNodeType(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodePtr = this.ctx.nextTemp();
    this.ctx.emit(`${nodePtr} = bitcast i8* ${nodeValue} to %TSNode*`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i8* @__ts_node_type(%TSNode* ${nodePtr})`);
    this.ctx.setVariableType(result, 'i8*');
    return result;
  }

  private generateTsNodeChildCount(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodePtr = this.ctx.nextTemp();
    this.ctx.emit(`${nodePtr} = bitcast i8* ${nodeValue} to %TSNode*`);
    const resultI32 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI32} = call i32 @__ts_node_child_count(%TSNode* ${nodePtr})`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  private generateTsNodeNamedChildCount(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodePtr = this.ctx.nextTemp();
    this.ctx.emit(`${nodePtr} = bitcast i8* ${nodeValue} to %TSNode*`);
    const resultI32 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI32} = call i32 @__ts_node_named_child_count(%TSNode* ${nodePtr})`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  private generateTsNodeChild(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodePtr = this.ctx.nextTemp();
    this.ctx.emit(`${nodePtr} = bitcast i8* ${nodeValue} to %TSNode*`);
    const indexDouble = this.ctx.generateExpression(expr.args[1], params);
    const indexI32 = this.ctx.nextTemp();
    this.ctx.emit(`${indexI32} = fptosi double ${indexDouble} to i32`);
    const resultPtr = this.ctx.nextTemp();
    this.ctx.emit(`${resultPtr} = call %TSNode* @__ts_node_child(%TSNode* ${nodePtr}, i32 ${indexI32})`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = bitcast %TSNode* ${resultPtr} to i8*`);
    this.ctx.setVariableType(result, 'i8*');
    return result;
  }

  private generateTsNodeNamedChild(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodePtr = this.ctx.nextTemp();
    this.ctx.emit(`${nodePtr} = bitcast i8* ${nodeValue} to %TSNode*`);
    const indexDouble = this.ctx.generateExpression(expr.args[1], params);
    const indexI32 = this.ctx.nextTemp();
    this.ctx.emit(`${indexI32} = fptosi double ${indexDouble} to i32`);
    const resultPtr = this.ctx.nextTemp();
    this.ctx.emit(`${resultPtr} = call %TSNode* @__ts_node_named_child(%TSNode* ${nodePtr}, i32 ${indexI32})`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = bitcast %TSNode* ${resultPtr} to i8*`);
    this.ctx.setVariableType(result, 'i8*');
    return result;
  }

  private generateTsNodeText(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodePtr = this.ctx.nextTemp();
    this.ctx.emit(`${nodePtr} = bitcast i8* ${nodeValue} to %TSNode*`);
    const sourceValue = this.ctx.generateExpression(expr.args[1], params);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i8* @__ts_node_text(%TSNode* ${nodePtr}, i8* ${sourceValue})`);
    this.ctx.setVariableType(result, 'i8*');
    return result;
  }

  private generateTsNodeIsNull(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodePtr = this.ctx.nextTemp();
    this.ctx.emit(`${nodePtr} = bitcast i8* ${nodeValue} to %TSNode*`);
    const resultI1 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI1} = call i1 @__ts_node_is_null(%TSNode* ${nodePtr})`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = uitofp i1 ${resultI1} to double`);
    return resultDouble;
  }

  private generateTsNodeIsNamed(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodePtr = this.ctx.nextTemp();
    this.ctx.emit(`${nodePtr} = bitcast i8* ${nodeValue} to %TSNode*`);
    const resultI1 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI1} = call i1 @__ts_node_is_named(%TSNode* ${nodePtr})`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = uitofp i1 ${resultI1} to double`);
    return resultDouble;
  }

  private generateTsNodeStartByte(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodePtr = this.ctx.nextTemp();
    this.ctx.emit(`${nodePtr} = bitcast i8* ${nodeValue} to %TSNode*`);
    const resultI32 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI32} = call i32 @__ts_node_start_byte(%TSNode* ${nodePtr})`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  private generateTsNodeEndByte(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodePtr = this.ctx.nextTemp();
    this.ctx.emit(`${nodePtr} = bitcast i8* ${nodeValue} to %TSNode*`);
    const resultI32 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI32} = call i32 @__ts_node_end_byte(%TSNode* ${nodePtr})`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  private generateTsNodeChildByFieldName(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodePtr = this.ctx.nextTemp();
    this.ctx.emit(`${nodePtr} = bitcast i8* ${nodeValue} to %TSNode*`);
    const fieldValue = this.ctx.generateExpression(expr.args[1], params);
    const fieldLenDouble = this.ctx.generateExpression(expr.args[2], params);
    const fieldLenI32 = this.ctx.nextTemp();
    this.ctx.emit(`${fieldLenI32} = fptosi double ${fieldLenDouble} to i32`);
    const resultPtr = this.ctx.nextTemp();
    this.ctx.emit(`${resultPtr} = call %TSNode* @__ts_node_child_by_field_name(%TSNode* ${nodePtr}, i8* ${fieldValue}, i32 ${fieldLenI32})`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = bitcast %TSNode* ${resultPtr} to i8*`);
    this.ctx.setVariableType(result, 'i8*');
    return result;
  }

  private generateSuperCall(expr: CallNode, params: string[]): string {
    const thisPtr = this.ctx.getThisPointer();
    if (!thisPtr) {
      throw new Error('super() called outside of class constructor');
    }
    const currentClassName = this.ctx.getCurrentClassName();
    if (!currentClassName) {
      throw new Error('super() called outside of class context');
    }
    const ast = this.ctx.getAst();
    if (!ast || !ast.classes) {
      throw new Error('super() called but no classes defined');
    }
    let currentClass: ClassNode | null = null;
    for (let i = 0; i < ast.classes.length; i++) {
      const c = ast.classes[i] as ClassNode;
      if (c.name === currentClassName) {
        currentClass = c;
        break;
      }
    }
    if (!currentClass || !currentClass.extends) {
      throw new Error(`super() called but current class ${currentClassName} has no parent class`);
    }
    const parentClassName = currentClass.extends;
    const parentStructType = `%${parentClassName}_struct*`;

    const argValues: string[] = [];
    for (let i = 0; i < expr.args.length; i++) {
      argValues.push(this.ctx.generateExpression(expr.args[i], params));
    }
    const argsWithTypesParts: string[] = [];
    for (let ai = 0; ai < argValues.length; ai++) {
      argsWithTypesParts.push('i8* ' + argValues[ai]);
    }
    const argsWithTypes = argsWithTypesParts.join(', ');
    const parentObj = this.ctx.nextTemp();
    if (argValues.length === 0) {
      this.ctx.emit(`${parentObj} = call ${parentStructType} @${this.ctx.mangleUserName(parentClassName)}_constructor()`);
    } else {
      this.ctx.emit(`${parentObj} = call ${parentStructType} @${this.ctx.mangleUserName(parentClassName)}_constructor(${argsWithTypes})`);
    }

    const parentFields = this.ctx.classGenGetClassFields(parentClassName);
    if (parentFields.length > 0) {
      const childStructType = `%${currentClassName}_struct*`;
      const castedThis = this.ctx.nextTemp();
      this.ctx.emit(`${castedThis} = bitcast i8* ${thisPtr} to ${childStructType}`);

      for (let i = 0; i < parentFields.length; i++) {
        const parentFieldPtr = this.ctx.nextTemp();
        this.ctx.emit(`${parentFieldPtr} = getelementptr inbounds ${parentStructType.slice(0, -1)}, ${parentStructType} ${parentObj}, i32 0, i32 ${i}`);
        const thisFieldPtr = this.ctx.nextTemp();
        this.ctx.emit(`${thisFieldPtr} = getelementptr inbounds ${childStructType.slice(0, -1)}, ${childStructType} ${castedThis}, i32 0, i32 ${i}`);
        const fieldLlvmType = this.getFieldLlvmType(parentFields[i]);
        const fieldValue = this.ctx.nextTemp();
        this.ctx.emit(`${fieldValue} = load ${fieldLlvmType}, ${fieldLlvmType}* ${parentFieldPtr}`);
        this.ctx.emit(`store ${fieldLlvmType} ${fieldValue}, ${fieldLlvmType}* ${thisFieldPtr}`);
      }
    }
    return '0';
  }

  private getFieldLlvmType(field: { name: string; fieldType: string; tsType?: string }): string {
    if (field.fieldType === 'string') return 'i8*';
    if (field.fieldType === 'string[]') return '%StringArray*';
    if (field.fieldType.endsWith('[]')) return '%Array*';
    if (field.fieldType === 'boolean') return 'i1';
    if (field.tsType) {
      if (field.tsType.startsWith('Map<string,')) return '%StringMap*';
      if (field.tsType.startsWith('Map<')) return '%Map*';
      if (field.tsType === 'Set<string>') return '%StringSet*';
      if (field.tsType.startsWith('Set<')) return '%Set*';
      if (field.tsType === 'number' || field.tsType === 'boolean') return 'double';
      const classFields = this.ctx.classGenGetClassFields(field.tsType);
      if (classFields.length > 0) {
        return `%${field.tsType}_struct*`;
      }
    }
    return 'i8*';
  }
}
