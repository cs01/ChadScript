// NOTE: This file uses raw ctx.emit() extensively. Prefer structured IR builders
// (emitStore, emitLoad, emitCall, etc.) when modifying — see .claude/rules.md.

import {
  CallNode,
  FunctionNode,
  VariableNode,
  FunctionParameter,
  ClassNode,
  ClassMethod,
} from "../../ast/types.js";
import { IGeneratorContext } from "../infrastructure/generator-context.js";
import {
  stripNullable,
  mapParamTypeToLLVM,
  mapReturnTypeToLLVM,
} from "../infrastructure/type-system.js";

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
    if (expr.name === "super") {
      return this.generateSuperCall(expr, params);
    }

    if (expr.name === "callHandler") {
      const fnPtr = this.ctx.generateExpression(expr.args[0], params);
      const typedFn = this.ctx.nextTemp();
      const numCallArgs = expr.args.length - 1;
      const argTypeList: string[] = [];
      for (let ti = 0; ti < numCallArgs; ti++) {
        argTypeList.push("i8*");
      }
      this.ctx.emit(`${typedFn} = bitcast i8* ${fnPtr} to double (${argTypeList.join(", ")})*`);
      const callArgsList: string[] = [];
      for (let ai = 1; ai < expr.args.length; ai++) {
        const argVal = this.ctx.generateExpression(expr.args[ai], params);
        callArgsList.push(`i8* ${argVal}`);
      }
      const callResult = this.ctx.nextTemp();
      this.ctx.emit(`${callResult} = call double ${typedFn}(${callArgsList.join(", ")})`);
      return fnPtr;
    }

    const runtimeResult = this.dispatchRuntimeCalls(expr, params);
    if (runtimeResult !== null) return runtimeResult;

    const serverResult = this.dispatchServerCalls(expr, params);
    if (serverResult !== null) return serverResult;

    const timerResult = this.dispatchTimerAndTestCalls(expr, params);
    if (timerResult !== null) return timerResult;

    const conversionResult = this.dispatchConversionCalls(expr, params);
    if (conversionResult !== null) return conversionResult;

    const encodingResult = this.dispatchEncodingCalls(expr, params);
    if (encodingResult !== null) return encodingResult;

    const ffiResult = this.dispatchCFfiCalls(expr, params);
    if (ffiResult !== null) return ffiResult;

    const tsResult = this.dispatchTreeSitterCalls(expr, params);
    if (tsResult !== null) return tsResult;

    return this.generateGenericCall(expr, params);
  }

  private dispatchRuntimeCalls(expr: CallNode, params: string[]): string | null {
    if (expr.name === "__gc_disable") {
      this.ctx.emitCallVoid("@GC_disable", "");
      return "0.0";
    }

    if (expr.name === "__gc_enable") {
      this.ctx.emitCallVoid("@GC_enable", "");
      return "0.0";
    }

    if (expr.name === "cs_exec_passthrough") {
      const arg0 = this.ctx.generateExpression(expr.args[0], params);
      this.ctx.emitCallVoid("@cs_exec_passthrough", `i8* ${arg0}`);
      return "0.0";
    }

    if (expr.name === "cs_watch_loop") {
      if (expr.args.length >= 3) {
        const arg0 = this.ctx.generateExpression(expr.args[0], params);
        const arg1 = this.ctx.generateExpression(expr.args[1], params);
        const arg2 = this.ctx.generateExpression(expr.args[2], params);
        this.ctx.emitCallVoid("@cs_watch_loop", `i8* ${arg0}, i8* ${arg1}, i8* ${arg2}`);
      }
      return "0.0";
    }

    return null;
  }

  private dispatchServerCalls(expr: CallNode, params: string[]): string | null {
    if (expr.name === "execSync") {
      return this.generateExecSync(expr, params);
    }

    if (expr.name === "httpServe") {
      return this.ctx.generateHttpServe(expr, params);
    }

    if (expr.name === "wsBroadcast") {
      return this.ctx.generateWsBroadcast(expr, params);
    }

    if (expr.name === "wsSend") {
      return this.ctx.generateWsSend(expr, params);
    }

    return null;
  }

  private dispatchTimerAndTestCalls(expr: CallNode, params: string[]): string | null {
    if (expr.name === "parseMultipart") {
      return this.ctx.generateParseMultipart(expr, params);
    }

    if (expr.name === "bytesResponse") {
      return this.generateBytesResponse(expr, params);
    }

    if (expr.name === "setTimeout") {
      return this.generateSetTimeout(expr, params);
    }

    if (expr.name === "setInterval") {
      return this.generateSetInterval(expr, params);
    }

    return null;
  }

  private dispatchConversionCalls(expr: CallNode, params: string[]): string | null {
    if (expr.name === "test" && expr.args.length >= 2) {
      const testSecondArg = expr.args[1] as { type: string };
      if (testSecondArg.type === "arrow_function" || testSecondArg.type === "variable") {
        return this.generateTest(expr, params);
      }
    }

    if (expr.name === "describe" && expr.args.length >= 2) {
      const descSecondArg = expr.args[1] as { type: string };
      if (descSecondArg.type === "arrow_function" || descSecondArg.type === "variable") {
        return this.generateDescribe(expr, params);
      }
    }

    if (expr.name === "clearTimeout" || expr.name === "clearInterval") {
      return this.generateClearTimer(expr, params);
    }

    if (expr.name === "runEventLoop") {
      return this.generateRunEventLoop();
    }

    return null;
  }

  private dispatchEncodingCalls(expr: CallNode, params: string[]): string | null {
    if (expr.name === "fetch") {
      if (expr.args.length < 1) {
        return this.ctx.emitError("fetch() requires at least 1 argument (URL)", expr.loc);
      }
      const urlValue = this.ctx.generateExpression(expr.args[0], params);
      this.ctx.setUsesPromises(true);
      this.ctx.setUsesCurl(true);
      this.ctx.setUsesJson(true);
      const temp = this.ctx.emitCall("%Promise*", "@fetch_async", `i8* ${urlValue}`);
      return temp;
    }

    if (expr.name === "parseInt") {
      return this.generateParseInt(expr, params);
    }

    if (expr.name === "parseFloat") {
      return this.generateParseFloat(expr, params);
    }

    if (expr.name === "Number") {
      return this.generateNumber(expr, params);
    }

    return this.dispatchStringEncodingCalls(expr, params);
  }

  private dispatchStringEncodingCalls(expr: CallNode, params: string[]): string | null {
    if (expr.name === "String") {
      return this.generateString(expr, params);
    }

    if (expr.name === "isNaN") {
      return this.generateIsNaN(expr, params);
    }

    if (expr.name === "btoa") {
      if (expr.args.length !== 1) {
        return this.ctx.emitError("btoa() requires exactly 1 argument", expr.loc);
      }
      const arg = this.ctx.generateExpression(expr.args[0], params);
      const result = this.ctx.emitCall("i8*", "@cs_btoa", `i8* ${arg}`);
      this.ctx.setVariableType(result, "i8*");
      return result;
    }

    if (expr.name === "atob") {
      if (expr.args.length !== 1) {
        return this.ctx.emitError("atob() requires exactly 1 argument", expr.loc);
      }
      const arg = this.ctx.generateExpression(expr.args[0], params);
      const result = this.ctx.emitCall("i8*", "@cs_atob", `i8* ${arg}`);
      this.ctx.setVariableType(result, "i8*");
      return result;
    }

    return this.dispatchUriCalls(expr, params);
  }

  private dispatchUriCalls(expr: CallNode, params: string[]): string | null {
    if (expr.name === "encodeURIComponent") {
      if (expr.args.length !== 1) {
        return this.ctx.emitError("encodeURIComponent() requires exactly 1 argument", expr.loc);
      }
      const arg = this.ctx.generateExpression(expr.args[0], params);
      const result = this.ctx.emitCall("i8*", "@cs_encode_uri_component", `i8* ${arg}`);
      this.ctx.setVariableType(result, "i8*");
      return result;
    }

    if (expr.name === "decodeURIComponent") {
      if (expr.args.length !== 1) {
        return this.ctx.emitError("decodeURIComponent() requires exactly 1 argument", expr.loc);
      }
      const arg = this.ctx.generateExpression(expr.args[0], params);
      const result = this.ctx.emitCall("i8*", "@cs_decode_uri_component", `i8* ${arg}`);
      this.ctx.setVariableType(result, "i8*");
      return result;
    }

    return null;
  }

  private dispatchCFfiCalls(expr: CallNode, params: string[]): string | null {
    if (expr.name === "malloc") {
      return this.generateMalloc(expr, params);
    }

    if (expr.name === "free") {
      return this.generateFree(expr, params);
    }

    if (expr.name === "socket") {
      return this.generateSocket(expr, params);
    }

    if (expr.name === "close") {
      return this.generateClose(expr, params);
    }

    return null;
  }

  private dispatchTreeSitterCalls(expr: CallNode, params: string[]): string | null {
    if (expr.name === "htons") {
      return this.generateHtons(expr, params);
    }

    if (expr.name === "bind") {
      return this.generateBind(expr, params);
    }

    if (expr.name === "listen") {
      return this.generateListen(expr, params);
    }

    if (expr.name === "accept") {
      return this.generateAccept(expr, params);
    }

    return this.dispatchTreeSitterNodeCalls(expr, params);
  }

  private dispatchTreeSitterNodeCalls(expr: CallNode, params: string[]): string | null {
    if (expr.name === "__ts_parse_source") {
      this.ctx.setUsesTreeSitter(true);
      return this.generateTsParseSource(expr, params);
    }

    if (expr.name === "__ts_get_root_node") {
      return this.generateTsGetRootNode(expr, params);
    }

    if (expr.name === "__ts_node_type") {
      return this.generateTsNodeType(expr, params);
    }

    if (expr.name === "__ts_node_child_count") {
      return this.generateTsNodeChildCount(expr, params);
    }

    return this.dispatchTreeSitterAccessCalls(expr, params);
  }

  private dispatchTreeSitterAccessCalls(expr: CallNode, params: string[]): string | null {
    if (expr.name === "__ts_node_named_child_count") {
      return this.generateTsNodeNamedChildCount(expr, params);
    }

    if (expr.name === "__ts_node_child") {
      return this.generateTsNodeChild(expr, params);
    }

    if (expr.name === "__ts_node_named_child") {
      return this.generateTsNodeNamedChild(expr, params);
    }

    if (expr.name === "__ts_node_text") {
      return this.generateTsNodeText(expr, params);
    }

    return this.dispatchTreeSitterQueryCalls(expr, params);
  }

  private dispatchTreeSitterQueryCalls(expr: CallNode, params: string[]): string | null {
    if (expr.name === "__ts_node_is_null") {
      return this.generateTsNodeIsNull(expr, params);
    }

    if (expr.name === "__ts_node_is_named") {
      return this.generateTsNodeIsNamed(expr, params);
    }

    if (expr.name === "__ts_node_start_byte") {
      return this.generateTsNodeStartByte(expr, params);
    }

    return this.dispatchTreeSitterByteCalls(expr, params);
  }

  private dispatchTreeSitterByteCalls(expr: CallNode, params: string[]): string | null {
    if (expr.name === "__ts_node_end_byte") {
      return this.generateTsNodeEndByte(expr, params);
    }

    if (expr.name === "__ts_node_child_by_field_name") {
      return this.generateTsNodeChildByFieldName(expr, params);
    }

    return null;
  }

  private generateParseInt(expr: CallNode, params: string[]): string {
    if (expr.args.length < 1 || expr.args.length > 2) {
      return this.ctx.emitError("parseInt() requires 1 or 2 arguments (string, radix?)", expr.loc);
    }

    // Get the string argument
    const strValue = this.ctx.generateExpression(expr.args[0], params);

    // Get the radix argument (default to 10 if not provided)
    let radixValue: string;
    if (expr.args.length === 2) {
      const radixDouble = this.ctx.generateExpression(expr.args[1], params);
      const dblRadix = this.ctx.ensureDouble(radixDouble);
      radixValue = this.ctx.nextTemp();
      this.ctx.emit(`${radixValue} = fptosi double ${dblRadix} to i32`);
    } else {
      // Default radix is 10
      radixValue = "10";
    }

    // Call strtol(str, null, radix)
    // strtol returns i64, we'll truncate to i32 and then convert to double
    const nullPtr = this.ctx.nextTemp();
    this.ctx.emit(`${nullPtr} = inttoptr i32 0 to i8**`);

    const resultI64 = this.ctx.emitCall(
      "i64",
      "@strtol",
      `i8* ${strValue}, i8** ${nullPtr}, i32 ${radixValue}`,
    );

    // Convert i64 to double for compatibility with ChadScript's numeric type
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i64 ${resultI64} to double`);

    return resultDouble;
  }

  private generateParseFloat(expr: CallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      return this.ctx.emitError("parseFloat() requires exactly 1 argument (string)", expr.loc);
    }

    const strValue = this.ctx.generateExpression(expr.args[0], params);
    const nullPtr = this.ctx.nextTemp();
    this.ctx.emit(`${nullPtr} = inttoptr i32 0 to i8**`);
    const result = this.ctx.emitCall("double", "@strtod", `i8* ${strValue}, i8** ${nullPtr}`);
    return result;
  }

  private generateNumber(expr: CallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      return this.ctx.emitError("Number() requires exactly 1 argument", expr.loc);
    }

    const arg = expr.args[0];
    if (this.ctx.isStringExpression(arg)) {
      const strValue = this.ctx.generateExpression(arg, params);
      const nullPtr = this.ctx.nextTemp();
      this.ctx.emit(`${nullPtr} = inttoptr i32 0 to i8**`);
      const resultDouble = this.ctx.emitCall(
        "double",
        "@strtod",
        `i8* ${strValue}, i8** ${nullPtr}`,
      );
      return resultDouble;
    }
    return this.ctx.generateExpression(arg, params);
  }

  private generateString(expr: CallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      return this.ctx.emitError("String() requires exactly 1 argument", expr.loc);
    }

    const arg = expr.args[0];
    if (this.ctx.isStringExpression(arg)) {
      return this.ctx.generateExpression(arg, params);
    }
    const numValue = this.ctx.generateExpression(arg, params);
    return this.ctx.stringGen.doConvertNumberToString(numValue);
  }

  private generateIsNaN(expr: CallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      return this.ctx.emitError("isNaN() requires exactly 1 argument", expr.loc);
    }

    const arg = expr.args[0];
    let doubleValue: string;
    if (this.ctx.isStringExpression(arg)) {
      const strValue = this.ctx.generateExpression(arg, params);
      const nullPtr = this.ctx.nextTemp();
      this.ctx.emit(`${nullPtr} = inttoptr i32 0 to i8**`);
      doubleValue = this.ctx.emitCall("double", "@strtod", `i8* ${strValue}, i8** ${nullPtr}`);
    } else {
      doubleValue = this.ctx.generateExpression(arg, params);
      doubleValue = this.ctx.ensureDouble(doubleValue);
    }
    const cmpResult = this.ctx.nextTemp();
    this.ctx.emit(`${cmpResult} = fcmp uno double ${doubleValue}, ${doubleValue}`);
    const resultI32 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI32} = zext i1 ${cmpResult} to i32`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  // Bare execSync() delegates to ChildProcessGenerator via the C bridge
  private generateExecSync(expr: CallNode, params: string[]): string {
    return this.ctx.childProcessGen.generateBareExecSync(expr, params);
  }

  private generateMalloc(expr: CallNode, params: string[]): string {
    const sizeDouble = this.ctx.generateExpression(expr.args[0], params);
    const dblSize = this.ctx.ensureDouble(sizeDouble);
    const sizeI64 = this.ctx.nextTemp();
    this.ctx.emit(`${sizeI64} = fptosi double ${dblSize} to i64`);
    const result = this.ctx.emitCall("i8*", "@malloc", `i64 ${sizeI64}`);
    const resultI64 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI64} = ptrtoint i8* ${result} to i64`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i64 ${resultI64} to double`);
    return resultDouble;
  }

  private generateFree(expr: CallNode, params: string[]): string {
    const ptrDouble = this.ctx.generateExpression(expr.args[0], params);
    const dblPtr = this.ctx.ensureDouble(ptrDouble);
    const ptrI64 = this.ctx.nextTemp();
    this.ctx.emit(`${ptrI64} = fptosi double ${dblPtr} to i64`);
    const ptr = this.ctx.nextTemp();
    this.ctx.emit(`${ptr} = inttoptr i64 ${ptrI64} to i8*`);
    this.ctx.emitCallVoid("@free", `i8* ${ptr}`);
    return "0.0";
  }

  private generateSocket(expr: CallNode, params: string[]): string {
    // socket(domain: number, type: number, protocol: number) -> i32
    const domainDouble = this.ctx.generateExpression(expr.args[0], params);
    const typeDouble = this.ctx.generateExpression(expr.args[1], params);
    const protocolDouble = this.ctx.generateExpression(expr.args[2], params);
    const dblDomain = this.ctx.ensureDouble(domainDouble);
    const domain = this.ctx.nextTemp();
    this.ctx.emit(`${domain} = fptosi double ${dblDomain} to i32`);
    const dblType = this.ctx.ensureDouble(typeDouble);
    const type = this.ctx.nextTemp();
    this.ctx.emit(`${type} = fptosi double ${dblType} to i32`);
    const dblProtocol = this.ctx.ensureDouble(protocolDouble);
    const protocol = this.ctx.nextTemp();
    this.ctx.emit(`${protocol} = fptosi double ${dblProtocol} to i32`);
    const resultI32 = this.ctx.emitCall(
      "i32",
      "@socket",
      `i32 ${domain}, i32 ${type}, i32 ${protocol}`,
    );
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  private generateClose(expr: CallNode, params: string[]): string {
    // close(fd: number) -> i32
    const fdDouble = this.ctx.generateExpression(expr.args[0], params);
    const dblFd = this.ctx.ensureDouble(fdDouble);
    const fd = this.ctx.nextTemp();
    this.ctx.emit(`${fd} = fptosi double ${dblFd} to i32`);
    const resultI32 = this.ctx.emitCall("i32", "@close", `i32 ${fd}`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  private generateHtons(expr: CallNode, params: string[]): string {
    const hostshortDouble = this.ctx.generateExpression(expr.args[0], params);
    const dblHostshort = this.ctx.ensureDouble(hostshortDouble);
    const hostshort = this.ctx.nextTemp();
    this.ctx.emit(`${hostshort} = fptosi double ${dblHostshort} to i16`);
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
    const dblFd2 = this.ctx.ensureDouble(fdDouble);
    const fd = this.ctx.nextTemp();
    this.ctx.emit(`${fd} = fptosi double ${dblFd2} to i32`);
    const dblAddr = this.ctx.ensureDouble(addrDouble);
    const addrI64 = this.ctx.nextTemp();
    this.ctx.emit(`${addrI64} = fptosi double ${dblAddr} to i64`);
    const addr = this.ctx.nextTemp();
    this.ctx.emit(`${addr} = inttoptr i64 ${addrI64} to i8*`);
    const dblAddrlen = this.ctx.ensureDouble(addrlenDouble);
    const addrlen = this.ctx.nextTemp();
    this.ctx.emit(`${addrlen} = fptosi double ${dblAddrlen} to i32`);
    const resultI32 = this.ctx.emitCall("i32", "@bind", `i32 ${fd}, i8* ${addr}, i32 ${addrlen}`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  private generateListen(expr: CallNode, params: string[]): string {
    const fdDouble = this.ctx.generateExpression(expr.args[0], params);
    const backlogDouble = this.ctx.generateExpression(expr.args[1], params);
    const dblFd3 = this.ctx.ensureDouble(fdDouble);
    const fd = this.ctx.nextTemp();
    this.ctx.emit(`${fd} = fptosi double ${dblFd3} to i32`);
    const dblBacklog = this.ctx.ensureDouble(backlogDouble);
    const backlog = this.ctx.nextTemp();
    this.ctx.emit(`${backlog} = fptosi double ${dblBacklog} to i32`);
    const resultI32 = this.ctx.emitCall("i32", "@listen", `i32 ${fd}, i32 ${backlog}`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  private generateAccept(expr: CallNode, params: string[]): string {
    const fdDouble = this.ctx.generateExpression(expr.args[0], params);
    const addrDouble = this.ctx.generateExpression(expr.args[1], params);
    const addrlenDouble = this.ctx.generateExpression(expr.args[2], params);
    const dblFd4 = this.ctx.ensureDouble(fdDouble);
    const fd = this.ctx.nextTemp();
    this.ctx.emit(`${fd} = fptosi double ${dblFd4} to i32`);
    const dblAddr2 = this.ctx.ensureDouble(addrDouble);
    const addrI64 = this.ctx.nextTemp();
    this.ctx.emit(`${addrI64} = fptosi double ${dblAddr2} to i64`);
    const addr = this.ctx.nextTemp();
    this.ctx.emit(`${addr} = inttoptr i64 ${addrI64} to i8*`);
    const dblAddrlen2 = this.ctx.ensureDouble(addrlenDouble);
    const addrlenI64 = this.ctx.nextTemp();
    this.ctx.emit(`${addrlenI64} = fptosi double ${dblAddrlen2} to i64`);
    const addrlen = this.ctx.nextTemp();
    this.ctx.emit(`${addrlen} = inttoptr i64 ${addrlenI64} to i32*`);
    const resultI32 = this.ctx.emitCall(
      "i32",
      "@accept",
      `i32 ${fd}, i8* ${addr}, i32* ${addrlen}`,
    );
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  private generateGenericCall(expr: CallNode, params: string[]): string {
    if (this.ctx.symbolTable.isClosure(expr.name)) {
      return this.generateClosureCall(expr, params);
    }

    const resolvedFuncName = this.ctx.resolveImportAlias(expr.name);
    let returnType = "double";
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
      returnType = "%Promise*";
      this.ctx.setUsesPromises(true);
    } else if (funcResult && func.paramTypes && func.paramTypes.length > 0) {
      const normalizedReturnType = func.returnType ? stripNullable(func.returnType) : "";
      if (normalizedReturnType) {
        returnType = mapReturnTypeToLLVM(
          normalizedReturnType,
          this.ctx.isEnumType(normalizedReturnType),
        );
      }
      for (let i = 0; i < func.paramTypes.length; i++) {
        const p = func.paramTypes[i] as string;
        const paramName = func.params[i] || "";
        paramTypes.push(
          mapParamTypeToLLVM(
            p,
            paramName,
            this.ctx.isEnumType(stripNullable(p)),
            this.ctx.interfaceStructGenHasInterface(stripNullable(p)),
          ),
        );
      }
    } else {
      const funcNode = this.getFunctionFromAST(expr.name);
      if (funcNode) {
        const normalizedRetType = funcNode.returnType ? stripNullable(funcNode.returnType) : "";
        if (normalizedRetType) {
          returnType = mapReturnTypeToLLVM(
            normalizedRetType,
            this.ctx.isEnumType(normalizedRetType),
          );
        }
        if (funcNode.parameters) {
          for (let i = 0; i < funcNode.parameters.length; i++) {
            const p = funcNode.parameters[i] as FunctionParameter;
            const pType = p.type || "number";
            paramTypes.push(
              mapParamTypeToLLVM(
                pType,
                p.name || "",
                this.ctx.isEnumType(stripNullable(pType)),
                false,
              ),
            );
          }
        } else if (funcNode.paramTypes) {
          for (let i = 0; i < funcNode.paramTypes.length; i++) {
            const t = funcNode.paramTypes[i];
            const paramName = funcNode.params[i] || "";
            paramTypes.push(
              mapParamTypeToLLVM(t, paramName, this.ctx.isEnumType(stripNullable(t)), false),
            );
          }
        }
      }
    }

    const argsList: string[] = [];

    if (hasOptionalParams) {
      argsList.push(`i32 ${expr.args.length}`);
    }

    const loopLimit =
      func !== null && func.params !== null && func.params.length > 0
        ? func.params.length
        : expr.args.length;
    for (let i = 0; i < loopLimit; i++) {
      if (i < expr.args.length) {
        const paramType = paramTypes[i] || "double";
        const result = this.ctx.generateExpression(expr.args[i], params);
        const resultType = this.ctx.getVariableType(result);
        if (paramType === "double" && resultType === "i8*") {
          argsList.push(`double 0.0`);
        } else if (paramType === "i8*" && resultType === "double") {
          const coerced = this.ctx.nextTemp();
          this.ctx.emit(`${coerced} = bitcast double ${result} to i64`);
          const coerced2 = this.ctx.nextTemp();
          this.ctx.emit(`${coerced2} = inttoptr i64 ${coerced} to i8*`);
          argsList.push(`i8* ${coerced2}`);
        } else if (paramType === "double" && resultType === "i64") {
          const coerced = this.ctx.ensureDouble(result);
          argsList.push(`double ${coerced}`);
        } else if (paramType === "i32" && (resultType === "double" || !resultType)) {
          // FFI: double → i32 (e.g., number literal passed to C int32_t param)
          const coerced = this.ctx.nextTemp();
          this.ctx.emit(`${coerced} = fptosi double ${result} to i32`);
          argsList.push(`i32 ${coerced}`);
        } else if (paramType === "i32" && resultType === "i64") {
          const coerced = this.ctx.nextTemp();
          this.ctx.emit(`${coerced} = trunc i64 ${result} to i32`);
          argsList.push(`i32 ${coerced}`);
        } else if (paramType === "i64" && (resultType === "double" || !resultType)) {
          const coerced = this.ctx.nextTemp();
          this.ctx.emit(`${coerced} = fptosi double ${result} to i64`);
          argsList.push(`i64 ${coerced}`);
        } else if (paramType === "float" && (resultType === "double" || !resultType)) {
          // FFI: double → float (e.g., number literal passed to C float param)
          const coerced = this.ctx.nextTemp();
          this.ctx.emit(`${coerced} = fptrunc double ${result} to float`);
          argsList.push(`float ${coerced}`);
        } else {
          argsList.push(`${paramType} ${result}`);
        }
      } else {
        const paramType = paramTypes[i] || "double";
        let defaultVal = "null";
        if (paramType === "double") defaultVal = "0.0";
        else if (paramType === "float") defaultVal = "0.0";
        else if (
          paramType === "i32" ||
          paramType === "i64" ||
          paramType === "i16" ||
          paramType === "i8"
        )
          defaultVal = "0";
        argsList.push(`${paramType} ${defaultVal}`);
      }
    }

    // Declared functions (TS `declare function`) are external C symbols —
    // use their real name without the _cs_ prefix
    const mangledName =
      func && func.declare ? resolvedFuncName : this.ctx.mangleUserName(resolvedFuncName);

    if (returnType === "void") {
      this.ctx.emitCallVoid(`@${mangledName}`, argsList.join(", "));
      return "0.0";
    }

    const temp = this.ctx.emitCall(returnType, `@${mangledName}`, argsList.join(", "));

    // FFI return type coercion: convert non-standard LLVM types back to
    // ChadScript's type system (double for numbers, i8* for pointers)
    if (returnType === "i32" || returnType === "i16" || returnType === "i8") {
      const coerced = this.ctx.nextTemp();
      this.ctx.emit(`${coerced} = sitofp ${returnType} ${temp} to double`);
      return coerced;
    }
    if (returnType === "i64") {
      const coerced = this.ctx.nextTemp();
      this.ctx.emit(`${coerced} = sitofp i64 ${temp} to double`);
      return coerced;
    }
    if (returnType === "float") {
      const coerced = this.ctx.nextTemp();
      this.ctx.emit(`${coerced} = fpext float ${temp} to double`);
      return coerced;
    }

    return temp;
  }

  private generateClosureCall(expr: CallNode, params: string[]): string {
    const closureMetadata = this.ctx.symbolTable.getClosureMetadata(expr.name);
    if (!closureMetadata) {
      return this.ctx.emitError(`Closure metadata not found for: ${expr.name}`, expr.loc);
    }

    const lambdaName = closureMetadata.lambdaName;
    const envPtrRegister = closureMetadata.envPtrRegister;
    const captures = closureMetadata.captures;

    let returnType = "double";
    if (closureMetadata.returnType === "string") {
      returnType = "i8*";
    } else if (closureMetadata.returnType === "void") {
      returnType = "void";
    }

    const argsList: string[] = [];
    if (captures && captures.length > 0) {
      argsList.push(`i8* ${envPtrRegister}`);
    } else {
      argsList.push("i8* null");
    }

    for (let _cai = 0; _cai < expr.args.length; _cai++) {
      const arg = expr.args[_cai];
      const result = this.ctx.generateExpression(arg, params);
      const coerced = this.ctx.ensureDouble(result);
      argsList.push(`double ${coerced}`);
    }

    if (returnType === "void") {
      this.ctx.emitCallVoid(`@${lambdaName}`, argsList.join(", "));
      return "0.0";
    }

    const temp = this.ctx.emitCall(returnType, `@${lambdaName}`, argsList.join(", "));
    if (returnType === "i8*") {
      this.ctx.setVariableType(temp, "i8*");
    }

    return temp;
  }

  private generateSetTimeout(expr: CallNode, params: string[]): string {
    if (expr.args.length < 2) {
      return this.ctx.emitError("setTimeout() requires 2 arguments (callback, delay_ms)", expr.loc);
    }

    this.ctx.setUsesTimers(true);

    const callbackArg = expr.args[0];
    if (callbackArg.type !== "variable") {
      return this.ctx.emitError("setTimeout() callback must be a function reference", expr.loc);
    }
    const callbackName = (callbackArg as VariableNode).name;

    const delayValue = this.ctx.generateExpression(expr.args[1], params);
    const dblDelay = this.ctx.ensureDouble(delayValue);

    const callbackPtr = this.ctx.emitBitcast(
      `@${this.ctx.mangleUserName(callbackName)}`,
      "void ()*",
      "void ()*",
    );

    const result = this.ctx.emitCall(
      "i8*",
      "@__setTimeout",
      `void ()* ${callbackPtr}, double ${dblDelay}`,
    );

    return result;
  }

  private generateSetInterval(expr: CallNode, params: string[]): string {
    if (expr.args.length < 2) {
      return this.ctx.emitError(
        "setInterval() requires 2 arguments (callback, interval_ms)",
        expr.loc,
      );
    }

    this.ctx.setUsesTimers(true);

    const callbackArg = expr.args[0];
    if (callbackArg.type !== "variable") {
      return this.ctx.emitError("setInterval() callback must be a function reference", expr.loc);
    }
    const callbackName = (callbackArg as VariableNode).name;

    const intervalValue = this.ctx.generateExpression(expr.args[1], params);
    const dblInterval = this.ctx.ensureDouble(intervalValue);

    const callbackPtr = this.ctx.emitBitcast(
      `@${this.ctx.mangleUserName(callbackName)}`,
      "void ()*",
      "void ()*",
    );

    const result = this.ctx.emitCall(
      "i8*",
      "@__setInterval",
      `void ()* ${callbackPtr}, double ${dblInterval}`,
    );

    return result;
  }

  private emitIndentPrintf(prefix: string): void {
    const depth = this.ctx.emitLoad("i32", "@__describe_depth");
    const hasDepth = this.ctx.emitIcmp("sgt", "i32", depth, "0");
    const preLabel = this.ctx.nextLabel(`${prefix}_pre`);
    const loopLabel = this.ctx.nextLabel(`${prefix}_loop`);
    const bodyLabel = this.ctx.nextLabel(`${prefix}_body`);
    const doneLabel = this.ctx.nextLabel(`${prefix}_done`);
    this.ctx.emitBrCond(hasDepth, preLabel, doneLabel);

    this.ctx.emitLabel(preLabel);
    this.ctx.setCurrentLabel(preLabel);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(loopLabel);
    this.ctx.setCurrentLabel(loopLabel);
    const idx = `%__indent_idx_${loopLabel}`;
    const nextIdx = `%__indent_next_${loopLabel}`;
    this.ctx.emit(`${idx} = phi i32 [ 0, %${preLabel} ], [ ${nextIdx}, %${bodyLabel} ]`);
    const cmp = this.ctx.emitIcmp("slt", "i32", idx, depth);
    this.ctx.emitBrCond(cmp, bodyLabel, doneLabel);

    this.ctx.emitLabel(bodyLabel);
    this.ctx.setCurrentLabel(bodyLabel);
    const fmt = this.ctx.nextTemp();
    this.ctx.emit(`${fmt} = getelementptr [3 x i8], [3 x i8]* @.str.indent_unit, i32 0, i32 0`);
    const printResult = this.ctx.nextTemp();
    this.ctx.emit(`${printResult} = call i32 (i8*, ...) @printf(i8* ${fmt})`);
    this.ctx.emit(`${nextIdx} = add i32 ${idx}, 1`);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(doneLabel);
    this.ctx.setCurrentLabel(doneLabel);
  }

  private generateTest(expr: CallNode, params: string[]): string {
    this.ctx.setUsesTestRunner(true);

    const nameValue = this.ctx.generateExpression(expr.args[0], params);

    this.ctx.emitStore("i1", "0", "@__test_current_failed");

    const totalPtr = this.ctx.emitLoad("i32", "@__test_total");
    const totalInc = this.ctx.nextTemp();
    this.ctx.emit(`${totalInc} = add i32 ${totalPtr}, 1`);
    this.ctx.emitStore("i32", totalInc, "@__test_total");

    const callbackArg = expr.args[1];
    let callbackFn: string;

    if (callbackArg.type === "variable") {
      callbackFn = this.ctx.mangleUserName((callbackArg as VariableNode).name);
    } else if (callbackArg.type === "arrow_function") {
      callbackFn = this.ctx.generateExpression(callbackArg, params);
    } else {
      return this.ctx.emitError(
        "test() callback must be a function reference or arrow function",
        expr.loc,
      );
    }

    const callResult = this.ctx.emitCall("double", `@${callbackFn}`, "");

    const failed = this.ctx.emitLoad("i1", "@__test_current_failed");

    const passLabel = this.ctx.nextLabel("test_pass");
    const failLabel = this.ctx.nextLabel("test_fail");
    const mergeLabel = this.ctx.nextLabel("test_merge");

    this.ctx.emitBrCond(failed, failLabel, passLabel);

    this.ctx.emitLabel(passLabel);
    this.ctx.setCurrentLabel(passLabel);
    const passedPtr = this.ctx.emitLoad("i32", "@__test_passed");
    const passedInc = this.ctx.nextTemp();
    this.ctx.emit(`${passedInc} = add i32 ${passedPtr}, 1`);
    this.ctx.emitStore("i32", passedInc, "@__test_passed");
    this.emitIndentPrintf("test_pass_indent");
    const printPass = this.ctx.nextTemp();
    this.ctx.emit(
      `${printPass} = call i32 (i8*, ...) @printf(i8* getelementptr([12 x i8], [12 x i8]* @.str.test_pass, i32 0, i32 0), i8* ${nameValue})`,
    );
    this.ctx.emitBr(mergeLabel);

    this.ctx.emitLabel(failLabel);
    this.ctx.setCurrentLabel(failLabel);
    const failedPtr = this.ctx.emitLoad("i32", "@__test_failed");
    const failedInc = this.ctx.nextTemp();
    this.ctx.emit(`${failedInc} = add i32 ${failedPtr}, 1`);
    this.ctx.emitStore("i32", failedInc, "@__test_failed");
    this.emitIndentPrintf("test_fail_indent");
    const printFail = this.ctx.nextTemp();
    this.ctx.emit(
      `${printFail} = call i32 (i8*, ...) @printf(i8* getelementptr([12 x i8], [12 x i8]* @.str.test_fail, i32 0, i32 0), i8* ${nameValue})`,
    );
    this.ctx.emitBr(mergeLabel);

    this.ctx.emitLabel(mergeLabel);
    this.ctx.setCurrentLabel(mergeLabel);

    return "0.0";
  }

  private generateDescribe(expr: CallNode, params: string[]): string {
    this.ctx.setUsesTestRunner(true);

    const nameValue = this.ctx.generateExpression(expr.args[0], params);

    this.emitIndentPrintf("describe_indent");

    const headerFmt = this.ctx.nextTemp();
    this.ctx.emit(
      `${headerFmt} = getelementptr [4 x i8], [4 x i8]* @.str.describe_header, i32 0, i32 0`,
    );
    const headerPrint = this.ctx.nextTemp();
    this.ctx.emit(
      `${headerPrint} = call i32 (i8*, ...) @printf(i8* ${headerFmt}, i8* ${nameValue})`,
    );

    const oldDepth = this.ctx.emitLoad("i32", "@__describe_depth");
    const newDepth = this.ctx.nextTemp();
    this.ctx.emit(`${newDepth} = add i32 ${oldDepth}, 1`);
    this.ctx.emitStore("i32", newDepth, "@__describe_depth");

    const callbackArg = expr.args[1];
    let callbackFn: string;

    if (callbackArg.type === "variable") {
      callbackFn = this.ctx.mangleUserName((callbackArg as VariableNode).name);
    } else if (callbackArg.type === "arrow_function") {
      callbackFn = this.ctx.generateExpression(callbackArg, params);
    } else {
      return this.ctx.emitError(
        "describe() callback must be a function reference or arrow function",
        expr.loc,
      );
    }

    const callResult = this.ctx.emitCall("double", `@${callbackFn}`, "");

    const restoredDepth = this.ctx.emitLoad("i32", "@__describe_depth");
    const decDepth = this.ctx.nextTemp();
    this.ctx.emit(`${decDepth} = sub i32 ${restoredDepth}, 1`);
    this.ctx.emitStore("i32", decDepth, "@__describe_depth");

    return "0.0";
  }

  private generateClearTimer(expr: CallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError(
        "clearTimeout/clearInterval requires 1 argument (timer_id)",
        expr.loc,
      );
    }

    const timerIdValue = this.ctx.generateExpression(expr.args[0], params);

    this.ctx.emitCallVoid("@__clearTimer", `i8* ${timerIdValue}`);

    return "0.0";
  }

  private generateRunEventLoop(): string {
    this.ctx.setUsesTimers(true);
    this.ctx.emitCallVoid("@__runEventLoop", "");
    return "0.0";
  }

  private generateTsParseSource(expr: CallNode, params: string[]): string {
    const sourceValue = this.ctx.generateExpression(expr.args[0], params);
    const lengthDouble = this.ctx.generateExpression(expr.args[1], params);
    const dblLength = this.ctx.ensureDouble(lengthDouble);
    const lengthI32 = this.ctx.nextTemp();
    this.ctx.emit(`${lengthI32} = fptosi double ${dblLength} to i32`);
    const resultPtr = this.ctx.emitCall(
      "%TSTree*",
      "@__ts_parse_source",
      `i8* ${sourceValue}, i32 ${lengthI32}`,
    );
    const result = this.ctx.emitBitcast(resultPtr, "%TSTree*", "i8*");
    return result;
  }

  private generateTsGetRootNode(expr: CallNode, params: string[]): string {
    const treeValue = this.ctx.generateExpression(expr.args[0], params);
    const treePtr = this.ctx.emitBitcast(treeValue, "i8*", "%TSTree*");
    const resultPtr = this.ctx.emitCall("%TSNode*", "@__ts_get_root_node", `%TSTree* ${treePtr}`);
    const result = this.ctx.emitBitcast(resultPtr, "%TSNode*", "i8*");
    return result;
  }

  private generateTsNodeType(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodePtr = this.ctx.emitBitcast(nodeValue, "i8*", "%TSNode*");
    const result = this.ctx.emitCall("i8*", "@__ts_node_type", `%TSNode* ${nodePtr}`);
    return result;
  }

  private generateTsNodeChildCount(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodePtr = this.ctx.emitBitcast(nodeValue, "i8*", "%TSNode*");
    const resultI32 = this.ctx.emitCall("i32", "@__ts_node_child_count", `%TSNode* ${nodePtr}`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  private generateTsNodeNamedChildCount(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodePtr = this.ctx.emitBitcast(nodeValue, "i8*", "%TSNode*");
    const resultI32 = this.ctx.emitCall(
      "i32",
      "@__ts_node_named_child_count",
      `%TSNode* ${nodePtr}`,
    );
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  private generateTsNodeChild(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodePtr = this.ctx.emitBitcast(nodeValue, "i8*", "%TSNode*");
    const indexDouble = this.ctx.generateExpression(expr.args[1], params);
    const dblIdx = this.ctx.ensureDouble(indexDouble);
    const indexI32 = this.ctx.nextTemp();
    this.ctx.emit(`${indexI32} = fptosi double ${dblIdx} to i32`);
    const resultPtr = this.ctx.emitCall(
      "%TSNode*",
      "@__ts_node_child",
      `%TSNode* ${nodePtr}, i32 ${indexI32}`,
    );
    const result = this.ctx.emitBitcast(resultPtr, "%TSNode*", "i8*");
    return result;
  }

  private generateTsNodeNamedChild(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodePtr = this.ctx.emitBitcast(nodeValue, "i8*", "%TSNode*");
    const indexDouble = this.ctx.generateExpression(expr.args[1], params);
    const dblIdx2 = this.ctx.ensureDouble(indexDouble);
    const indexI32 = this.ctx.nextTemp();
    this.ctx.emit(`${indexI32} = fptosi double ${dblIdx2} to i32`);
    const resultPtr = this.ctx.emitCall(
      "%TSNode*",
      "@__ts_node_named_child",
      `%TSNode* ${nodePtr}, i32 ${indexI32}`,
    );
    const result = this.ctx.emitBitcast(resultPtr, "%TSNode*", "i8*");
    return result;
  }

  private generateTsNodeText(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodePtr = this.ctx.emitBitcast(nodeValue, "i8*", "%TSNode*");
    const sourceValue = this.ctx.generateExpression(expr.args[1], params);
    const result = this.ctx.emitCall(
      "i8*",
      "@__ts_node_text",
      `%TSNode* ${nodePtr}, i8* ${sourceValue}`,
    );
    return result;
  }

  private generateTsNodeIsNull(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodePtr = this.ctx.emitBitcast(nodeValue, "i8*", "%TSNode*");
    const resultI1 = this.ctx.emitCall("i1", "@__ts_node_is_null", `%TSNode* ${nodePtr}`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = uitofp i1 ${resultI1} to double`);
    return resultDouble;
  }

  private generateTsNodeIsNamed(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodePtr = this.ctx.emitBitcast(nodeValue, "i8*", "%TSNode*");
    const resultI1 = this.ctx.emitCall("i1", "@__ts_node_is_named", `%TSNode* ${nodePtr}`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = uitofp i1 ${resultI1} to double`);
    return resultDouble;
  }

  private generateTsNodeStartByte(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodePtr = this.ctx.emitBitcast(nodeValue, "i8*", "%TSNode*");
    const resultI32 = this.ctx.emitCall("i32", "@__ts_node_start_byte", `%TSNode* ${nodePtr}`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  private generateTsNodeEndByte(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodePtr = this.ctx.emitBitcast(nodeValue, "i8*", "%TSNode*");
    const resultI32 = this.ctx.emitCall("i32", "@__ts_node_end_byte", `%TSNode* ${nodePtr}`);
    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i32 ${resultI32} to double`);
    return resultDouble;
  }

  private generateTsNodeChildByFieldName(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodePtr = this.ctx.emitBitcast(nodeValue, "i8*", "%TSNode*");
    const fieldValue = this.ctx.generateExpression(expr.args[1], params);
    const fieldLenDouble = this.ctx.generateExpression(expr.args[2], params);
    const dblFieldLen = this.ctx.ensureDouble(fieldLenDouble);
    const fieldLenI32 = this.ctx.nextTemp();
    this.ctx.emit(`${fieldLenI32} = fptosi double ${dblFieldLen} to i32`);
    const resultPtr = this.ctx.emitCall(
      "%TSNode*",
      "@__ts_node_child_by_field_name",
      `%TSNode* ${nodePtr}, i8* ${fieldValue}, i32 ${fieldLenI32}`,
    );
    const result = this.ctx.emitBitcast(resultPtr, "%TSNode*", "i8*");
    return result;
  }

  private generateSuperCall(expr: CallNode, params: string[]): string {
    const thisPtr = this.ctx.getThisPointer();
    if (!thisPtr) {
      return this.ctx.emitError("super() called outside of class constructor", expr.loc);
    }
    const currentClassName = this.ctx.getCurrentClassName();
    if (!currentClassName) {
      return this.ctx.emitError("super() called outside of class context", expr.loc);
    }
    const ast = this.ctx.getAst();
    if (!ast || !ast.classes) {
      return this.ctx.emitError("super() called but no classes defined", expr.loc);
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
      return this.ctx.emitError(
        `super() called but current class ${currentClassName} has no parent class`,
        expr.loc,
      );
    }
    const parentClassName = currentClass.extends;
    const parentStructType = `%${parentClassName}_struct*`;

    let parentConstructor: ClassMethod | null = null;
    for (let ci = 0; ci < ast.classes.length; ci++) {
      const pc = ast.classes[ci] as ClassNode;
      if (pc.name === parentClassName) {
        for (let mi = 0; mi < pc.methods.length; mi++) {
          const m = pc.methods[mi] as ClassMethod;
          if (m && m.isConstructor) {
            parentConstructor = m;
            break;
          }
        }
        break;
      }
    }
    const parentParamTypes = parentConstructor ? parentConstructor.paramTypes || [] : [];

    const argValues: string[] = [];
    for (let i = 0; i < expr.args.length; i++) {
      argValues.push(this.ctx.generateExpression(expr.args[i], params));
    }
    const argsWithTypesParts: string[] = [];
    for (let ai = 0; ai < argValues.length; ai++) {
      const llvmType =
        ai < parentParamTypes.length
          ? mapParamTypeToLLVM(parentParamTypes[ai], "arg", false, false)
          : "i8*";
      if (llvmType === "double") {
        argsWithTypesParts.push("double " + this.ctx.ensureDouble(argValues[ai]));
      } else {
        argsWithTypesParts.push(llvmType + " " + argValues[ai]);
      }
    }
    const argsWithTypes = argsWithTypesParts.join(", ");
    const parentObj = this.ctx.emitCall(
      parentStructType,
      `@${this.ctx.mangleUserName(parentClassName)}_constructor`,
      argValues.length === 0 ? "" : argsWithTypes,
    );

    const parentFields = this.ctx.classGenGetClassFields(parentClassName);
    if (parentFields.length > 0) {
      const childStructType = `%${currentClassName}_struct*`;
      const castedThis = this.ctx.emitBitcast(thisPtr, "i8*", childStructType);

      for (let i = 0; i < parentFields.length; i++) {
        const parentFieldPtr = this.ctx.nextTemp();
        this.ctx.emit(
          `${parentFieldPtr} = getelementptr inbounds ${parentStructType.slice(0, parentStructType.length - 1)}, ${parentStructType} ${parentObj}, i32 0, i32 ${i}`,
        );
        const thisFieldPtr = this.ctx.nextTemp();
        this.ctx.emit(
          `${thisFieldPtr} = getelementptr inbounds ${childStructType.slice(0, childStructType.length - 1)}, ${childStructType} ${castedThis}, i32 0, i32 ${i}`,
        );
        const fieldLlvmType = this.getFieldLlvmType(parentFields[i]);
        const fieldValue = this.ctx.emitLoad(fieldLlvmType, parentFieldPtr);
        this.ctx.emitStore(fieldLlvmType, fieldValue, thisFieldPtr);
      }
    }
    return "0.0";
  }

  private getFieldLlvmTypeForTsType(tsType: string): string | null {
    if (tsType.startsWith("Map<string,")) return "%StringMap*";
    if (tsType.startsWith("Map<")) return "%Map*";
    if (tsType === "Set<string>") return "%StringSet*";
    if (tsType.startsWith("Set<")) return "%Set*";
    return null;
  }

  private getFieldLlvmType(field: { name: string; fieldType: string; tsType?: string }): string {
    if (field.fieldType === "string") return "i8*";
    if (field.fieldType === "string[]") return "%StringArray*";
    if (field.fieldType.endsWith("[]")) return "%Array*";
    if (field.fieldType === "boolean") return "i1";
    if (field.tsType) {
      const collType = this.getFieldLlvmTypeForTsType(field.tsType);
      if (collType) return collType;
      if (field.tsType === "number" || field.tsType === "boolean") return "double";
      const classFields = this.ctx.classGenGetClassFields(field.tsType);
      if (classFields.length > 0) {
        return `%${field.tsType}_struct*`;
      }
    }
    return "i8*";
  }

  // bytesResponse(data: Uint8Array, status: number, headers: string): HttpResponse
  // Extracts raw pointer + length from Uint8Array and constructs an HttpResponse struct.
  private generateBytesResponse(expr: CallNode, params: string[]): string {
    if (expr.args.length < 3) {
      return this.ctx.emitError(
        "bytesResponse() requires 3 arguments (data, status, headers)",
        expr.loc,
      );
    }

    const arrayPtr = this.ctx.generateExpression(expr.args[0], params);
    const statusRaw = this.ctx.generateExpression(expr.args[1], params);
    const headers = this.ctx.generateExpression(expr.args[2], params);

    // Normalize status to double (may arrive as i64 from integer literals)
    const statusType = this.ctx.getVariableType(statusRaw);
    let status = statusRaw;
    if (statusType === "i64" || statusType === "i32") {
      status = this.ctx.nextTemp();
      this.ctx.emit(`${status} = sitofp ${statusType} ${statusRaw} to double`);
    }

    // Load raw data pointer from Uint8Array field 0
    const dataField = this.ctx.nextTemp();
    this.ctx.emit(
      `${dataField} = getelementptr inbounds %Uint8Array, %Uint8Array* ${arrayPtr}, i32 0, i32 0`,
    );
    const dataPtr = this.ctx.nextTemp();
    this.ctx.emit(`${dataPtr} = load i8*, i8** ${dataField}`);

    // Load length (i32) from Uint8Array field 1, convert to double
    const lenField = this.ctx.nextTemp();
    this.ctx.emit(
      `${lenField} = getelementptr inbounds %Uint8Array, %Uint8Array* ${arrayPtr}, i32 0, i32 1`,
    );
    const lenI32 = this.ctx.nextTemp();
    this.ctx.emit(`${lenI32} = load i32, i32* ${lenField}`);
    const lenDbl = this.ctx.nextTemp();
    this.ctx.emit(`${lenDbl} = sitofp i32 ${lenI32} to double`);

    // Allocate HttpResponse struct: { double, i8*, i8*, double } = 32 bytes
    const respType = "{ double, i8*, i8*, double }";
    const structRaw = this.ctx.emitCall("i8*", "@GC_malloc", "i64 32");
    const structPtr = this.ctx.emitBitcast(structRaw, "i8*", `${respType}*`);

    const f0 = this.ctx.nextTemp();
    this.ctx.emit(`${f0} = getelementptr ${respType}, ${respType}* ${structPtr}, i32 0, i32 0`);
    this.ctx.emitStore("double", status, f0);

    const f1 = this.ctx.nextTemp();
    this.ctx.emit(`${f1} = getelementptr ${respType}, ${respType}* ${structPtr}, i32 0, i32 1`);
    this.ctx.emitStore("i8*", dataPtr, f1);

    const f2 = this.ctx.nextTemp();
    this.ctx.emit(`${f2} = getelementptr ${respType}, ${respType}* ${structPtr}, i32 0, i32 2`);
    this.ctx.emitStore("i8*", headers, f2);

    const f3 = this.ctx.nextTemp();
    this.ctx.emit(`${f3} = getelementptr ${respType}, ${respType}* ${structPtr}, i32 0, i32 3`);
    this.ctx.emitStore("double", lenDbl, f3);

    this.ctx.setVariableType(structRaw, "i8*");
    return structRaw;
  }
}
