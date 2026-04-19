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
  InterfaceField,
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
import { dispatchMapMethod } from "./method-calls/map-dispatch.js";
import { dispatchSetMethod } from "./method-calls/set-dispatch.js";
import { dispatchUrlSearchParamsMethod } from "./method-calls/urlsearchparams-dispatch.js";
import type { FieldInfo } from "../infrastructure/type-resolver/types.js";
import {
  isProcessStdoutOrStderr,
  isProcessStdinRead,
  handleProcessWrite,
  handleProcessStdinRead,
} from "./method-calls/process.js";
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
  handleCryptoMethod,
  handleProcessMethod,
  handleAssertMethod,
  handleOsMethod,
  handleConsoleMethod,
  handleChadScriptMethod,
  handleSqliteMethod,
} from "./method-calls/named-object-dispatch.js";
import {
  handleNumberIsFinite,
  handleNumberIsNaN,
  handleNumberIsInteger,
} from "./method-calls/string-methods.js";
import { dispatchStringMethod, dispatchArrayMethod } from "./method-calls/string-dispatch.js";
import { handlePromiseThen, handlePromiseFinally } from "./method-calls/promise-handlers.js";
import {
  handleClassMethods,
  handleObjectMethods,
  getInterfaceFromAST,
  type InterfaceDefInfo,
} from "./method-calls/class-dispatch.js";

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
  classGenGetFieldInfo(className: string | null, fieldName: string | null): FieldInfo | null;
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
  getAllInterfaceFields(iface: InterfaceDeclaration): InterfaceField[];
  ensureDouble(value: string): string;
  ensureI64(value: string): string;
  getWantsBinaryReturn(): boolean;
  isUint8ArrayExpression(expr: Expression): boolean;
  isBooleanExpression(expr: Expression): boolean;
  setUsesOs(value: boolean): void;
  setUsesCompression(value: boolean): void;
  setUsesYaml(value: boolean): void;
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
    const e = expr as { type: string };
    if (e.type !== "variable") return false;
    const varName = (expr as VariableNode).name;
    return this.ctx.symbolTable.isClass(varName);
  }

  private isVariableWithName(expr: Expression, name: string): boolean {
    if (!expr) {
      return false;
    }
    const e = expr as { type: string };
    const eType = e.type;
    if (eType !== "variable") {
      return false;
    }
    const varExpr = expr as VariableNode;
    const varName = varExpr.name;
    return varName === name;
  }

  private getVariableName(expr: Expression): string | null {
    const e = expr as { type: string };
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
        return handleChadScriptMethod(this.ctx, method, expr, params);

      case "Uint8Array":
        if (method === "fromRawBytes") return handleUint8ArrayFromRawBytes(this.ctx, expr, params);
        return null;

      case "Array":
        if (method === "from") {
          if (expr.args.length === 0)
            return this.ctx.emitError("Array.from() requires at least 1 argument", expr.loc);
          if (this.ctx.isStringExpression(expr.args[0])) {
            const strPtr = this.ctx.generateExpression(expr.args[0], params);
            const emptyDelim = this.ctx.nextTemp();
            this.ctx.emit(
              `${emptyDelim} = getelementptr inbounds [1 x i8], [1 x i8]* @.str.empty_str, i64 0, i64 0`,
            );
            return this.ctx.stringGen.doGenerateSplit(strPtr, emptyDelim);
          }
          return this.ctx.generateExpression(expr.args[0], params);
        }
        if (method === "isArray") {
          if (expr.args.length === 0)
            return this.ctx.emitError("Array.isArray() requires at least 1 argument", expr.loc);
          const arg = expr.args[0];
          const isArr =
            this.ctx.isArrayExpression(arg) ||
            this.ctx.isStringArrayExpression(arg) ||
            this.ctx.isObjectArrayExpression(arg) ||
            this.ctx.isUint8ArrayExpression(arg);
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
        return handleConsoleMethod(this.ctx, method, expr, params);

      case "assert":
        return handleAssertMethod(this.ctx, method, expr, params);

      case "process":
        return handleProcessMethod(this.ctx, method, expr, params);

      case "tty":
        if (method === "isatty") return handleTtyIsatty(this.ctx, expr, params);
        return null;

      case "os":
        return handleOsMethod(this.ctx, method, expr, params);

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
        return handleCryptoMethod(this.ctx, method, expr, params);

      case "sqlite":
        return handleSqliteMethod(this.ctx, method, expr, params);

      case "YAML":
        if (method === "parse") {
          this.ctx.setUsesJson(true);
          this.ctx.setUsesYaml(true);
          return this.handleYamlParse(expr, params);
        }
        if (method === "stringify") {
          this.ctx.setUsesYaml(true);
          return this.handleYamlStringify(expr, params);
        }
        return null;

      default:
        return null;
    }
    return null;
  }

  private handleYamlParse(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("YAML.parse() requires 1 argument", expr.loc);
    }
    const yamlStr = this.ctx.generateExpression(expr.args[0], params);
    const jsonStr = this.ctx.emitCall("i8*", "@cs_yaml_parse", `i8* ${yamlStr}`);
    return this.ctx.jsonGen.generateParseFromString(jsonStr, expr.typeParameter);
  }

  private handleYamlStringify(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("YAML.stringify() requires 1 argument", expr.loc);
    }
    const jsonStr = this.ctx.jsonGen.generateStringify(expr, params);
    const yamlStr = this.ctx.emitCall("i8*", "@cs_yaml_stringify", `i8* ${jsonStr}`);
    this.ctx.setVariableType(yamlStr, "i8*");
    return yamlStr;
  }

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

    if (method === "") {
      return this.ctx.emitError(
        "Immediately invoked function expressions (IIFE) are not supported.",
        expr.loc,
      );
    }

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

    if (isProcessStdinRead(expr)) {
      return handleProcessStdinRead(this.ctx, expr);
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
      }
    }

    if (!this.isClassInstanceExpression(expr.object)) {
      const stringResult = dispatchStringMethod(this.ctx, method, expr, params);
      if (stringResult !== null) return stringResult;
    }

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
      const mapResult = dispatchMapMethod(this.ctx, method, expr, params);
      if (mapResult !== null) return mapResult;
    }

    if (method === "add" || method === "has" || method === "delete") {
      const setResult = dispatchSetMethod(this.ctx, method, expr, params);
      if (setResult !== null) return setResult;
    }

    if (
      method === "get" ||
      method === "has" ||
      method === "set" ||
      method === "append" ||
      method === "delete" ||
      method === "toString"
    ) {
      const urlspResult = dispatchUrlSearchParamsMethod(this.ctx, method, expr, params);
      if (urlspResult !== null) return urlspResult;
    }

    const arrayResult = dispatchArrayMethod(
      this.ctx,
      method,
      expr,
      params,
      this.isClassInstanceExpression(expr.object),
    );
    if (arrayResult !== null) return arrayResult;

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

    const exprObjBase = expr.object as { type: string };
    if (exprObjBase.type === "method_call") {
      return this.ctx.emitError(
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
            return this.ctx.emitError(
              `'${varName}.${method}()' — module '${imp.source}' is not supported by ChadScript`,
              expr.loc,
            );
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
        const e = expr as { type: string };
        if (e.type === "member_access") {
          const memberExpr = expr as MemberAccessNode;
          const memberObjBase = memberExpr.object as { type: string };
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

    return this.ctx.emitError(
      errorMsg,
      methodCallExpr ? methodCallExpr.loc : undefined,
      suggestion,
    );
  }

  private isLikelyResponseExpression(expr: MethodCallNode): boolean {
    const exprObj = expr.object as { type: string };
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
