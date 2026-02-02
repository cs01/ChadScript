import { Expression, CallNode, FunctionNode, VariableNode, FunctionParameter } from '../../ast/types.js';
import { IGeneratorContext } from '../infrastructure/generator-context.js';

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
    if (!this.ctx.ast?.functions) return null;
    for (let i = 0; i < this.ctx.ast.functions.length; i++) {
      const fn = this.ctx.ast.functions[i] as FunctionNode;
      if (fn.name === name) {
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
    // Handle httpServe() special built-in function
    if (expr.name === 'httpServe') {
      return this.ctx.generateHttpServe(expr, params);
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
      this.ctx.usesPromises = true;
      this.ctx.emit(`${temp} = call %Promise* @fetch_async(i8* ${urlValue})`);
      this.ctx.setVariableType(temp, '%Promise*');
      return temp;
    }

    // Handle parseInt(str, radix?) global function
    if (expr.name === 'parseInt') {
      return this.generateParseInt(expr, params);
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

    if (expr.name === '__ts_parse_source') {
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

  private generateMalloc(expr: CallNode, params: string[]): string {
    // malloc(size: number) -> i8*
    const sizeDouble = this.ctx.generateExpression(expr.args[0], params);
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

  private generateFree(expr: CallNode, params: string[]): string {
    // free(ptr: number) -> void
    const ptrDouble = this.ctx.generateExpression(expr.args[0], params);
    const ptrI32 = this.ctx.nextTemp();
    this.ctx.emit(`${ptrI32} = fptosi double ${ptrDouble} to i32`);
    const ptr = this.ctx.nextTemp();
    this.ctx.emit(`${ptr} = inttoptr i32 ${ptrI32} to i8*`);
    this.ctx.emit(`call void @free(i8* ${ptr})`);
    return '0.0'; // Return dummy value
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
    // htons(hostshort: number) -> i16
    const hostshortDouble = this.ctx.generateExpression(expr.args[0], params);
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

  private generateGenericCall(expr: CallNode, params: string[]): string {
    if (this.ctx.symbolTable.isClosure(expr.name)) {
      return this.generateClosureCall(expr, params);
    }

    let returnType = 'double';
    let paramTypes: string[] = [];

    const funcResult = this.ctx.ast?.functions?.find((f: FunctionNode) => f.name === expr.name);
    const func = funcResult as FunctionNode;
    const hasOptionalParams = funcResult ? func.parameters?.some((p) => p.optional || p.defaultValue) : false;

    if (funcResult && func.async) {
      returnType = '%Promise*';
      this.ctx.usesPromises = true;
    } else if (funcResult && func.paramTypes && func.paramTypes.length > 0) {
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
    } else {
      const funcNode = this.getFunctionFromAST(expr.name);
      if (funcNode) {
        if (funcNode.returnType === 'string') {
          returnType = 'i8*';
        } else if (funcNode.returnType && funcNode.returnType !== 'number' && funcNode.returnType !== 'boolean' && funcNode.returnType !== 'void') {
          returnType = 'i8*';
        }
        if (funcNode.parameters) {
          for (let i = 0; i < funcNode.parameters.length; i++) {
            const p = funcNode.parameters[i] as FunctionParameter;
            if (p.type === 'string') paramTypes.push('i8*');
            else if (p.type === 'string[]') paramTypes.push('%StringArray*');
            else if (p.type === 'number[]' || p.type === 'boolean[]') paramTypes.push('%Array*');
            else if (p.type && p.type !== 'number' && p.type !== 'boolean') paramTypes.push('i8*');
            else paramTypes.push('double');
          }
        } else if (funcNode.paramTypes) {
          for (let i = 0; i < funcNode.paramTypes.length; i++) {
            const t = funcNode.paramTypes[i];
            if (t === 'string') paramTypes.push('i8*');
            else if (t === 'string[]') paramTypes.push('%StringArray*');
            else if (t === 'number[]' || t === 'boolean[]') paramTypes.push('%Array*');
            else if (t !== 'number' && t !== 'boolean') paramTypes.push('i8*');
            else paramTypes.push('double');
          }
        }
      }
    }

    const argsList: string[] = [];

    if (hasOptionalParams) {
      argsList.push(`i32 ${expr.args.length}`);
    }

    for (let i = 0; i < (func?.params?.length || expr.args.length); i++) {
      if (i < expr.args.length) {
        const result = this.ctx.generateExpression(expr.args[i], params);
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

    for (const arg of expr.args) {
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

    this.ctx.usesTimers = true;

    const callbackArg = expr.args[0];
    if (callbackArg.type !== 'variable') {
      throw new Error('setTimeout() callback must be a function reference');
    }
    const callbackName = (callbackArg as VariableNode).name;

    const delayValue = this.ctx.generateExpression(expr.args[1], params);

    const callbackPtr = this.ctx.nextTemp();
    this.ctx.emit(`${callbackPtr} = bitcast void ()* @${callbackName} to void ()*`);

    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i8* @__setTimeout(void ()* ${callbackPtr}, double ${delayValue})`);
    this.ctx.setVariableType(result, 'i8*');

    return result;
  }

  private generateSetInterval(expr: CallNode, params: string[]): string {
    if (expr.args.length < 2) {
      throw new Error('setInterval() requires 2 arguments (callback, interval_ms)');
    }

    this.ctx.usesTimers = true;

    const callbackArg = expr.args[0];
    if (callbackArg.type !== 'variable') {
      throw new Error('setInterval() callback must be a function reference');
    }
    const callbackName = (callbackArg as VariableNode).name;

    const intervalValue = this.ctx.generateExpression(expr.args[1], params);

    const callbackPtr = this.ctx.nextTemp();
    this.ctx.emit(`${callbackPtr} = bitcast void ()* @${callbackName} to void ()*`);

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
    this.ctx.usesTimers = true;
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
    const resultI64 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI64} = ptrtoint %TSTree* ${resultPtr} to i64`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = bitcast i64 ${resultI64} to double`);
    this.ctx.setVariableType(result, '%TSTree*');
    return result;
  }

  private generateTsGetRootNode(expr: CallNode, params: string[]): string {
    const treeValue = this.ctx.generateExpression(expr.args[0], params);
    const treeI64 = this.ctx.nextTemp();
    this.ctx.emit(`${treeI64} = bitcast double ${treeValue} to i64`);
    const treePtr = this.ctx.nextTemp();
    this.ctx.emit(`${treePtr} = inttoptr i64 ${treeI64} to %TSTree*`);
    const resultPtr = this.ctx.nextTemp();
    this.ctx.emit(`${resultPtr} = call %TSNode* @__ts_get_root_node(%TSTree* ${treePtr})`);
    const resultI64 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI64} = ptrtoint %TSNode* ${resultPtr} to i64`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = bitcast i64 ${resultI64} to double`);
    this.ctx.setVariableType(result, '%TSNode*');
    return result;
  }

  private generateTsNodeType(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodeI64 = this.ctx.nextTemp();
    this.ctx.emit(`${nodeI64} = bitcast double ${nodeValue} to i64`);
    const nodePtr = this.ctx.nextTemp();
    this.ctx.emit(`${nodePtr} = inttoptr i64 ${nodeI64} to %TSNode*`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i8* @__ts_node_type(%TSNode* ${nodePtr})`);
    this.ctx.setVariableType(result, 'i8*');
    return result;
  }

  private generateTsNodeChildCount(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodeI64 = this.ctx.nextTemp();
    this.ctx.emit(`${nodeI64} = bitcast double ${nodeValue} to i64`);
    const nodePtr = this.ctx.nextTemp();
    this.ctx.emit(`${nodePtr} = inttoptr i64 ${nodeI64} to %TSNode*`);
    const resultI32 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI32} = call i32 @__ts_node_child_count(%TSNode* ${nodePtr})`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  private generateTsNodeNamedChildCount(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodeI64 = this.ctx.nextTemp();
    this.ctx.emit(`${nodeI64} = bitcast double ${nodeValue} to i64`);
    const nodePtr = this.ctx.nextTemp();
    this.ctx.emit(`${nodePtr} = inttoptr i64 ${nodeI64} to %TSNode*`);
    const resultI32 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI32} = call i32 @__ts_node_named_child_count(%TSNode* ${nodePtr})`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  private generateTsNodeChild(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodeI64 = this.ctx.nextTemp();
    this.ctx.emit(`${nodeI64} = bitcast double ${nodeValue} to i64`);
    const nodePtr = this.ctx.nextTemp();
    this.ctx.emit(`${nodePtr} = inttoptr i64 ${nodeI64} to %TSNode*`);
    const indexDouble = this.ctx.generateExpression(expr.args[1], params);
    const indexI32 = this.ctx.nextTemp();
    this.ctx.emit(`${indexI32} = fptosi double ${indexDouble} to i32`);
    const resultPtr = this.ctx.nextTemp();
    this.ctx.emit(`${resultPtr} = call %TSNode* @__ts_node_child(%TSNode* ${nodePtr}, i32 ${indexI32})`);
    const resultI64 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI64} = ptrtoint %TSNode* ${resultPtr} to i64`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = bitcast i64 ${resultI64} to double`);
    this.ctx.setVariableType(result, '%TSNode*');
    return result;
  }

  private generateTsNodeNamedChild(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodeI64 = this.ctx.nextTemp();
    this.ctx.emit(`${nodeI64} = bitcast double ${nodeValue} to i64`);
    const nodePtr = this.ctx.nextTemp();
    this.ctx.emit(`${nodePtr} = inttoptr i64 ${nodeI64} to %TSNode*`);
    const indexDouble = this.ctx.generateExpression(expr.args[1], params);
    const indexI32 = this.ctx.nextTemp();
    this.ctx.emit(`${indexI32} = fptosi double ${indexDouble} to i32`);
    const resultPtr = this.ctx.nextTemp();
    this.ctx.emit(`${resultPtr} = call %TSNode* @__ts_node_named_child(%TSNode* ${nodePtr}, i32 ${indexI32})`);
    const resultI64 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI64} = ptrtoint %TSNode* ${resultPtr} to i64`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = bitcast i64 ${resultI64} to double`);
    this.ctx.setVariableType(result, '%TSNode*');
    return result;
  }

  private generateTsNodeText(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodeI64 = this.ctx.nextTemp();
    this.ctx.emit(`${nodeI64} = bitcast double ${nodeValue} to i64`);
    const nodePtr = this.ctx.nextTemp();
    this.ctx.emit(`${nodePtr} = inttoptr i64 ${nodeI64} to %TSNode*`);
    const sourceValue = this.ctx.generateExpression(expr.args[1], params);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i8* @__ts_node_text(%TSNode* ${nodePtr}, i8* ${sourceValue})`);
    this.ctx.setVariableType(result, 'i8*');
    return result;
  }

  private generateTsNodeIsNull(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodeI64 = this.ctx.nextTemp();
    this.ctx.emit(`${nodeI64} = bitcast double ${nodeValue} to i64`);
    const nodePtr = this.ctx.nextTemp();
    this.ctx.emit(`${nodePtr} = inttoptr i64 ${nodeI64} to %TSNode*`);
    const resultI1 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI1} = call i1 @__ts_node_is_null(%TSNode* ${nodePtr})`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = uitofp i1 ${resultI1} to double`);
    return resultDouble;
  }

  private generateTsNodeIsNamed(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodeI64 = this.ctx.nextTemp();
    this.ctx.emit(`${nodeI64} = bitcast double ${nodeValue} to i64`);
    const nodePtr = this.ctx.nextTemp();
    this.ctx.emit(`${nodePtr} = inttoptr i64 ${nodeI64} to %TSNode*`);
    const resultI1 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI1} = call i1 @__ts_node_is_named(%TSNode* ${nodePtr})`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = uitofp i1 ${resultI1} to double`);
    return resultDouble;
  }

  private generateTsNodeStartByte(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodeI64 = this.ctx.nextTemp();
    this.ctx.emit(`${nodeI64} = bitcast double ${nodeValue} to i64`);
    const nodePtr = this.ctx.nextTemp();
    this.ctx.emit(`${nodePtr} = inttoptr i64 ${nodeI64} to %TSNode*`);
    const resultI32 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI32} = call i32 @__ts_node_start_byte(%TSNode* ${nodePtr})`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  private generateTsNodeEndByte(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodeI64 = this.ctx.nextTemp();
    this.ctx.emit(`${nodeI64} = bitcast double ${nodeValue} to i64`);
    const nodePtr = this.ctx.nextTemp();
    this.ctx.emit(`${nodePtr} = inttoptr i64 ${nodeI64} to %TSNode*`);
    const resultI32 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI32} = call i32 @__ts_node_end_byte(%TSNode* ${nodePtr})`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  private generateTsNodeChildByFieldName(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodeI64 = this.ctx.nextTemp();
    this.ctx.emit(`${nodeI64} = bitcast double ${nodeValue} to i64`);
    const nodePtr = this.ctx.nextTemp();
    this.ctx.emit(`${nodePtr} = inttoptr i64 ${nodeI64} to %TSNode*`);
    const fieldValue = this.ctx.generateExpression(expr.args[1], params);
    const fieldLenDouble = this.ctx.generateExpression(expr.args[2], params);
    const fieldLenI32 = this.ctx.nextTemp();
    this.ctx.emit(`${fieldLenI32} = fptosi double ${fieldLenDouble} to i32`);
    const resultPtr = this.ctx.nextTemp();
    this.ctx.emit(`${resultPtr} = call %TSNode* @__ts_node_child_by_field_name(%TSNode* ${nodePtr}, i8* ${fieldValue}, i32 ${fieldLenI32})`);
    const resultI64 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI64} = ptrtoint %TSNode* ${resultPtr} to i64`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = bitcast i64 ${resultI64} to double`);
    this.ctx.setVariableType(result, '%TSNode*');
    return result;
  }
}
