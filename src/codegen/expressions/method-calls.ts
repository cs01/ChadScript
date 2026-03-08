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

import {
  Expression,
  MethodCallNode,
  VariableNode,
  AST,
  ClassNode,
  FunctionNode,
  MemberAccessNode,
  InterfaceDeclaration,
  SourceLocation,
} from "../../ast/types.js";
import type { SymbolTable } from "../infrastructure/symbol-table.js";
import type {
  IStringGenerator,
  IFsGenerator,
  IPathGenerator,
  IJsonGenerator,
  IMathGenerator,
  IDateGenerator,
  ICryptoGenerator,
  ISqliteGenerator,
  IResponseGenerator,
  IRegexGenerator,
  IArrowFunctionGenerator,
  IStringMapGenerator,
  IMapGenerator,
  ISetGenerator,
  IStringSetGenerator,
  IPointerMapGenerator,
  IArrayGenerator,
  IChildProcessGenerator,
  IEmbedGenerator,
} from "../infrastructure/generator-context.js";
import { parseMapTypeString, parseSetTypeString } from "../infrastructure/type-system.js";
import {
  isProcessStdoutOrStderr,
  handleProcessWrite,
  generateProcessExitInline,
  generateProcessCwdInline,
  handleProcessChdir,
  handleProcessKill,
  handleProcessUptime,
  handleProcessSyscallI32,
} from "./method-calls/process.js";
import {
  generateConsoleCallInline,
  generateConsoleTime,
  generateConsoleTimeEnd,
} from "./method-calls/console.js";
import {
  handleAssertStrictEqual,
  handleAssertNotStrictEqual,
  handleAssertOk,
  handleAssertDeepEqual,
  handleAssertFail,
} from "./method-calls/assert.js";
import {
  handleOsHostname,
  handleOsHomedir,
  handleOsTmpdir,
  handleOsCpus,
  handleOsTotalmem,
  handleOsFreemem,
  handleOsUptime,
} from "./method-calls/os.js";
import {
  generateObjectKeys,
  generateObjectValues,
  generateObjectEntries,
} from "./method-calls/object-static.js";
import { handlePromiseStaticMethods } from "./method-calls/promise-handlers.js";
import {
  handleFsMethod,
  handlePathMethod,
  handleChildProcessMethod,
  handleBufferFrom,
  handleStringFromCharCode,
  handleUint8ArrayFromRawBytes,
  handleTtyIsatty,
} from "./method-calls/named-object-dispatch.js";
import {
  handleSubstr,
  handleSubstring,
  handleConcat,
  handleRepeat,
  handlePadStart,
  handlePadEnd,
  handleSplit,
  handleStartsWith,
  handleEndsWith,
  handleTrim,
  handleTrimStart,
  handleTrimEnd,
  handleIndexOf,
  handleLastIndexOf,
  handleStringArrayIndexOf,
  handleStringArrayIncludes,
  handleStringIncludes,
  handleSlice,
  handleReplace,
  handleReplaceAll,
  handleNumberToString,
  handleNumberToFixed,
  handleCharAt,
  handleCharCodeAt,
  handleToUpperCase,
  handleToLowerCase,
  handleMatch,
  handleNumberIsFinite,
  handleNumberIsNaN,
  handleNumberIsInteger,
} from "./method-calls/string-methods.js";
import { handlePromiseThen, handlePromiseFinally } from "./method-calls/promise-handlers.js";
import {
  handleClassMethods,
  handleObjectMethods,
  getInterfaceFromAST,
} from "./method-calls/class-dispatch.js";

interface ExprBase {
  type: string;
}

interface InterfaceDefInfo {
  properties: { name: string; type: string }[];
}

export interface MethodCallGeneratorContext {
  nextTemp(): string;
  nextLabel(prefix: string): string;
  emit(instruction: string): void;
  getCurrentLabel(): string;
  setCurrentLabel(label: string): void;
  emitStore(type: string, value: string, ptr: string): void;
  emitLoad(type: string, ptr: string): string;
  emitCall(retType: string, func: string, args: string): string;
  emitCallVoid(func: string, args: string): void;
  emitBitcast(value: string, fromType: string, toType: string): string;
  emitIcmp(pred: string, type: string, lhs: string, rhs: string): string;
  emitBr(label: string): void;
  emitBrCond(cond: string, thenLabel: string, elseLabel: string): void;
  emitLabel(name: string): void;
  emitGep(baseType: string, ptr: string, indices: string): string;
  generateExpression(expr: Expression, params: string[]): string;
  isStringExpression(expr: Expression): boolean;
  isArrayExpression(expr: Expression): boolean;
  isStringArrayExpression(expr: Expression): boolean;
  isObjectArrayExpression(expr: Expression): boolean;
  isRegexExpression(expr: Expression): boolean;
  isPromiseExpression(expr: Expression): boolean;
  emitError(message: string, loc?: SourceLocation, suggestion?: string): never;
  emitWarning(message: string, loc?: SourceLocation, suggestion?: string): void;
  mangleUserName(name: string): string;
  symbolTable: SymbolTable;
  variableTypes: Map<string, string>;
  getVariableType(name: string): string | undefined;
  setVariableType(name: string, type: string): void;
  thisPointer: string | null;
  getThisPointer(): string | null;
  currentClassName: string | null;
  getCurrentClassName(): string | null;
  currentFunction?: string | null;
  getCurrentFunction(): string | null;
  ast: AST;
  getAst(): AST | undefined;
  getAstInterfacesLength(): number;
  getAstInterfaceNameAt(index: number): string | null;
  getAstInterfaceAt(index: number): InterfaceDeclaration | null;
  getAstClassesLength(): number;
  getAstClassNameAt(index: number): string | null;
  getAstClassAt(index: number): ClassNode | null;
  getAstFunctionsLength(): number;
  getAstFunctionAt(index: number): FunctionNode | null;
  getAstFunctionNameAt(index: number): string | null;
  setUsesPromises(value: boolean): void;
  setUsesSqlite(value: boolean): void;
  setUsesCurl(value: boolean): void;
  setUsesUvHrtime(value: boolean): void;
  setUsesConsoleTime(value: boolean): void;
  setUsesCrypto(value: boolean): void;
  setUsesJson(value: boolean): void;
  setUsesHttpServer(value: boolean): void;
  setUsesMultipart(value: boolean): void;
  setUsesTestRunner(value: boolean): void;
  classGenGetFieldInfo(
    className: string | null,
    fieldName: string | null,
  ): { index: number; type: string; tsType?: string } | null;
  classGenGenerateMethodCall(
    instancePtr: string,
    className: string,
    method: string,
    args: Expression[],
    params: string[],
  ): string;
  classGenGenerateStaticMethodCall(
    className: string,
    method: string,
    args: Expression[],
    params: string[],
  ): string;
  classGenIsStaticMethod(className: string, methodName: string): boolean;
  typeResolverGetThisFieldMapKeyType(expr: Expression): string | null;
  typeResolverGetThisFieldSetValueType(expr: Expression): string | null;
  readonly arrowFunctionGen: IArrowFunctionGenerator;
  getActualClassType(name: string): string | undefined;
  findClassImplementingInterface(interfaceName: string): string | null;
  readonly stringGen: IStringGenerator;
  readonly fsGen: IFsGenerator;
  readonly pathGen: IPathGenerator;
  readonly jsonGen: IJsonGenerator;
  readonly mathGen: IMathGenerator;
  readonly dateGen: IDateGenerator;
  readonly cryptoGen: ICryptoGenerator;
  readonly sqliteGen: ISqliteGenerator;
  readonly responseGen: IResponseGenerator;
  readonly regexGen: IRegexGenerator;
  readonly stringMapGen: IStringMapGenerator;
  readonly mapGen: IMapGenerator;
  readonly setGen: ISetGenerator;
  readonly stringSetGen: IStringSetGenerator;
  readonly pointerMapGen: IPointerMapGenerator;
  readonly arrayGen: IArrayGenerator;
  readonly childProcessGen: IChildProcessGenerator;
  readonly embedGen: IEmbedGenerator;
  readonly typeResolver?: {
    getThisFieldMapKeyType(expr: Expression): string | null;
    getThisFieldSetValueType(expr: Expression): string | null;
  };
  ensureDouble(value: string): string;
  ensureI64(value: string): string;
  getWantsBinaryReturn(): boolean;
  isUint8ArrayExpression(expr: Expression): boolean;
  setUsesOs(value: boolean): void;
}

export class MethodCallGenerator {
  constructor(private ctx: MethodCallGeneratorContext) {}

  // Optional method call: obj?.method() — null-check obj, skip call if null
  private generateOptionalMethodCall(expr: MethodCallNode, params: string[]): string {
    const objValue = this.ctx.generateExpression(expr.object, params);
    const objType = this.ctx.getVariableType(objValue) || "i8*";

    // Non-pointer types can't be null, just call normally
    if (objType === "double" || objType === "i32" || objType === "i64" || objType === "i1") {
      const nonOptExpr: MethodCallNode = {
        type: "method_call",
        object: expr.object,
        method: expr.method,
        args: expr.args,
        loc: expr.loc,
      };
      return this.generate(nonOptExpr, params);
    }

    const checkType = objType.startsWith("%{") ? "i8*" : objType;
    const isNull = this.ctx.nextTemp();
    this.ctx.emit(`${isNull} = icmp eq ${checkType} ${objValue}, null`);

    const callLabel = this.ctx.nextLabel("optcall");
    const nullLabel = this.ctx.nextLabel("optcall_null");
    const endLabel = this.ctx.nextLabel("optcall_end");

    this.ctx.emit(`br i1 ${isNull}, label %${nullLabel}, label %${callLabel}`);

    this.ctx.emit(`${callLabel}:`);
    this.ctx.setCurrentLabel(callLabel);
    // Call with optional stripped so we don't recurse
    const nonOptExpr: MethodCallNode = {
      type: "method_call",
      object: expr.object,
      method: expr.method,
      args: expr.args,
      loc: expr.loc,
    };
    const callResult = this.generate(nonOptExpr, params);
    const resultType = this.ctx.getVariableType(callResult) || "double";
    const callEndLabel = this.ctx.getCurrentLabel();
    this.ctx.emit(`br label %${endLabel}`);

    this.ctx.emit(`${nullLabel}:`);
    this.ctx.setCurrentLabel(nullLabel);
    let nullValue: string;
    if (resultType === "double") nullValue = "0.0";
    else if (resultType === "i1") nullValue = "false";
    else if (resultType === "i32") nullValue = "0";
    else nullValue = "null";
    this.ctx.emit(`br label %${endLabel}`);

    this.ctx.emit(`${endLabel}:`);
    this.ctx.setCurrentLabel(endLabel);
    const result = this.ctx.nextTemp();
    this.ctx.emit(
      `${result} = phi ${resultType} [ ${callResult}, %${callEndLabel} ], [ ${nullValue}, %${nullLabel} ]`,
    );
    this.ctx.setVariableType(result, resultType);
    return result;
  }

  private isClassInstanceExpression(expr: Expression): boolean {
    const e = expr as ExprBase;
    if (e.type !== "variable") return false;
    const varName = (expr as VariableNode).name;
    return this.ctx.symbolTable.isClass(varName);
  }

  private isVariableWithName(expr: Expression, name: string): boolean {
    if (!expr) {
      return false;
    }
    const e = expr as ExprBase;
    const eType = e.type;
    if (eType !== "variable") {
      return false;
    }
    const varExpr = expr as VariableNode;
    const varName = varExpr.name;
    return varName === name;
  }

  private getVariableName(expr: Expression): string | null {
    const e = expr as ExprBase;
    if (e.type === "variable") {
      return (expr as VariableNode).name;
    }
    return null;
  }

  // Dispatch based on known named objects (console, fs, path, crypto, etc.)
  // Must be a class method so this.ctx concrete type is preserved for inner calls.
  private dispatchNamedObject(
    varName: string,
    method: string,
    expr: MethodCallNode,
    params: string[],
  ): string | null {
    switch (varName) {
      case "Promise":
        return handlePromiseStaticMethods(this.ctx, expr, params);

      case "ChadScript":
        if (method === "embedFile") return this.ctx.embedGen.generateEmbedFile(expr, params);
        if (method === "embedDir") return this.ctx.embedGen.generateEmbedDir(expr, params);
        if (method === "getEmbeddedFile")
          return this.ctx.embedGen.generateGetEmbeddedFile(expr, params);
        if (method === "getEmbeddedFileAsUint8Array")
          return this.ctx.embedGen.generateGetEmbeddedFileAsUint8Array(expr, params);
        if (method === "serveEmbedded")
          return this.ctx.embedGen.generateServeEmbedded(expr, params);
        return this.ctx.emitError(`ChadScript.${method}() is not a supported method`, expr.loc);

      case "Uint8Array":
        if (method === "fromRawBytes") return handleUint8ArrayFromRawBytes(this.ctx, expr, params);
        return null;

      case "Array":
        if (method === "from") {
          if (expr.args.length === 0)
            return this.ctx.emitError("Array.from() requires at least 1 argument", expr.loc);
          return this.ctx.generateExpression(expr.args[0], params);
        }
        if (method === "isArray") {
          if (expr.args.length === 0)
            return this.ctx.emitError("Array.isArray() requires at least 1 argument", expr.loc);
          const arg = expr.args[0];
          const isArr =
            this.ctx.isArrayExpression(arg) ||
            this.ctx.isStringArrayExpression(arg) ||
            this.ctx.isObjectArrayExpression(arg);
          return isArr ? "1.0" : "0.0";
        }
        return null;

      case "Buffer":
        if (method === "from") return handleBufferFrom(this.ctx, expr, params);
        return null;

      case "String":
        if (method === "fromCharCode") return handleStringFromCharCode(this.ctx, expr, params);
        return null;

      case "Object":
        if (method === "keys") return generateObjectKeys(this.ctx, expr, params);
        if (method === "values") return generateObjectValues(this.ctx, expr, params);
        if (method === "entries") return generateObjectEntries(this.ctx, expr, params);
        return null;

      case "Number":
        if (method === "isFinite") {
          if (expr.args.length === 0)
            return this.ctx.emitError("Number.isFinite() requires at least 1 argument", expr.loc);
          return handleNumberIsFinite(this.ctx, expr, params);
        }
        if (method === "isNaN") {
          if (expr.args.length === 0)
            return this.ctx.emitError("Number.isNaN() requires at least 1 argument", expr.loc);
          return handleNumberIsNaN(this.ctx, expr, params);
        }
        if (method === "isInteger") {
          if (expr.args.length === 0)
            return this.ctx.emitError("Number.isInteger() requires at least 1 argument", expr.loc);
          return handleNumberIsInteger(this.ctx, expr, params);
        }
        return null;

      case "console":
        if (method === "log" || method === "error" || method === "warn" || method === "debug")
          return generateConsoleCallInline(this.ctx, expr, params);
        if (method === "time") return generateConsoleTime(this.ctx, expr, params);
        if (method === "timeEnd") return generateConsoleTimeEnd(this.ctx, expr, params);
        return null;

      case "assert":
        this.ctx.setUsesTestRunner(true);
        if (method === "strictEqual") return handleAssertStrictEqual(this.ctx, expr, params);
        if (method === "notStrictEqual") return handleAssertNotStrictEqual(this.ctx, expr, params);
        if (method === "ok") return handleAssertOk(this.ctx, expr, params);
        if (method === "deepEqual") return handleAssertDeepEqual(this.ctx, expr, params);
        if (method === "fail") return handleAssertFail(this.ctx, expr, params);
        return null;

      case "process":
        if (method === "exit") return generateProcessExitInline(this.ctx, expr, params);
        if (method === "cwd") return generateProcessCwdInline(this.ctx);
        if (method === "chdir") return handleProcessChdir(this.ctx, expr, params);
        if (method === "abort") {
          this.ctx.emit(`call void @abort()`);
          return "0";
        }
        if (method === "kill") return handleProcessKill(this.ctx, expr, params);
        if (method === "uptime") return handleProcessUptime(this.ctx);
        if (method === "getuid") return handleProcessSyscallI32(this.ctx, "@getuid");
        if (method === "getgid") return handleProcessSyscallI32(this.ctx, "@getgid");
        if (method === "geteuid") return handleProcessSyscallI32(this.ctx, "@geteuid");
        if (method === "getegid") return handleProcessSyscallI32(this.ctx, "@getegid");
        return null;

      case "tty":
        if (method === "isatty") return handleTtyIsatty(this.ctx, expr, params);
        return null;

      case "os":
        if (method === "hostname") return handleOsHostname(this.ctx);
        if (method === "homedir") return handleOsHomedir(this.ctx);
        if (method === "tmpdir") return handleOsTmpdir(this.ctx);
        if (method === "cpus") return handleOsCpus(this.ctx);
        if (method === "totalmem") return handleOsTotalmem(this.ctx);
        if (method === "freemem") {
          this.ctx.setUsesOs(true);
          return handleOsFreemem(this.ctx);
        }
        if (method === "uptime") {
          this.ctx.setUsesOs(true);
          return handleOsUptime(this.ctx);
        }
        return null;

      case "fs":
        return handleFsMethod(this.ctx, method, expr, params);

      case "path":
        return handlePathMethod(this.ctx, method, expr, params);

      case "child_process":
      case "cp":
        return handleChildProcessMethod(this.ctx, method, expr, params);

      case "JSON":
        if (method === "parse") {
          this.ctx.setUsesJson(true);
          return this.ctx.jsonGen.generateParse(expr, params, expr.typeParameter);
        }
        if (method === "stringify") return this.ctx.jsonGen.generateStringify(expr, params);
        return null;

      case "crypto":
        this.ctx.setUsesCrypto(true);
        if (method === "sha256") return this.ctx.cryptoGen.generateSha256(expr, params);
        if (method === "md5") return this.ctx.cryptoGen.generateMd5(expr, params);
        if (method === "sha512") return this.ctx.cryptoGen.generateSha512(expr, params);
        if (method === "randomBytes") return this.ctx.cryptoGen.generateRandomBytes(expr, params);
        if (method === "randomUUID") return this.ctx.cryptoGen.generateRandomUUID(expr, params);
        if (method === "hmacSha256") return this.ctx.cryptoGen.generateHmacSha256(expr, params);
        if (method === "pbkdf2") return this.ctx.cryptoGen.generatePbkdf2(expr, params);
        return null;

      case "sqlite":
        this.ctx.setUsesSqlite(true);
        if (method === "open") return this.ctx.sqliteGen.generateOpen(expr, params);
        if (method === "exec") return this.ctx.sqliteGen.generateExec(expr, params);
        if (method === "get") return this.ctx.sqliteGen.generateGet(expr, params);
        if (method === "getRow") return this.ctx.sqliteGen.generateGetRow(expr, params);
        if (method === "all") return this.ctx.sqliteGen.generateAll(expr, params);
        if (method === "query") return this.ctx.sqliteGen.generateQuery(expr, params);
        if (method === "close") return this.ctx.sqliteGen.generateClose(expr, params);
        return null;

      default:
        return null;
    }
  }

  private getParameterMapKeyType(varName: string): string | null {
    const currentFunc = this.ctx.getCurrentFunction();
    if (!currentFunc) return null;

    let funcParams: { name: string; type?: string }[] | null = null;
    const funcLen = this.ctx.getAstFunctionsLength();
    for (let i = 0; i < funcLen; i++) {
      const fName = this.ctx.getAstFunctionNameAt(i);
      if (fName === currentFunc) {
        const f = this.ctx.getAstFunctionAt(i);
        if (f && f.parameters) {
          funcParams = f.parameters as { name: string; type?: string }[];
        }
        break;
      }
    }
    if (!funcParams && this.ctx.getCurrentClassName()) {
      const classLen = this.ctx.getAstClassesLength();
      for (let i = 0; i < classLen; i++) {
        const cName = this.ctx.getAstClassNameAt(i);
        if (cName === this.ctx.getCurrentClassName()) {
          const c = this.ctx.getAstClassAt(i);
          if (!c) break;
          for (let j = 0; j < c.methods.length; j++) {
            const m = c.methods[j];
            if (m.name === currentFunc && m.params) {
              funcParams = [];
              for (let k = 0; k < m.params.length; k++) {
                const paramType = m.paramTypes ? m.paramTypes[k] : undefined;
                funcParams.push({ name: m.params[k], type: paramType });
              }
              break;
            }
          }
          break;
        }
      }
    }
    if (!funcParams) return null;

    for (let i = 0; i < funcParams.length; i++) {
      const p = funcParams[i] as { name: string; type?: string };
      if (p.name === varName && p.type) {
        const mapParsed = parseMapTypeString(p.type);
        if (mapParsed) {
          return mapParsed.keyType;
        }
      }
    }
    return null;
  }

  private getThisFieldMapKeyType(expr: Expression): string | null {
    const result = this.ctx.typeResolver?.getThisFieldMapKeyType(expr);
    if (result) {
      return result;
    }

    const e2 = expr as ExprBase;
    if (e2.type !== "member_access") return null;
    const memberExpr = expr as MemberAccessNode;

    const objBase = memberExpr.object as ExprBase;
    if (objBase.type === "this") {
      const classNameForLookup = this.ctx.getCurrentClassName();
      if (!classNameForLookup) return null;
      const fieldInfoResult = this.ctx.classGenGetFieldInfo(
        classNameForLookup,
        memberExpr.property,
      );
      const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
      if (!fieldInfoResult || !fieldInfo.tsType) return null;

      const mapParsed = parseMapTypeString(fieldInfo.tsType);
      if (!mapParsed) return null;
      return mapParsed.keyType;
    }

    return null;
  }

  private getThisFieldSetValueType(expr: Expression): string | null {
    const result = this.ctx.typeResolver?.getThisFieldSetValueType(expr);
    if (result) {
      return result;
    }

    const e = expr as ExprBase;
    if (e.type !== "member_access") return null;
    const memberExpr = expr as MemberAccessNode;
    const objBase = memberExpr.object as ExprBase;
    if (objBase.type !== "this") return null;

    const classNameForSet = this.ctx.getCurrentClassName();
    if (!classNameForSet) return null;
    const fieldInfoResult = this.ctx.classGenGetFieldInfo(classNameForSet, memberExpr.property);
    const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
    if (!fieldInfoResult || !fieldInfo.tsType) return null;

    const setParsed = parseSetTypeString(fieldInfo.tsType);
    if (!setParsed) return null;
    return setParsed.valueType;
  }

  // Helper methods delegate to context
  private nextTemp(): string {
    return this.ctx.nextTemp();
  }
  private emit(instruction: string): void {
    this.ctx.emit(instruction);
  }

  /**
   * Generate code for method call expression
   *
   * @example
   * Input: { type: 'method_call', object: str, method: 'substr', args: [0, 5] }
   * Output: result register with method call result
   */
  generate(expr: MethodCallNode, params: string[]): string {
    // Optional method call: obj?.method() — null-check the object first
    if (expr.optional) {
      return this.generateOptionalMethodCall(expr, params);
    }

    const objBase = expr.object as { type: string };
    const method = expr.method;

    // Named-object dispatch: console, process, fs, path, crypto, sqlite, JSON, etc.
    const varName = this.getVariableName(expr.object);
    if (varName !== null) {
      const namedResult = this.dispatchNamedObject(varName, method, expr, params);
      if (namedResult !== null) return namedResult;
    }

    // Handle Promise instance methods (.then, .catch, .finally)
    if (method === "then" || method === "catch") {
      const isPromise = this.ctx.isPromiseExpression(expr.object);
      if (isPromise) {
        return handlePromiseThen(this.ctx, expr, params, method === "catch");
      }
    }
    if (method === "finally") {
      const isPromise = this.ctx.isPromiseExpression(expr.object);
      if (isPromise) {
        return handlePromiseFinally(this.ctx, expr, params);
      }
    }

    if (method === "write" && isProcessStdoutOrStderr(expr)) {
      return handleProcessWrite(this.ctx, expr, params);
    }

    // Handle Math.* methods (delegated to MathGenerator)
    if (this.ctx.mathGen.canHandle(expr)) {
      return this.ctx.mathGen.generateMathMethod(expr, params);
    }

    // Handle Date.now()
    if (this.ctx.dateGen.canHandle(expr)) {
      return this.ctx.dateGen.generateNow();
    }

    // Date instance methods: d.getTime(), d.getFullYear(), etc.
    if (
      method === "getTime" ||
      method === "getFullYear" ||
      method === "getMonth" ||
      method === "getDate" ||
      method === "getHours" ||
      method === "getMinutes" ||
      method === "getSeconds" ||
      method === "toISOString"
    ) {
      if (varName) {
        const varType = this.ctx.getVariableType(varName);
        if (varType === "%Date*") {
          const datePtr = this.ctx.generateExpression(expr.object, params);
          return this.ctx.dateGen.generateDateMethod(datePtr, method);
        }
      }
      if (objBase.type === "new") {
        const datePtr = this.ctx.generateExpression(expr.object, params);
        const objType = this.ctx.getVariableType(datePtr);
        if (objType === "%Date*") {
          return this.ctx.dateGen.generateDateMethod(datePtr, method);
        }
      }
    }

    // Handle regex methods
    if (method === "test") {
      const isRegex = this.ctx.isRegexExpression(expr.object);
      if (isRegex) {
        return this.handleRegexTest(expr, params);
      }
    }

    if (method === "exec") {
      const isRegex = this.ctx.isRegexExpression(expr.object);
      if (isRegex) {
        return this.handleRegexExec(expr, params);
      }
    }

    if (method === "isFile" || method === "isDirectory") {
      let statI8Ptr: string | null = null;

      if (objBase.type === "variable") {
        const varName = (expr.object as VariableNode).name;
        const varType = this.ctx.getVariableType(varName);
        if (varType === "%StatResult*") {
          const varPtr = this.ctx.symbolTable.getAlloca(varName);
          if (varPtr) {
            const raw = this.nextTemp();
            this.emit(`${raw} = load i8*, i8** ${varPtr}`);
            statI8Ptr = raw;
          }
        }
      } else {
        const objVal = this.ctx.generateExpression(expr.object, params);
        const objType = this.ctx.getVariableType(objVal);
        if (objType === "%StatResult*") {
          statI8Ptr = objVal;
        }
      }

      if (statI8Ptr) {
        const statPtr = this.nextTemp();
        this.emit(`${statPtr} = bitcast i8* ${statI8Ptr} to double*`);
        const fieldIdx = method === "isFile" ? 1 : 2;
        const fieldPtr = this.nextTemp();
        this.emit(
          `${fieldPtr} = getelementptr inbounds double, double* ${statPtr}, i64 ${fieldIdx}`,
        );
        const result = this.nextTemp();
        this.emit(`${result} = load double, double* ${fieldPtr}`);
        this.ctx.setVariableType(result, "double");
        return result;
      }
    }

    // Handle Response methods (from fetch())
    if (method === "text" || method === "json") {
      const isLikelyResponse = this.isLikelyResponseExpression(expr);
      if (isLikelyResponse) {
        try {
          let responsePtr = this.ctx.generateExpression(expr.object, params);

          const objType = this.ctx.getVariableType(responsePtr);
          if (objType === "i8*") {
            const castPtr = this.ctx.nextTemp();
            this.ctx.emit(`${castPtr} = bitcast i8* ${responsePtr} to %__FetchResponse*`);
            responsePtr = castPtr;
          }

          if (method === "text") {
            return this.ctx.responseGen.generateText(responsePtr);
          } else if (method === "json") {
            this.ctx.setUsesJson(true);
            if (expr.typeParameter) {
              const typeName = expr.typeParameter;
              const interfaceDefResult = getInterfaceFromAST(this.ctx, typeName);
              if (interfaceDefResult) {
                const interfaceDef = interfaceDefResult as InterfaceDefInfo;
                return this.ctx.responseGen.generateTypedJson(responsePtr, typeName, interfaceDef);
              }
            }
            return this.ctx.responseGen.generateJson(responsePtr);
          }
        } catch (e) {
          throw e;
        }
      }
    }

    // Handle string methods
    if (method === "substr") {
      return handleSubstr(this.ctx, expr, params);
    }
    if (method === "substring") {
      return handleSubstring(this.ctx, expr, params);
    }
    if (
      method === "concat" &&
      !this.ctx.isArrayExpression(expr.object) &&
      !this.ctx.isStringArrayExpression(expr.object) &&
      !this.ctx.isObjectArrayExpression(expr.object)
    ) {
      return handleConcat(this.ctx, expr, params);
    }
    if (method === "repeat") {
      return handleRepeat(this.ctx, expr, params);
    }
    if (method === "padStart") {
      return handlePadStart(this.ctx, expr, params);
    }
    if (method === "padEnd") {
      return handlePadEnd(this.ctx, expr, params);
    }
    if (method === "split") {
      return handleSplit(this.ctx, expr, params);
    }
    if (method === "startsWith") {
      return handleStartsWith(this.ctx, expr, params);
    }
    if (method === "endsWith") {
      return handleEndsWith(this.ctx, expr, params);
    }
    if (method === "trim") {
      return handleTrim(this.ctx, expr, params);
    }
    if (method === "trimStart") {
      return handleTrimStart(this.ctx, expr, params);
    }
    if (method === "trimEnd") {
      return handleTrimEnd(this.ctx, expr, params);
    }
    if (method === "indexOf") {
      if (this.ctx.isStringArrayExpression(expr.object)) {
        return handleStringArrayIndexOf(this.ctx, expr, params);
      }
      if (this.ctx.isArrayExpression(expr.object)) {
        return this.ctx.arrayGen.generateArrayIndexOf(expr, params);
      }
      return handleIndexOf(this.ctx, expr, params);
    }
    if (method === "lastIndexOf") {
      return handleLastIndexOf(this.ctx, expr, params);
    }
    if (method === "includes") {
      if (this.ctx.isStringArrayExpression(expr.object)) {
        return handleStringArrayIncludes(this.ctx, expr, params);
      }
      if (!this.ctx.isArrayExpression(expr.object)) {
        return handleStringIncludes(this.ctx, expr, params);
      }
    }
    if (
      method === "slice" &&
      !this.ctx.isArrayExpression(expr.object) &&
      !this.ctx.isStringArrayExpression(expr.object) &&
      !this.ctx.isObjectArrayExpression(expr.object)
    ) {
      return handleSlice(this.ctx, expr, params);
    }
    if (method === "replace") {
      return handleReplace(this.ctx, expr, params);
    }
    if (method === "replaceAll") {
      return handleReplaceAll(this.ctx, expr, params);
    }
    if (method === "charAt") {
      return handleCharAt(this.ctx, expr, params);
    }
    if (method === "charCodeAt") {
      return handleCharCodeAt(this.ctx, expr, params);
    }
    if (method === "toUpperCase") {
      return handleToUpperCase(this.ctx, expr, params);
    }
    if (method === "toLowerCase") {
      return handleToLowerCase(this.ctx, expr, params);
    }
    if (method === "toString") {
      if (
        !this.ctx.isStringExpression(expr.object) &&
        !this.ctx.isArrayExpression(expr.object) &&
        !this.ctx.isStringArrayExpression(expr.object)
      ) {
        return handleNumberToString(this.ctx, expr, params);
      }
    }
    if (method === "toFixed") {
      return handleNumberToFixed(this.ctx, expr, params);
    }
    if (method === "match") {
      if (this.ctx.isStringExpression(expr.object)) {
        return handleMatch(this.ctx, expr, params);
      }
    }

    // Handle Map methods
    if (
      method === "set" ||
      method === "get" ||
      method === "has" ||
      method === "clear" ||
      method === "delete" ||
      method === "entries" ||
      method === "values" ||
      method === "keys"
    ) {
      const varName = this.getVariableName(expr.object);
      if (varName && this.ctx.symbolTable.isMap(varName)) {
        const mapMeta = this.ctx.symbolTable.getMapMetadata(varName);

        if (mapMeta && mapMeta.keyType === "string") {
          const mapAlloca = this.ctx.symbolTable.getAlloca(varName);
          if (mapAlloca) {
            if (method === "set") {
              const keyValue = this.ctx.generateExpression(expr.args[0], params);
              const valueValue = this.ctx.generateExpression(expr.args[1], params);
              return this.ctx.stringMapGen.generateStringMapSet(mapAlloca, keyValue, valueValue);
            } else if (method === "get") {
              const keyValue = this.ctx.generateExpression(expr.args[0], params);
              return this.ctx.stringMapGen.generateStringMapGet(mapAlloca, keyValue);
            } else if (method === "has") {
              const keyValue = this.ctx.generateExpression(expr.args[0], params);
              return this.ctx.stringMapGen.generateStringMapHas(mapAlloca, keyValue);
            } else if (method === "delete") {
              const keyValue = this.ctx.generateExpression(expr.args[0], params);
              return this.ctx.stringMapGen.generateStringMapDelete(mapAlloca, keyValue);
            } else if (method === "entries") {
              return this.ctx.stringMapGen.generateStringMapEntries(mapAlloca);
            } else if (method === "values") {
              return this.ctx.stringMapGen.generateStringMapValues(mapAlloca);
            } else if (method === "keys") {
              return this.ctx.stringMapGen.generateStringMapKeys(mapAlloca);
            } else {
              return this.ctx.stringMapGen.generateStringMapClear(mapAlloca);
            }
          }
        }

        if (method === "set") {
          return this.ctx.mapGen.generateMapSet(expr, params);
        } else if (method === "get") {
          return this.ctx.mapGen.generateMapGet(expr, params);
        } else if (method === "has") {
          return this.ctx.mapGen.generateMapHas(expr, params);
        } else if (method === "delete") {
          return this.ctx.mapGen.generateMapDelete(expr, params);
        } else if (method === "entries" || method === "values" || method === "keys") {
          return this.ctx.emitError(
            `Map.${method}() only supported for Map<string, *> types`,
            expr.loc,
          );
        } else {
          return this.ctx.mapGen.generateMapClear(expr, params);
        }
      }

      if (varName) {
        const paramMapKeyType = this.getParameterMapKeyType(varName);
        if (paramMapKeyType) {
          const mapPtr = this.ctx.generateExpression(expr.object, params);
          if (paramMapKeyType === "string") {
            if (method === "set") {
              const keyValue = this.ctx.generateExpression(expr.args[0], params);
              const valueValue = this.ctx.generateExpression(expr.args[1], params);
              return this.ctx.stringMapGen.generateStringMapSet(mapPtr, keyValue, valueValue);
            } else if (method === "get") {
              const keyValue = this.ctx.generateExpression(expr.args[0], params);
              return this.ctx.stringMapGen.generateStringMapGet(mapPtr, keyValue);
            } else if (method === "has") {
              const keyValue = this.ctx.generateExpression(expr.args[0], params);
              return this.ctx.stringMapGen.generateStringMapHas(mapPtr, keyValue);
            } else if (method === "delete") {
              const keyValue = this.ctx.generateExpression(expr.args[0], params);
              return this.ctx.stringMapGen.generateStringMapDelete(mapPtr, keyValue);
            } else if (method === "clear") {
              return this.ctx.stringMapGen.generateStringMapClear(mapPtr);
            } else if (method === "entries") {
              return this.ctx.stringMapGen.generateStringMapEntries(mapPtr);
            } else if (method === "values") {
              return this.ctx.stringMapGen.generateStringMapValues(mapPtr);
            } else {
              return this.ctx.stringMapGen.generateStringMapKeys(mapPtr);
            }
          } else {
            if (method === "set") {
              const keyValue = this.ctx.generateExpression(expr.args[0], params);
              const valueValue = this.ctx.generateExpression(expr.args[1], params);
              return this.ctx.pointerMapGen.generatePointerMapSet(mapPtr, keyValue, valueValue);
            } else if (method === "get") {
              const keyValue = this.ctx.generateExpression(expr.args[0], params);
              return this.ctx.pointerMapGen.generatePointerMapGet(mapPtr, keyValue, "i8*");
            } else if (method === "clear") {
              return this.ctx.pointerMapGen.generatePointerMapClear(mapPtr);
            } else {
              return this.ctx.emitError(
                `Map.${method}() not supported for Map<${paramMapKeyType}, *> parameter types`,
                expr.loc,
              );
            }
          }
        }
      }

      const thisFieldMapKeyType = this.getThisFieldMapKeyType(expr.object);
      if (thisFieldMapKeyType) {
        const mapPtr = this.ctx.generateExpression(expr.object, params);
        if (thisFieldMapKeyType === "string") {
          if (method === "set") {
            const keyValue = this.ctx.generateExpression(expr.args[0], params);
            const valueValue = this.ctx.generateExpression(expr.args[1], params);
            return this.ctx.stringMapGen.generateStringMapSet(mapPtr, keyValue, valueValue);
          } else if (method === "get") {
            const keyValue = this.ctx.generateExpression(expr.args[0], params);
            return this.ctx.stringMapGen.generateStringMapGet(mapPtr, keyValue);
          } else if (method === "has") {
            const keyValue = this.ctx.generateExpression(expr.args[0], params);
            return this.ctx.stringMapGen.generateStringMapHas(mapPtr, keyValue);
          } else if (method === "delete") {
            const keyValue = this.ctx.generateExpression(expr.args[0], params);
            return this.ctx.stringMapGen.generateStringMapDelete(mapPtr, keyValue);
          } else if (method === "entries") {
            return this.ctx.stringMapGen.generateStringMapEntries(mapPtr);
          } else if (method === "values") {
            return this.ctx.stringMapGen.generateStringMapValues(mapPtr);
          } else {
            return this.ctx.stringMapGen.generateStringMapClear(mapPtr);
          }
        } else {
          const mapPtr = this.ctx.generateExpression(expr.object, params);
          if (method === "set") {
            const keyValue = this.ctx.generateExpression(expr.args[0], params);
            const valueValue = this.ctx.generateExpression(expr.args[1], params);
            return this.ctx.pointerMapGen.generatePointerMapSet(mapPtr, keyValue, valueValue);
          } else if (method === "get") {
            const keyValue = this.ctx.generateExpression(expr.args[0], params);
            return this.ctx.pointerMapGen.generatePointerMapGet(mapPtr, keyValue, "i8*");
          } else if (method === "clear") {
            return this.ctx.pointerMapGen.generatePointerMapClear(mapPtr);
          } else {
            return this.ctx.emitError(
              `Map.${method}() not supported for Map<${thisFieldMapKeyType}, *> types`,
              expr.loc,
            );
          }
        }
      }
    }

    // Handle Set methods
    if (method === "add" || method === "has" || method === "delete") {
      const varName = this.getVariableName(expr.object);
      if (varName && this.ctx.symbolTable.isSet(varName)) {
        const setValueType = this.ctx.symbolTable.getSetValueType(varName);

        if (setValueType && setValueType === "string") {
          const setAlloca = this.ctx.symbolTable.getAlloca(varName);
          if (setAlloca) {
            if (method === "add") {
              const valueValue = this.ctx.generateExpression(expr.args[0], params);
              return this.ctx.stringSetGen.generateStringSetAdd(setAlloca, valueValue);
            } else if (method === "has") {
              const valueValue = this.ctx.generateExpression(expr.args[0], params);
              return this.ctx.stringSetGen.generateStringSetHas(setAlloca, valueValue);
            } else {
              const valueValue = this.ctx.generateExpression(expr.args[0], params);
              return this.ctx.stringSetGen.generateStringSetDelete(setAlloca, valueValue);
            }
          }
        }

        if (method === "add") {
          return this.ctx.setGen.generateSetAdd(expr, params);
        } else if (method === "has") {
          return this.ctx.setGen.generateSetHas(expr, params);
        } else {
          return this.ctx.setGen.generateSetDelete(expr, params);
        }
      }

      const thisFieldSetValueType = this.getThisFieldSetValueType(expr.object);
      if (thisFieldSetValueType) {
        const setPtr = this.ctx.generateExpression(expr.object, params);
        if (thisFieldSetValueType === "string") {
          if (method === "add") {
            const valueValue = this.ctx.generateExpression(expr.args[0], params);
            return this.ctx.stringSetGen.generateStringSetAdd(setPtr, valueValue);
          } else if (method === "has") {
            const valueValue = this.ctx.generateExpression(expr.args[0], params);
            return this.ctx.stringSetGen.generateStringSetHas(setPtr, valueValue);
          } else {
            const valueValue = this.ctx.generateExpression(expr.args[0], params);
            return this.ctx.stringSetGen.generateStringSetDelete(setPtr, valueValue);
          }
        }
      }
    }

    // Handle URLSearchParams methods
    if (
      method === "get" ||
      method === "has" ||
      method === "set" ||
      method === "append" ||
      method === "delete" ||
      method === "toString"
    ) {
      const urlspVarName = this.getVariableName(expr.object);
      if (urlspVarName && this.ctx.symbolTable.isUrlSearchParams(urlspVarName)) {
        const urlspAlloca = this.ctx.symbolTable.getAlloca(urlspVarName);
        if (urlspAlloca) {
          const queryPtr = this.ctx.emitLoad("i8*", urlspAlloca);
          if (method === "get") {
            const keyPtr = this.ctx.generateExpression(expr.args[0], params);
            const result = this.ctx.emitCall(
              "i8*",
              "@cs_urlsearch_get",
              `i8* ${queryPtr}, i8* ${keyPtr}`,
            );
            this.ctx.setVariableType(result, "i8*");
            return result;
          } else if (method === "has") {
            const keyPtr = this.ctx.generateExpression(expr.args[0], params);
            const i32Result = this.ctx.emitCall(
              "i32",
              "@cs_urlsearch_has",
              `i8* ${queryPtr}, i8* ${keyPtr}`,
            );
            const dblResult = this.ctx.nextTemp();
            this.ctx.emit(`${dblResult} = sitofp i32 ${i32Result} to double`);
            this.ctx.setVariableType(dblResult, "double");
            return dblResult;
          } else if (method === "set") {
            const keyPtr = this.ctx.generateExpression(expr.args[0], params);
            const valPtr = this.ctx.generateExpression(expr.args[1], params);
            const newQuery = this.ctx.emitCall(
              "i8*",
              "@cs_urlsearch_set",
              `i8* ${queryPtr}, i8* ${keyPtr}, i8* ${valPtr}`,
            );
            this.ctx.emitStore("i8*", newQuery, urlspAlloca);
            return newQuery;
          } else if (method === "append") {
            const keyPtr = this.ctx.generateExpression(expr.args[0], params);
            const valPtr = this.ctx.generateExpression(expr.args[1], params);
            const newQuery = this.ctx.emitCall(
              "i8*",
              "@cs_urlsearch_append",
              `i8* ${queryPtr}, i8* ${keyPtr}, i8* ${valPtr}`,
            );
            this.ctx.emitStore("i8*", newQuery, urlspAlloca);
            return newQuery;
          } else if (method === "delete") {
            const keyPtr = this.ctx.generateExpression(expr.args[0], params);
            const newQuery = this.ctx.emitCall(
              "i8*",
              "@cs_urlsearch_delete",
              `i8* ${queryPtr}, i8* ${keyPtr}`,
            );
            this.ctx.emitStore("i8*", newQuery, urlspAlloca);
            return newQuery;
          } else if (method === "toString") {
            const result = this.ctx.emitCall("i8*", "@cs_urlsearch_tostring", `i8* ${queryPtr}`);
            this.ctx.setVariableType(result, "i8*");
            return result;
          }
        }
      }
    }

    // Handle array methods (arrayGen uses context pattern - no sync needed! 🎯)
    // Skip to class dispatch if object is a class instance (e.g. Stack.push / Stack.pop)
    if (method === "push" && !this.isClassInstanceExpression(expr.object)) {
      return this.ctx.arrayGen.generateArrayPush(expr, params);
    } else if (method === "pop" && !this.isClassInstanceExpression(expr.object)) {
      return this.ctx.arrayGen.generateArrayPop(expr, params);
    } else if (method === "includes" && this.ctx.isArrayExpression(expr.object)) {
      return this.ctx.arrayGen.generateArrayIncludes(expr, params);
    } else if (method === "map") {
      if (this.ctx.isStringArrayExpression(expr.object)) {
        return this.ctx.arrayGen.generateStringArrayMap(expr, params);
      }
      return this.ctx.arrayGen.generateArrayMap(expr, params);
    } else if (
      method === "join" &&
      (this.ctx.isStringArrayExpression(expr.object) ||
        this.ctx.isArrayExpression(expr.object) ||
        this.ctx.isObjectArrayExpression(expr.object))
    ) {
      return this.ctx.arrayGen.generateArrayJoin(expr, params);
    } else if (method === "find") {
      return this.ctx.arrayGen.generateArrayFind(expr, params);
    } else if (method === "some") {
      return this.ctx.arrayGen.generateArraySome(expr, params);
    } else if (method === "every") {
      return this.ctx.arrayGen.generateArrayEvery(expr, params);
    } else if (method === "filter") {
      return this.ctx.arrayGen.generateArrayFilter(expr, params);
    } else if (method === "forEach") {
      return this.ctx.arrayGen.generateArrayForEach(expr, params);
    } else if (method === "reduce") {
      return this.ctx.arrayGen.generateArrayReduce(expr, params);
    } else if (
      method === "slice" &&
      (this.ctx.isArrayExpression(expr.object) ||
        this.ctx.isStringArrayExpression(expr.object) ||
        this.ctx.isObjectArrayExpression(expr.object))
    ) {
      return this.ctx.arrayGen.generateArraySlice(expr, params);
    } else if (
      method === "concat" &&
      (this.ctx.isArrayExpression(expr.object) ||
        this.ctx.isStringArrayExpression(expr.object) ||
        this.ctx.isObjectArrayExpression(expr.object))
    ) {
      return this.ctx.arrayGen.generateArrayConcat(expr, params);
    } else if (method === "reverse") {
      return this.ctx.arrayGen.generateArrayReverse(expr, params);
    } else if (method === "shift") {
      return this.ctx.arrayGen.generateArrayShift(expr, params);
    } else if (method === "unshift") {
      return this.ctx.arrayGen.generateArrayUnshift(expr, params);
    } else if (method === "findIndex") {
      return this.ctx.arrayGen.generateArrayFindIndex(expr, params);
    } else if (method === "sort") {
      return this.ctx.arrayGen.generateArraySort(expr, params);
    } else if (method === "splice") {
      return this.ctx.arrayGen.generateArraySplice(expr, params);
    }

    // Handle class instance methods
    const classResult = handleClassMethods(this.ctx, expr, params);
    if (classResult !== null) {
      return classResult;
    }

    // Handle object methods
    const objectResult = handleObjectMethods(this.ctx, expr, params);
    if (objectResult !== null) {
      return objectResult;
    }

    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type === "method_call") {
      this.ctx.emitError(
        `Method chaining on class instances is not supported. Assign the result to a variable first.`,
        expr.loc,
      );
    }
    if (exprObjBase.type === "variable") {
      const varName = (expr.object as VariableNode).name;
      const ast = this.ctx.getAst();
      if (ast && ast.imports) {
        for (let ii = 0; ii < ast.imports.length; ii++) {
          const imp = ast.imports[ii];
          if (!imp) continue;
          const isRelative =
            imp.source.startsWith("./") ||
            imp.source.startsWith("../") ||
            imp.source.startsWith("/");
          if (!isRelative && imp.specifiers && imp.specifiers.indexOf(varName) !== -1) {
            return "null";
          }
        }
      }
    }

    this.throwUnsupportedMethodError(method, exprObjBase.type, expr);
  }

  private handleRegexTest(expr: MethodCallNode, params: string[]): string {
    const regexPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length !== 1) {
      return this.ctx.emitError(`test() expects 1 argument, got ${expr.args.length}`, expr.loc);
    }

    const testStr = this.ctx.generateExpression(expr.args[0], params);
    return this.ctx.regexGen.generateRegexTest(regexPtr, testStr);
  }

  private handleRegexExec(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      return this.ctx.emitError(`exec() expects 1 argument, got ${expr.args.length}`, expr.loc);
    }
    const regexPtr = this.ctx.generateExpression(expr.object, params);
    const strPtr = this.ctx.generateExpression(expr.args[0], params);
    return this.ctx.regexGen.generateRegexExecDyn(regexPtr, strPtr);
  }

  private throwUnsupportedMethodError(
    method: string,
    _objectType?: string,
    methodCallExpr?: MethodCallNode,
  ): never {
    let objectDescription = "";

    if (methodCallExpr) {
      const expr = methodCallExpr.object;
      if (expr) {
        const e = expr as ExprBase;
        if (e.type === "member_access") {
          const memberExpr = expr as MemberAccessNode;
          const memberObjBase = memberExpr.object as ExprBase;
          if (memberObjBase && memberObjBase.type === "variable") {
            objectDescription = `${(memberExpr.object as VariableNode).name}.${memberExpr.property}`;
          } else {
            objectDescription = memberExpr.property;
          }
        } else if (e.type === "variable") {
          objectDescription = (expr as VariableNode).name;
        }
      }
    }

    // Simple one-line suggestions for common unsupported methods
    let suggestion: string | undefined = undefined;
    if (method === "isInteger") {
      suggestion = `Use (value % 1 === 0) instead`;
    } else if (method === "isNaN") {
      suggestion = `Use (value !== value) instead`;
    } else if (method === "includes") {
      suggestion = `Use indexOf(...) !== -1 instead`;
    }

    const errorMsg = objectDescription
      ? `Method '${method}' on '${objectDescription}' is not supported.`
      : `Method '${method}' is not supported.`;

    this.ctx.emitError(errorMsg, methodCallExpr ? methodCallExpr.loc : undefined, suggestion);
  }

  private isLikelyResponseExpression(expr: MethodCallNode): boolean {
    const exprObj = expr.object as ExprBase;
    if (exprObj.type === "variable") {
      const varName = (expr.object as VariableNode).name;
      const varType = this.ctx.symbolTable.getType(varName);
      if (varType === "%__FetchResponse*") return true;
    }
    if (exprObj.type === "index_access" || exprObj.type === "member_access") {
      return true;
    }
    if (exprObj.type === "call") {
      return true;
    }
    if (exprObj.type === "await") {
      return true;
    }
    return false;
  }
}
