// NOTE: This file uses raw ctx.emit() extensively. Prefer structured IR builders
// (emitStore, emitLoad, emitCall, etc.) when modifying — see .claude/rules.md.

import {
  CallNode,
  FunctionNode,
  VariableNode,
  FunctionParameter,
  ClassNode,
  ClassMethod,
  ArrowFunctionNode,
  Expression,
} from "../../ast/types.js";
import { IGeneratorContext } from "../infrastructure/generator-context.js";
import {
  stripNullable,
  isNullableType,
  mapParamTypeToLLVM,
  mapReturnTypeToLLVM,
  classifyArray,
  arrayKindToLlvm,
  ArrayKind_None,
} from "../infrastructure/type-system.js";
import { createStringConstant } from "../types/collections/string/constants.js";
import {
  emitAdd,
  emitSub,
  emitSext,
  emitZext,
  emitTrunc,
  emitSitofp,
  emitFptosi,
  emitPtrtoint,
  emitInttoptr,
  emitSelect,
  emitOr,
  emitShl,
  emitLShr,
  emitFcmp,
  emitAlloca,
} from "../infrastructure/ir-builders.js";

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

    // Promise-executor binding intercept. When codegen is inside the
    // inlined body of `new Promise((resolve, reject) => {...})`, calls to
    // the executor's parameter names route to the bridge directly —
    // resolve(x) → @__Promise_resolve(p, x), reject(e) → @__Promise_reject(p, e).
    const pe = this.ctx.getActivePromiseExecutor();
    if (pe && (expr.name === pe.resolveName || expr.name === pe.rejectName)) {
      const isResolve = expr.name === pe.resolveName;
      const bridgeFn = isResolve ? "@__Promise_resolve" : "@__Promise_reject";
      let valPtr = "null";
      if (expr.args.length > 0) {
        const raw = this.ctx.generateExpression(expr.args[0], params);
        const lt = this.ctx.getVariableType(raw);
        // Bridge takes i8* value — coerce number to string or wrap in
        // ptrtoint. For typical DAP usage the resolved value is a string
        // (JSON response body) so i8* fits directly. For numbers, user
        // will generally resolve with a string or object; if they pass a
        // raw number, inttoptr is the least-surprising lowering (matches
        // how the rest of the codebase boxes primitive payloads).
        if (lt === "double" || lt === "i64" || lt === "i32" || lt === "i8") {
          let asI64: string;
          if (lt === "double") {
            const asI64Tmp = this.ctx.nextTemp();
            this.ctx.emit(`${asI64Tmp} = bitcast double ${raw} to i64`);
            asI64 = asI64Tmp;
          } else {
            asI64 = emitSext(this.ctx, raw, lt, "i64");
          }
          const asPtr = emitInttoptr(this.ctx, asI64, "i64", "i8*");
          valPtr = asPtr;
        } else {
          valPtr = raw;
        }
      }
      this.ctx.emit(`call void ${bridgeFn}(%Promise* ${pe.promisePtr}, i8* ${valPtr})`);
      return "0.0";
    }

    if (expr.name === "callHandler") {
      // callHandler(fnPtr, ...args) — invoke a raw function pointer stored
      // as i8* (typically an object's function-typed field). Previously the
      // bitcast and call used a fixed `double(i8*, i8*, ...)*` shape, which
      // only worked when every arg was actually a pointer. For numeric /
      // boolean args that emitted broken IR (passing i64/double as i8*).
      //
      // Current strategy: generate each arg first, inspect its LLVM type,
      // and mirror that type in both the bitcast signature and the call
      // site. Assumes the function's declared signature matches the types
      // the user is passing — which it must, or the TS would not typecheck.
      const fnPtr = this.ctx.generateExpression(expr.args[0], params);
      const argValues: string[] = [];
      const argTypes: string[] = [];
      for (let ai = 1; ai < expr.args.length; ai++) {
        const rawArgVal = this.ctx.generateExpression(expr.args[ai], params);
        const lt = this.ctx.getVariableType(rawArgVal);
        // ChadScript's 'number' is double in function signatures. Promote
        // integer-typed values (int literals, i64 from integer specialization)
        // to double so the call ABI matches a (number) => ... function.
        let coercedVal = rawArgVal;
        let paramTy: string;
        if (lt === "i64" || lt === "i32" || lt === "i16" || lt === "i8") {
          coercedVal = emitSitofp(this.ctx, rawArgVal, lt);
          paramTy = "double";
        } else if (lt === "i1") {
          const promoted = this.ctx.nextTemp();
          this.ctx.emit(`${promoted} = uitofp i1 ${rawArgVal} to double`);
          coercedVal = promoted;
          paramTy = "double";
        } else if (!lt || lt.length === 0) {
          paramTy = "i8*";
        } else {
          paramTy = lt;
        }
        argValues.push(coercedVal);
        argTypes.push(paramTy);
      }

      const typedFn = this.ctx.nextTemp();
      this.ctx.emit(`${typedFn} = bitcast i8* ${fnPtr} to double (${argTypes.join(", ")})*`);

      const callArgsList: string[] = [];
      for (let i = 0; i < argValues.length; i++) {
        callArgsList.push(`${argTypes[i]} ${argValues[i]}`);
      }
      const callResult = this.ctx.nextTemp();
      this.ctx.emit(`${callResult} = call double ${typedFn}(${callArgsList.join(", ")})`);
      return callResult;
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

    const compressResult = this.dispatchCompressionCalls(expr, params);
    if (compressResult !== null) return compressResult;

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

  private parseFetchArgs(
    expr: CallNode,
    params: string[],
  ): { urlValue: string; methodVal: string; headersVal: string; bodyVal: string } {
    const urlValue = this.ctx.generateExpression(expr.args[0], params);
    let methodVal = "null";
    let headersVal = "null";
    let bodyVal = "null";

    if (expr.args.length >= 2) {
      const optArg = expr.args[1] as {
        type: string;
        properties?: { key: string; value: unknown }[];
      };
      if (optArg.type === "object" && optArg.properties) {
        for (const prop of optArg.properties) {
          if (prop.key === "method") {
            methodVal = this.ctx.generateExpression(prop.value as CallNode, params);
          } else if (prop.key === "body") {
            bodyVal = this.ctx.generateExpression(prop.value as CallNode, params);
          } else if (prop.key === "headers") {
            headersVal = this.generateFetchHeaders(
              prop.value as { type: string; properties?: { key: string; value: unknown }[] },
              params,
            );
          }
        }
      }
    }
    return { urlValue, methodVal, headersVal, bodyVal };
  }

  generateSyncFetch(expr: CallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("fetch() requires at least 1 argument (URL)", expr.loc);
    }
    const { urlValue, methodVal, headersVal, bodyVal } = this.parseFetchArgs(expr, params);
    this.ctx.setUsesCurl(true);
    this.ctx.setUsesJson(true);
    const respPtr = this.ctx.emitCall(
      "%__FetchResponse*",
      "@fetch",
      `i8* ${urlValue}, i8* ${methodVal}, i8* ${headersVal}, i8* ${bodyVal}`,
    );
    const castPtr = this.ctx.emitBitcast(respPtr, "%__FetchResponse*", "i8*");
    return castPtr;
  }

  private dispatchCompressionCalls(expr: CallNode, params: string[]): string | null {
    const compressFns: string[] = [
      "gzip",
      "gunzip",
      "deflateRaw",
      "inflateRaw",
      "zstdCompress",
      "zstdDecompress",
    ];
    const bridgeFns: string[] = [
      "cs_gzip",
      "cs_gunzip",
      "cs_deflate_raw",
      "cs_inflate_raw",
      "cs_zstd_compress",
      "cs_zstd_decompress",
    ];
    let fnIdx = -1;
    for (let i = 0; i < compressFns.length; i++) {
      if (expr.name === compressFns[i]) {
        fnIdx = i;
        break;
      }
    }
    if (fnIdx === -1) return null;
    if (expr.args.length < 1) {
      return this.ctx.emitError(`${expr.name}() requires 1 argument (Uint8Array)`, expr.loc);
    }
    this.ctx.setUsesCompression(true);
    const arrPtr = this.ctx.generateExpression(expr.args[0], params);
    const dataFieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${dataFieldPtr} = getelementptr inbounds %Uint8Array, %Uint8Array* ${arrPtr}, i32 0, i32 0`,
    );
    const dataPtr = this.ctx.emitLoad("i8*", dataFieldPtr);
    const lenFieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${lenFieldPtr} = getelementptr inbounds %Uint8Array, %Uint8Array* ${arrPtr}, i32 0, i32 1`,
    );
    const len = this.ctx.emitLoad("i32", lenFieldPtr);
    const result = this.ctx.emitCall(
      "%Uint8Array*",
      `@${bridgeFns[fnIdx]}`,
      `i8* ${dataPtr}, i32 ${len}`,
    );
    this.ctx.setVariableType(result, "%Uint8Array*");
    return result;
  }

  private dispatchEncodingCalls(expr: CallNode, params: string[]): string | null {
    if (expr.name === "fetch") {
      if (expr.args.length < 1) {
        return this.ctx.emitError("fetch() requires at least 1 argument (URL)", expr.loc);
      }
      const { urlValue, methodVal, headersVal, bodyVal } = this.parseFetchArgs(expr, params);
      this.ctx.setUsesPromises(true);
      this.ctx.setUsesCurl(true);
      this.ctx.setUsesJson(true);

      const temp = this.ctx.emitCall(
        "%Promise*",
        "@fetch_async",
        `i8* ${urlValue}, i8* ${methodVal}, i8* ${headersVal}, i8* ${bodyVal}`,
      );
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
      radixValue = emitFptosi(this.ctx, dblRadix, "i32");
    } else {
      // Default radix is 10
      radixValue = "10";
    }

    const endPtrPtr = emitAlloca(this.ctx, "i8*");

    const resultI64 = this.ctx.emitCall(
      "i64",
      "@strtol",
      `i8* ${strValue}, i8** ${endPtrPtr}, i32 ${radixValue}`,
    );

    const endPtr = this.ctx.emitLoad("i8*", endPtrPtr);
    const noCharsConsumed = this.ctx.emitIcmp("eq", "i8*", endPtr, strValue);

    const validLabel = this.ctx.nextLabel("parseint_valid");
    const nanLabel = this.ctx.nextLabel("parseint_nan");
    const endLabel = this.ctx.nextLabel("parseint_end");

    this.ctx.emitBrCond(noCharsConsumed, nanLabel, validLabel);

    this.ctx.emitLabel(validLabel);
    const resultDouble = emitSitofp(this.ctx, resultI64, "i64");
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(nanLabel);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(endLabel);
    const result = this.ctx.nextTemp();
    this.ctx.emit(
      `${result} = phi double [${resultDouble}, %${validLabel}], [0x7FF8000000000000, %${nanLabel}]`,
    );
    this.ctx.setVariableType(result, "double");

    return result;
  }

  private generateParseFloat(expr: CallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      return this.ctx.emitError("parseFloat() requires exactly 1 argument (string)", expr.loc);
    }

    const strValue = this.ctx.generateExpression(expr.args[0], params);
    const endPtrPtr = emitAlloca(this.ctx, "i8*");
    const rawResult = this.ctx.emitCall("double", "@strtod", `i8* ${strValue}, i8** ${endPtrPtr}`);

    const endPtr = this.ctx.emitLoad("i8*", endPtrPtr);
    const noCharsConsumed = this.ctx.emitIcmp("eq", "i8*", endPtr, strValue);

    const validLabel = this.ctx.nextLabel("parsefloat_valid");
    const nanLabel = this.ctx.nextLabel("parsefloat_nan");
    const endLabel = this.ctx.nextLabel("parsefloat_end");

    this.ctx.emitBrCond(noCharsConsumed, nanLabel, validLabel);

    this.ctx.emitLabel(validLabel);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(nanLabel);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(endLabel);
    const result = this.ctx.nextTemp();
    this.ctx.emit(
      `${result} = phi double [${rawResult}, %${validLabel}], [0x7FF8000000000000, %${nanLabel}]`,
    );
    return result;
  }

  private generateNumber(expr: CallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      return this.ctx.emitError("Number() requires exactly 1 argument", expr.loc);
    }

    const arg = expr.args[0];
    if (this.ctx.isStringExpression(arg)) {
      const strValue = this.ctx.generateExpression(arg, params);
      const endPtrPtr = emitAlloca(this.ctx, "i8*");
      const rawResult = this.ctx.emitCall(
        "double",
        "@strtod",
        `i8* ${strValue}, i8** ${endPtrPtr}`,
      );

      const endPtr = this.ctx.emitLoad("i8*", endPtrPtr);
      const noCharsConsumed = this.ctx.emitIcmp("eq", "i8*", endPtr, strValue);

      const validLabel = this.ctx.nextLabel("number_valid");
      const nanLabel = this.ctx.nextLabel("number_nan");
      const endLabel = this.ctx.nextLabel("number_end");

      this.ctx.emitBrCond(noCharsConsumed, nanLabel, validLabel);

      this.ctx.emitLabel(validLabel);
      this.ctx.emitBr(endLabel);

      this.ctx.emitLabel(nanLabel);
      this.ctx.emitBr(endLabel);

      this.ctx.emitLabel(endLabel);
      const result = this.ctx.nextTemp();
      this.ctx.emit(
        `${result} = phi double [${rawResult}, %${validLabel}], [0x7FF8000000000000, %${nanLabel}]`,
      );
      return result;
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
    let isBool = arg.type === "boolean";
    if (!isBool && arg.type === "variable") {
      const varName = (arg as VariableNode).name;
      isBool = this.ctx.symbolTable.isBoolean(varName);
    }
    const value = this.ctx.generateExpression(arg, params);
    const varType = this.ctx.getVariableType(value);
    if (isBool || varType === "i1") {
      const trueStr = createStringConstant(this.ctx, "true");
      const falseStr = createStringConstant(this.ctx, "false");
      let boolI1: string;
      if (varType === "i1") {
        boolI1 = value;
      } else if (varType === "i64") {
        boolI1 = this.ctx.nextTemp();
        this.ctx.emit(`${boolI1} = icmp ne i64 ${value}, 0`);
      } else {
        boolI1 = emitFcmp(this.ctx, "one", value, "0.0");
      }
      const result = emitSelect(this.ctx, boolI1, "i8*", trueStr, falseStr);
      this.ctx.setVariableType(result, "i8*");
      return result;
    }
    return this.ctx.stringGen.doConvertNumberToString(value);
  }

  private generateIsNaN(expr: CallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      return this.ctx.emitError("isNaN() requires exactly 1 argument", expr.loc);
    }

    const arg = expr.args[0];
    let doubleValue: string;
    if (this.ctx.isStringExpression(arg)) {
      const strValue = this.ctx.generateExpression(arg, params);
      const endPtrPtr = emitAlloca(this.ctx, "i8*");
      const rawResult = this.ctx.emitCall(
        "double",
        "@strtod",
        `i8* ${strValue}, i8** ${endPtrPtr}`,
      );

      const endPtr = this.ctx.emitLoad("i8*", endPtrPtr);
      const noCharsConsumed = this.ctx.emitIcmp("eq", "i8*", endPtr, strValue);

      const numericLabel = this.ctx.nextLabel("isnan_numeric");
      const nonNumericLabel = this.ctx.nextLabel("isnan_nonnumeric");
      const endLabel = this.ctx.nextLabel("isnan_end");

      this.ctx.emitBrCond(noCharsConsumed, nonNumericLabel, numericLabel);

      this.ctx.emitLabel(numericLabel);
      const cmpNumeric = emitFcmp(this.ctx, "uno", rawResult, rawResult);
      const numericI32 = emitZext(this.ctx, cmpNumeric, "i1", "i32");
      const numericDouble = emitSitofp(this.ctx, numericI32, "i32");
      this.ctx.emitBr(endLabel);

      this.ctx.emitLabel(nonNumericLabel);
      this.ctx.emitBr(endLabel);

      this.ctx.emitLabel(endLabel);
      const result = this.ctx.nextTemp();
      this.ctx.emit(
        `${result} = phi double [${numericDouble}, %${numericLabel}], [1.0, %${nonNumericLabel}]`,
      );
      return result;
    } else {
      doubleValue = this.ctx.generateExpression(arg, params);
      doubleValue = this.ctx.ensureDouble(doubleValue);
    }
    const cmpResult = emitFcmp(this.ctx, "uno", doubleValue, doubleValue);
    const resultI32 = emitZext(this.ctx, cmpResult, "i1", "i32");
    const resultDouble = emitSitofp(this.ctx, resultI32, "i32");
    return resultDouble;
  }

  // Bare execSync() delegates to ChildProcessGenerator via the C bridge
  private generateExecSync(expr: CallNode, params: string[]): string {
    return this.ctx.childProcessGen.generateBareExecSync(expr, params);
  }

  private generateMalloc(expr: CallNode, params: string[]): string {
    const sizeDouble = this.ctx.generateExpression(expr.args[0], params);
    const dblSize = this.ctx.ensureDouble(sizeDouble);
    const sizeI64 = emitFptosi(this.ctx, dblSize, "i64");
    const result = this.ctx.emitCall("i8*", "@malloc", `i64 ${sizeI64}`);
    const resultI64 = emitPtrtoint(this.ctx, result, "i8*", "i64");
    const resultDouble = emitSitofp(this.ctx, resultI64, "i64");
    return resultDouble;
  }

  private generateFree(expr: CallNode, params: string[]): string {
    const ptrDouble = this.ctx.generateExpression(expr.args[0], params);
    const dblPtr = this.ctx.ensureDouble(ptrDouble);
    const ptrI64 = emitFptosi(this.ctx, dblPtr, "i64");
    const ptr = emitInttoptr(this.ctx, ptrI64, "i64", "i8*");
    this.ctx.emitCallVoid("@free", `i8* ${ptr}`);
    return "0.0";
  }

  private generateSocket(expr: CallNode, params: string[]): string {
    // socket(domain: number, type: number, protocol: number) -> i32
    const domainDouble = this.ctx.generateExpression(expr.args[0], params);
    const typeDouble = this.ctx.generateExpression(expr.args[1], params);
    const protocolDouble = this.ctx.generateExpression(expr.args[2], params);
    const dblDomain = this.ctx.ensureDouble(domainDouble);
    const domain = emitFptosi(this.ctx, dblDomain, "i32");
    const dblType = this.ctx.ensureDouble(typeDouble);
    const type = emitFptosi(this.ctx, dblType, "i32");
    const dblProtocol = this.ctx.ensureDouble(protocolDouble);
    const protocol = emitFptosi(this.ctx, dblProtocol, "i32");
    const resultI32 = this.ctx.emitCall(
      "i32",
      "@socket",
      `i32 ${domain}, i32 ${type}, i32 ${protocol}`,
    );
    const resultDouble = emitSitofp(this.ctx, resultI32, "i32");
    return resultDouble;
  }

  private generateClose(expr: CallNode, params: string[]): string {
    // close(fd: number) -> i32
    const fdDouble = this.ctx.generateExpression(expr.args[0], params);
    const dblFd = this.ctx.ensureDouble(fdDouble);
    const fd = emitFptosi(this.ctx, dblFd, "i32");
    const resultI32 = this.ctx.emitCall("i32", "@close", `i32 ${fd}`);
    const resultDouble = emitSitofp(this.ctx, resultI32, "i32");
    return resultDouble;
  }

  private generateHtons(expr: CallNode, params: string[]): string {
    const hostshortDouble = this.ctx.generateExpression(expr.args[0], params);
    const dblHostshort = this.ctx.ensureDouble(hostshortDouble);
    const hostshort = emitFptosi(this.ctx, dblHostshort, "i16");
    const hi = emitLShr(this.ctx, "i16", hostshort, "8");
    const lo = emitShl(this.ctx, "i16", hostshort, "8");
    const resultI16 = emitOr(this.ctx, "i16", hi, lo);
    const resultI32 = emitZext(this.ctx, resultI16, "i16", "i32");
    const resultDouble = emitSitofp(this.ctx, resultI32, "i32");
    return resultDouble;
  }

  private generateBind(expr: CallNode, params: string[]): string {
    const fdDouble = this.ctx.generateExpression(expr.args[0], params);
    const addrDouble = this.ctx.generateExpression(expr.args[1], params);
    const addrlenDouble = this.ctx.generateExpression(expr.args[2], params);
    const dblFd2 = this.ctx.ensureDouble(fdDouble);
    const fd = emitFptosi(this.ctx, dblFd2, "i32");
    const dblAddr = this.ctx.ensureDouble(addrDouble);
    const addrI64 = emitFptosi(this.ctx, dblAddr, "i64");
    const addr = emitInttoptr(this.ctx, addrI64, "i64", "i8*");
    const dblAddrlen = this.ctx.ensureDouble(addrlenDouble);
    const addrlen = emitFptosi(this.ctx, dblAddrlen, "i32");
    const resultI32 = this.ctx.emitCall("i32", "@bind", `i32 ${fd}, i8* ${addr}, i32 ${addrlen}`);
    const resultDouble = emitSitofp(this.ctx, resultI32, "i32");
    return resultDouble;
  }

  private generateListen(expr: CallNode, params: string[]): string {
    const fdDouble = this.ctx.generateExpression(expr.args[0], params);
    const backlogDouble = this.ctx.generateExpression(expr.args[1], params);
    const dblFd3 = this.ctx.ensureDouble(fdDouble);
    const fd = emitFptosi(this.ctx, dblFd3, "i32");
    const dblBacklog = this.ctx.ensureDouble(backlogDouble);
    const backlog = emitFptosi(this.ctx, dblBacklog, "i32");
    const resultI32 = this.ctx.emitCall("i32", "@listen", `i32 ${fd}, i32 ${backlog}`);
    const resultDouble = emitSitofp(this.ctx, resultI32, "i32");
    return resultDouble;
  }

  private generateAccept(expr: CallNode, params: string[]): string {
    const fdDouble = this.ctx.generateExpression(expr.args[0], params);
    const addrDouble = this.ctx.generateExpression(expr.args[1], params);
    const addrlenDouble = this.ctx.generateExpression(expr.args[2], params);
    const dblFd4 = this.ctx.ensureDouble(fdDouble);
    const fd = emitFptosi(this.ctx, dblFd4, "i32");
    const dblAddr2 = this.ctx.ensureDouble(addrDouble);
    const addrI64 = emitFptosi(this.ctx, dblAddr2, "i64");
    const addr = emitInttoptr(this.ctx, addrI64, "i64", "i8*");
    const dblAddrlen2 = this.ctx.ensureDouble(addrlenDouble);
    const addrlenI64 = emitFptosi(this.ctx, dblAddrlen2, "i64");
    const addrlen = emitInttoptr(this.ctx, addrlenI64, "i64", "i32*");
    const resultI32 = this.ctx.emitCall(
      "i32",
      "@accept",
      `i32 ${fd}, i8* ${addr}, i32* ${addrlen}`,
    );
    const resultDouble = emitSitofp(this.ctx, resultI32, "i32");
    return resultDouble;
  }

  private generateGenericCall(expr: CallNode, params: string[]): string {
    if (this.ctx.symbolTable.isClosure(expr.name)) {
      return this.generateClosureCall(expr, params);
    }

    // If expr.name isn't a declared top-level function but IS a bound
    // variable, treat it as a function-pointer call: load the i8*, bitcast
    // with arg-type-matching signature, and call indirectly. This is the
    // same lowering pattern as callHandler / obj.fn(args) and unblocks
    //   function cb(...) { ... }
    //   let hook: (...) => void = cb;
    //   hook(args);  // ← used to emit `call @_cs_hook` (no such symbol)
    const astFuncLookup = this.getFunctionFromAST(expr.name);
    if (!astFuncLookup) {
      const allocaReg = this.ctx.symbolTable.getAlloca(expr.name);
      if (allocaReg) {
        return this.generateFunctionPointerCall(expr, params, allocaReg);
      }
    }

    const resolvedFuncName = this.ctx.resolveImportAlias(expr.name);
    let returnType = "double";
    let paramTypes: string[] = [];
    const paramTsTypes: string[] = [];

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

    const funcIsAsync = funcResult ? func.async === true : false;
    if (funcIsAsync) {
      returnType = "%Promise*";
      this.ctx.setUsesPromises(true);
      // Fall through so async funcs with declared paramTypes also get
      // correct arg type resolution. Previously this branch was exclusive
      // with the paramTypes-population branch below, so async calls like
      // `await fwd("abc", 42)` emitted every arg as the default double —
      // string args ended up passed as i64 through strlen/puts and crashed.
    }
    if (funcResult && func.paramTypes && func.paramTypes.length > 0) {
      // For async funcs the returnType is already %Promise* — don't overwrite
      // it. Only non-async funcs should resolve returnType from func.returnType.
      if (!funcIsAsync) {
        const normalizedReturnType = func.returnType ? stripNullable(func.returnType) : "";
        if (normalizedReturnType) {
          returnType = mapReturnTypeToLLVM(
            normalizedReturnType,
            this.ctx.isEnumType(normalizedReturnType),
          );
        }
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
        paramTsTypes.push(stripNullable(p));
      }
      // Integer-specialized callee: every double param/return becomes i64.
      // The existing FFI coercion paths in this loop already handle paramType
      // === "i64" (fptosi from double, or pass-through from i64).
      if (func.intSpecialized) {
        for (let pi = 0; pi < paramTypes.length; pi++) {
          if (paramTypes[pi] === "double") paramTypes[pi] = "i64";
        }
        if (returnType === "double") returnType = "i64";
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
            paramTsTypes.push(stripNullable(pType));
          }
        } else if (funcNode.paramTypes) {
          for (let i = 0; i < funcNode.paramTypes.length; i++) {
            const t = funcNode.paramTypes[i];
            const paramName = funcNode.params[i] || "";
            paramTypes.push(
              mapParamTypeToLLVM(t, paramName, this.ctx.isEnumType(stripNullable(t)), false),
            );
            paramTsTypes.push(stripNullable(t));
          }
        }
        if (funcNode.intSpecialized) {
          for (let pi = 0; pi < paramTypes.length; pi++) {
            if (paramTypes[pi] === "double") paramTypes[pi] = "i64";
          }
          if (returnType === "double") returnType = "i64";
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
        const argExpr = expr.args[i] as { type: string };
        let savedDeclaredIface: string | undefined = undefined;
        let wrappedDeclaredIface = false;
        if (argExpr.type === "object" && i < paramTsTypes.length) {
          const tsParamType = paramTsTypes[i];
          if (tsParamType && this.ctx.interfaceStructGenHasInterface(tsParamType)) {
            savedDeclaredIface = this.ctx.getCurrentDeclaredInterfaceType();
            this.ctx.setCurrentDeclaredInterfaceType(tsParamType);
            wrappedDeclaredIface = true;
          }
        }
        const result = this.ctx.generateExpression(expr.args[i], params);
        if (wrappedDeclaredIface) {
          this.ctx.setCurrentDeclaredInterfaceType(savedDeclaredIface);
        }
        const resultType = this.ctx.getVariableType(result);
        if (paramType === "double" && resultType === "i8*") {
          argsList.push(`double 0.0`);
        } else if (paramType === "i8*" && resultType === "double") {
          const coerced = this.ctx.nextTemp();
          this.ctx.emit(`${coerced} = bitcast double ${result} to i64`);
          const coerced2 = emitInttoptr(this.ctx, coerced, "i64", "i8*");
          argsList.push(`i8* ${coerced2}`);
        } else if (paramType === "double" && resultType === "i64") {
          const coerced = this.ctx.ensureDouble(result);
          argsList.push(`double ${coerced}`);
        } else if (paramType === "i32" && (resultType === "double" || !resultType)) {
          // FFI: double → i32 (e.g., number literal passed to C int32_t param)
          const coerced = emitFptosi(this.ctx, result, "i32");
          argsList.push(`i32 ${coerced}`);
        } else if (paramType === "i32" && resultType === "i64") {
          const coerced = emitTrunc(this.ctx, result, "i64", "i32");
          argsList.push(`i32 ${coerced}`);
        } else if (paramType === "i64" && (resultType === "double" || !resultType)) {
          const coerced = emitFptosi(this.ctx, result, "i64");
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
      const coerced = emitSitofp(this.ctx, temp, returnType);
      return coerced;
    }
    if (returnType === "i64") {
      // Integer-specialized callees keep their result as native i64 so that
      // surrounding integer arithmetic stays in the i64 lane (no fadd round-trip).
      // Other i64-returning extern calls still get coerced to double.
      if (func && func.intSpecialized) {
        this.ctx.setVariableType(temp, "i64");
        return temp;
      }
      const coerced = emitSitofp(this.ctx, temp, "i64");
      return coerced;
    }
    if (returnType === "float") {
      const coerced = this.ctx.nextTemp();
      this.ctx.emit(`${coerced} = fpext float ${temp} to double`);
      return coerced;
    }

    // FFI null-string coercion: `declare function f(): string` returning NULL
    // from C should round-trip to TS as the empty string so `result === ""`
    // works reliably. Only applied to user-declared extern functions (not
    // internal runtime calls, which rely on NULL sentinels internally).
    // SKIP this coercion when the declared return type is `string | null` —
    // those callers explicitly want to observe NULL as JS null.
    if (returnType === "i8*" && func && func.declare) {
      const declaredRet = func.returnType || "";
      if (!isNullableType(declaredRet)) {
        const emptyStr = this.ctx.stringGen.doCreateStringConstant("");
        const isNull = this.ctx.nextTemp();
        this.ctx.emit(`${isNull} = icmp eq i8* ${temp}, null`);
        const coerced = emitSelect(this.ctx, isNull, "i8*", emptyStr, temp);
        this.ctx.setVariableType(coerced, "i8*");
        return coerced;
      }
      this.ctx.setVariableType(temp, "i8*");
      return temp;
    }

    return temp;
  }

  /**
   * Call a function pointer stored in a variable — e.g. `let cb = namedFn; cb(args)`.
   * Mirrors the callHandler lowering: load the i8* from the variable's
   * alloca, bitcast to a function signature whose parameter types are
   * inferred from the arg values (with integer → double promotion for
   * ChadScript's number ABI), and call indirectly.
   */
  private generateFunctionPointerCall(expr: CallNode, params: string[], allocaReg: string): string {
    const fnPtr = this.ctx.emitLoad("i8*", allocaReg);
    const argValues: string[] = [];
    const argTypes: string[] = [];
    for (let i = 0; i < expr.args.length; i++) {
      const rawVal = this.ctx.generateExpression(expr.args[i], params);
      const lt = this.ctx.getVariableType(rawVal);
      let coercedVal = rawVal;
      let paramTy: string;
      if (lt === "i64" || lt === "i32" || lt === "i16" || lt === "i8") {
        coercedVal = emitSitofp(this.ctx, rawVal, lt);
        paramTy = "double";
      } else if (lt === "i1") {
        const promoted = this.ctx.nextTemp();
        this.ctx.emit(`${promoted} = uitofp i1 ${rawVal} to double`);
        coercedVal = promoted;
        paramTy = "double";
      } else if (!lt || lt.length === 0) {
        paramTy = "i8*";
      } else {
        paramTy = lt;
      }
      argValues.push(coercedVal);
      argTypes.push(paramTy);
    }

    const typedFn = this.ctx.nextTemp();
    this.ctx.emit(`${typedFn} = bitcast i8* ${fnPtr} to double (${argTypes.join(", ")})*`);
    const callArgsList: string[] = [];
    for (let i = 0; i < argValues.length; i++) {
      callArgsList.push(`${argTypes[i]} ${argValues[i]}`);
    }
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call double ${typedFn}(${callArgsList.join(", ")})`);
    return result;
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

    if (lambdaName === "") {
      const allocaReg = this.ctx.symbolTable.getAlloca(expr.name);
      if (!allocaReg) {
        return this.ctx.emitError(`Function value '${expr.name}' not found`, expr.loc);
      }
      const pairPtr = this.ctx.emitLoad("i8*", allocaReg);
      const fnSlot = this.ctx.emitBitcast(pairPtr, "i8*", "i8**");
      const rawFnPtr = this.ctx.emitLoad("i8*", fnSlot);
      const envSlot = this.ctx.nextTemp();
      this.ctx.emit(`${envSlot} = getelementptr i8*, i8** ${fnSlot}, i32 1`);
      const indirectEnvPtr = this.ctx.emitLoad("i8*", envSlot);

      let funcSig = returnType + " (i8*";
      const paramTypeStr = closureMetadata.envStructName;
      const closureParamTypes = paramTypeStr.length > 0 ? paramTypeStr.split(",") : [];
      for (let i = 0; i < expr.args.length; i++) {
        let pt = "number";
        if (i < closureParamTypes.length) {
          pt = closureParamTypes[i];
        }
        if (pt === "string") {
          funcSig = funcSig + ", i8*";
        } else {
          funcSig = funcSig + ", double";
        }
      }
      funcSig = funcSig + ")*";

      const fnPtr = this.ctx.emitBitcast(rawFnPtr, "i8*", funcSig);

      const indirectArgsList: string[] = [];
      indirectArgsList.push("i8* " + indirectEnvPtr);
      for (let i = 0; i < expr.args.length; i++) {
        const arg = expr.args[i];
        const result = this.ctx.generateExpression(arg, params);
        let pt = "number";
        if (i < closureParamTypes.length) {
          pt = closureParamTypes[i];
        }
        if (pt === "string") {
          indirectArgsList.push("i8* " + result);
        } else {
          const coerced = this.ctx.ensureDouble(result);
          indirectArgsList.push("double " + coerced);
        }
      }

      if (returnType === "void") {
        this.ctx.emit("call void " + fnPtr + "(" + indirectArgsList.join(", ") + ")");
        return "0.0";
      }

      const indirectTemp = this.ctx.nextTemp();
      this.ctx.emit(
        indirectTemp +
          " = call " +
          returnType +
          " " +
          fnPtr +
          "(" +
          indirectArgsList.join(", ") +
          ")",
      );
      if (returnType === "i8*") {
        this.ctx.setVariableType(indirectTemp, "i8*");
      }
      return indirectTemp;
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

    const resolved = this.resolveTimerCallback(expr.args[0] as Expression, params, "setTimeout");

    const delayValue = this.ctx.generateExpression(expr.args[1], params);
    const dblDelay = this.ctx.ensureDouble(delayValue);

    const result = this.ctx.emitCall(
      "i8*",
      "@__setTimeout",
      `i8* ${resolved.fnPtrI8}, i32 ${resolved.handle}, double ${dblDelay}`,
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

    const resolved = this.resolveTimerCallback(expr.args[0] as Expression, params, "setInterval");

    const intervalValue = this.ctx.generateExpression(expr.args[1], params);
    const dblInterval = this.ctx.ensureDouble(intervalValue);

    const result = this.ctx.emitCall(
      "i8*",
      "@__setInterval",
      `i8* ${resolved.fnPtrI8}, i32 ${resolved.handle}, double ${dblInterval}`,
    );

    return result;
  }

  /**
   * Resolve a setTimeout/setInterval callback arg into `{fnPtrI8, handle}`.
   *
   * - VariableNode: named function reference -> bare `void()*` bitcast to i8*,
   *   handle = -1 (timer wrapper invokes directly).
   * - ArrowFunctionNode: lifts the arrow, boxes env + lifted-fn-ptr into a
   *   TrampEnv on the GC heap, registers a slot via cs_tramp_alloc, and picks
   *   the per-shape trampoline `void(i8* env)` from the emitter.
   *
   * Mirrors `ChildProcessGenerator.resolveCallback` (PR2). Timer callbacks
   * take no native args — shape is `void(i8*)`.
   */
  private resolveTimerCallback(
    arg: Expression,
    params: string[],
    api: "setTimeout" | "setInterval",
  ): { fnPtrI8: string; handle: string } {
    const argBase = arg as { type: string };

    if (argBase.type === "variable") {
      const fnName = this.ctx.mangleUserName((arg as VariableNode).name);
      const bc = this.ctx.nextTemp();
      this.ctx.emit(`${bc} = bitcast void ()* @${fnName} to i8*`);
      return { fnPtrI8: bc, handle: "-1" };
    }

    if (argBase.type !== "arrow_function") {
      return {
        fnPtrI8: this.ctx.emitError(
          `${api}() callback must be a function reference or arrow function`,
          (arg as { loc?: unknown }).loc as never,
        ),
        handle: "-1",
      };
    }

    // Arrow function path. If the arrow has captures, the lifted lambda takes
    // `i8* env` as first param and we dispatch through a trampoline. If not,
    // it's a plain C-shape void() — pass directly, handle = -1.

    const prevParamTypes = this.ctx.getExpectedCallbackParamTypes();
    const prevReturnType = this.ctx.getExpectedCallbackReturnType();
    this.ctx.setExpectedCallbackParamTypes([]);
    this.ctx.setExpectedCallbackReturnType("void");

    const lambdaName = this.ctx.generateExpression(arg as ArrowFunctionNode, params);
    const envPtrRaw = this.ctx.getLastInlineLambdaEnvPtr();
    this.ctx.setLastInlineLambdaEnvPtr(null);
    this.ctx.setExpectedCallbackParamTypes(prevParamTypes ? prevParamTypes : null);
    this.ctx.setExpectedCallbackReturnType(prevReturnType ? prevReturnType : null);

    if (!envPtrRaw) {
      const bc = this.ctx.nextTemp();
      this.ctx.emit(`${bc} = bitcast void ()* @${this.ctx.mangleUserName(lambdaName)} to i8*`);
      return { fnPtrI8: bc, handle: "-1" };
    }

    this.ctx.setUsesTrampolines(true);
    const userEnv = envPtrRaw;

    const trampName = this.ctx.trampolineEmitter.ensureTrampoline({
      llvmSig: "void(i8*)",
      argTypes: [],
      returnType: "void",
    });

    // TrampEnv = { i8* user_env, i8* user_fn_as_i8 }. Store lifted fn as i8*
    // to sidestep the codegen store-type validator — the trampoline bitcasts
    // back to the concrete fn-ptr type at invocation.
    const tEnvRaw = this.ctx.nextTemp();
    this.ctx.emit(`${tEnvRaw} = call i8* @GC_malloc(i64 16)`);
    const uePtr = this.ctx.nextTemp();
    this.ctx.emit(`${uePtr} = bitcast i8* ${tEnvRaw} to i8**`);
    this.ctx.emit(`store i8* ${userEnv}, i8** ${uePtr}`);
    const fpByte = this.ctx.nextTemp();
    this.ctx.emit(`${fpByte} = getelementptr i8, i8* ${tEnvRaw}, i64 8`);
    const fpTyped = this.ctx.nextTemp();
    this.ctx.emit(`${fpTyped} = bitcast i8* ${fpByte} to i8**`);
    const fnI8 = this.ctx.nextTemp();
    this.ctx.emit(`${fnI8} = bitcast void (i8*)* @${this.ctx.mangleUserName(lambdaName)} to i8*`);
    this.ctx.emit(`store i8* ${fnI8}, i8** ${fpTyped}`);

    const handleI32 = this.ctx.nextTemp();
    this.ctx.emit(`${handleI32} = call i32 @cs_tramp_alloc(i8* ${tEnvRaw})`);

    const trampFnType = "void (i8*)*";
    const trampI8 = this.ctx.nextTemp();
    this.ctx.emit(`${trampI8} = bitcast ${trampFnType} ${trampName} to i8*`);

    return { fnPtrI8: trampI8, handle: handleI32 };
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
    const totalInc = emitAdd(this.ctx, "i32", totalPtr, "1");
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

    const envPtr = this.ctx.getLastInlineLambdaEnvPtr();
    const callArgs = envPtr ? `i8* ${envPtr}` : "";
    this.ctx.emitCallVoid(`@${callbackFn}`, callArgs);
    if (envPtr) this.ctx.setLastInlineLambdaEnvPtr(null);

    const failed = this.ctx.emitLoad("i1", "@__test_current_failed");

    const passLabel = this.ctx.nextLabel("test_pass");
    const failLabel = this.ctx.nextLabel("test_fail");
    const mergeLabel = this.ctx.nextLabel("test_merge");

    this.ctx.emitBrCond(failed, failLabel, passLabel);

    this.ctx.emitLabel(passLabel);
    this.ctx.setCurrentLabel(passLabel);
    const passedPtr = this.ctx.emitLoad("i32", "@__test_passed");
    const passedInc = emitAdd(this.ctx, "i32", passedPtr, "1");
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
    const failedInc = emitAdd(this.ctx, "i32", failedPtr, "1");
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
    const newDepth = emitAdd(this.ctx, "i32", oldDepth, "1");
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

    const descEnvPtr = this.ctx.getLastInlineLambdaEnvPtr();
    const descCallArgs = descEnvPtr ? `i8* ${descEnvPtr}` : "";
    this.ctx.emitCallVoid(`@${callbackFn}`, descCallArgs);
    if (descEnvPtr) this.ctx.setLastInlineLambdaEnvPtr(null);

    const restoredDepth = this.ctx.emitLoad("i32", "@__describe_depth");
    const decDepth = emitSub(this.ctx, "i32", restoredDepth, "1");
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
    const lengthI32 = emitFptosi(this.ctx, dblLength, "i32");
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
    const resultDouble = emitSitofp(this.ctx, resultI32, "i32");
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
    const resultDouble = emitSitofp(this.ctx, resultI32, "i32");
    return resultDouble;
  }

  private generateTsNodeChild(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodePtr = this.ctx.emitBitcast(nodeValue, "i8*", "%TSNode*");
    const indexDouble = this.ctx.generateExpression(expr.args[1], params);
    const dblIdx = this.ctx.ensureDouble(indexDouble);
    const indexI32 = emitFptosi(this.ctx, dblIdx, "i32");
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
    const indexI32 = emitFptosi(this.ctx, dblIdx2, "i32");
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
    const resultDouble = emitSitofp(this.ctx, resultI32, "i32");
    return resultDouble;
  }

  private generateTsNodeEndByte(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodePtr = this.ctx.emitBitcast(nodeValue, "i8*", "%TSNode*");
    const resultI32 = this.ctx.emitCall("i32", "@__ts_node_end_byte", `%TSNode* ${nodePtr}`);
    const resultDouble = emitSitofp(this.ctx, resultI32, "i32");
    return resultDouble;
  }

  private generateTsNodeChildByFieldName(expr: CallNode, params: string[]): string {
    const nodeValue = this.ctx.generateExpression(expr.args[0], params);
    const nodePtr = this.ctx.emitBitcast(nodeValue, "i8*", "%TSNode*");
    const fieldValue = this.ctx.generateExpression(expr.args[1], params);
    const fieldLenDouble = this.ctx.generateExpression(expr.args[2], params);
    const dblFieldLen = this.ctx.ensureDouble(fieldLenDouble);
    const fieldLenI32 = emitFptosi(this.ctx, dblFieldLen, "i32");
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
    if (field.fieldType === "number") return "double";
    if (field.fieldType === "string[]") return "%StringArray*";
    const ftAk = classifyArray(field.fieldType);
    if (ftAk !== ArrayKind_None) return arrayKindToLlvm(ftAk);
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
    if (field.fieldType === "i8*" || field.fieldType === "double" || field.fieldType === "i1")
      return field.fieldType;
    if (field.fieldType.startsWith("%")) return field.fieldType;
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
      status = emitSitofp(this.ctx, statusRaw, statusType);
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
    const lenDbl = emitSitofp(this.ctx, lenI32, "i32");

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

  private generateFetchHeaders(
    headersObj: { type: string; properties?: { key: string; value: unknown }[] },
    params: string[],
  ): string {
    if (
      headersObj.type !== "object" ||
      !headersObj.properties ||
      headersObj.properties.length === 0
    ) {
      return "null";
    }

    let result = createStringConstant(this.ctx, "");
    for (const prop of headersObj.properties) {
      const keyStr = createStringConstant(this.ctx, prop.key + ": ");
      const valStr = this.ctx.generateExpression(prop.value as CallNode, params);
      const nlStr = createStringConstant(this.ctx, "\n");

      const keyLen = this.ctx.emitCall("i64", "@strlen", `i8* ${keyStr}`);
      const valLen = this.ctx.emitCall("i64", "@strlen", `i8* ${valStr}`);
      const nlLen = this.ctx.emitCall("i64", "@strlen", `i8* ${nlStr}`);
      const prevLen = this.ctx.emitCall("i64", "@strlen", `i8* ${result}`);

      const totalLen = emitAdd(this.ctx, "i64", prevLen, keyLen);
      const totalLen2 = emitAdd(this.ctx, "i64", totalLen, valLen);
      const totalLen3 = emitAdd(this.ctx, "i64", totalLen2, nlLen);
      const allocSize = emitAdd(this.ctx, "i64", totalLen3, "1");

      const buf = this.ctx.emitCall("i8*", "@GC_malloc_atomic", `i64 ${allocSize}`);
      this.ctx.emitCallVoid("@strcpy", `i8* ${buf}, i8* ${result}`);
      this.ctx.emitCallVoid("@strcat", `i8* ${buf}, i8* ${keyStr}`);
      this.ctx.emitCallVoid("@strcat", `i8* ${buf}, i8* ${valStr}`);
      this.ctx.emitCallVoid("@strcat", `i8* ${buf}, i8* ${nlStr}`);
      result = buf;
    }
    this.ctx.setVariableType(result, "i8*");
    return result;
  }
}
