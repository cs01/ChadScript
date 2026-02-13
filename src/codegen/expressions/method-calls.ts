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
} from '../../ast/types.js';
import type { SymbolTable } from '../infrastructure/symbol-table.js';
import { parseMapTypeString, parseSetTypeString } from '../infrastructure/type-system.js';
import { generateConsoleCallInline } from './method-calls/console.js';
import { generateProcessExitInline, generateProcessCwdInline, handleProcessChdir, handleProcessKill, handleProcessUptime, handleProcessSyscallI32, isProcessStdoutOrStderr, handleProcessWrite } from './method-calls/process.js';
import { handleSubstr, handleSubstring, handleConcat, handleRepeat, handlePadStart, handleSplit, handleStartsWith, handleEndsWith, handleTrim, handleTrimStart, handleTrimEnd, handleIndexOf, handleStringArrayIndexOf, handleStringArrayIncludes, handleStringIncludes, handleSlice, handleReplace, handleReplaceAll, handleNumberIsFinite, handleNumberIsNaN, handleNumberIsInteger, handleNumberToString, handleCharAt, handleCharCodeAt, handleToUpperCase, handleToLowerCase, handleMatch } from './method-calls/string-methods.js';
import { generateObjectKeys, generateObjectValues, generateObjectEntries } from './method-calls/object-static.js';
import { handlePromiseStaticMethods, handlePromiseThen } from './method-calls/promise-handlers.js';
import { handleClassMethods, handleObjectMethods, getInterfaceFromAST } from './method-calls/class-dispatch.js';

interface ExprBase { type: string; }

interface InterfaceDefInfo {
  properties: { name: string; type: string }[];
}

export interface MethodCallGeneratorContext {
  nextTemp(): string;
  nextLabel(prefix: string): string;
  emit(instruction: string): void;
  generateExpression(expr: Expression, params: string[]): string;
  syncStateToGenerators(): void;
  isStringExpression(expr: Expression): boolean;
  isArrayExpression(expr: Expression): boolean;
  isStringArrayExpression(expr: Expression): boolean;
  isObjectArrayExpression(expr: Expression): boolean;
  isRegexExpression(expr: Expression): boolean;
  isPromiseExpression(expr: Expression): boolean;
  formatCodegenError(message: string, suggestion: string, pos?: number): string;
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
  setUsesCrypto(value: boolean): void;
  setUsesJson(value: boolean): void;
  setUsesMongoose(value: boolean): void;
  symbolTableIsClass(name: string): boolean;
  symbolTableIsMap(name: string): boolean;
  symbolTableIsSet(name: string): boolean;
  symbolTableIsObject(name: string): boolean;
  symbolTableLookup(name: string): { kind?: string; type?: string; interfaceType?: string } | undefined;
  symbolTableGetType(name: string): string | undefined;
  symbolTableGetClassName(name: string): string | undefined;
  symbolTableGetClassInfo(name: string): { ptr: string; className: string } | undefined;
  symbolTableGetMapMetadata(name: string): { keyType: string; valueType: string } | undefined;
  symbolTableGetSetMetadata(name: string): string | undefined;
  symbolTableGetAlloca(name: string): string | undefined;
  symbolTableGetInterfaceType(name: string): string | undefined;
  symbolTableGetConcreteClass(name: string): string | undefined;
  symbolTableGetObjectInfo(name: string): { ptr: string; keys: string[]; types: string[]; tsTypes?: string[] } | undefined;
  symbolTableGetScopeVarsArraysForClosure(): { names: string[]; types: string[] };
  classGenGetFieldInfo(className: string | null, fieldName: string | null): { index: number; type: string; tsType?: string } | null;
  classGenGenerateMethodCall(instancePtr: string, className: string, method: string, args: Expression[], params: string[]): string;
  typeResolverGetThisFieldMapKeyType(expr: Expression): string | null;
  typeResolverGetThisFieldSetValueType(expr: Expression): string | null;
  arrowFunctionGenGenerate(
    expr: Expression,
    params: string[],
    typeHints: { paramTypes?: string[]; returnType?: string } | undefined,
    scopeVarNames: string[] | undefined,
    scopeVarTypes: string[] | undefined
  ): string;
  arrowFunctionGenGetClosureInfo(lambdaName: string): { captures: { name: string; llvmType: string }[]; envStructName: string } | null;
  getActualClassType(name: string): string | undefined;
  findClassImplementingInterface(interfaceName: string): string | null;
  stringGenCreateStringConstant(value: string): string;
  stringGenGenerateSubstr(strPtr: string, startIndex: string, length: string | null): string;
  stringGenGenerateStringConcatDirect(left: string, right: string): string;
  stringGenGenerateRepeat(strPtr: string, count: string): string;
  stringGenGeneratePadStart(strPtr: string, targetLength: string, padString: string): string;
  stringGenGenerateSplit(strPtr: string, delimiter: string): string;
  stringGenGenerateStartsWith(strPtr: string, prefix: string): string;
  stringGenGenerateEndsWith(strPtr: string, suffix: string): string;
  stringGenGenerateTrim(strPtr: string): string;
  stringGenGenerateTrimStart(strPtr: string): string;
  stringGenGenerateTrimEnd(strPtr: string): string;
  stringGenGenerateToUpperCase(strPtr: string): string;
  stringGenGenerateToLowerCase(strPtr: string): string;
  stringGenGenerateIndexOf(strPtr: string, substring: string): string;
  stringGenGenerateIncludes(strPtr: string, substring: string): string;
  stringGenGenerateSlice(strPtr: string, start: string, end: string | null): string;
  stringGenGenerateCharAt(strPtr: string, index: string): string;
  stringGenGenerateCharCodeAt(strPtr: string, index: string): string;
  stringGenGenerateReplace(strPtr: string, search: string, replace: string): string;
  stringGenGenerateReplaceAll(strPtr: string, search: string, replace: string): string;
  stringGenGenerateGlobalString(value: string): string;
  stringGenConvertNumberToString(numValue: string): string;
  fsGenReadFileSync(expr: MethodCallNode, params: string[]): string;
  fsGenWriteFileSync(expr: MethodCallNode, params: string[]): string;
  fsGenAppendFileSync(expr: MethodCallNode, params: string[]): string;
  fsGenExistsSync(expr: MethodCallNode, params: string[]): string;
  fsGenUnlinkSync(expr: MethodCallNode, params: string[]): string;
  fsGenReaddirSync(expr: MethodCallNode, params: string[]): string;
  fsGenStatSync(expr: MethodCallNode, params: string[]): string;
  pathGenGenerateResolve(expr: MethodCallNode, params: string[]): string;
  pathGenGenerateDirname(expr: MethodCallNode, params: string[]): string;
  pathGenGenerateBasename(expr: MethodCallNode, params: string[]): string;
  pathGenGenerateJoin(expr: MethodCallNode, params: string[]): string;
  jsonGenGenerateParse(expr: MethodCallNode, params: string[]): string;
  jsonGenGenerateStringify(expr: MethodCallNode, params: string[]): string;
  mathGenCanHandle(expr: MethodCallNode): boolean;
  mathGenGenerateMathMethod(expr: MethodCallNode, params: string[]): string;
  dateGenCanHandle(expr: MethodCallNode): boolean;
  dateGenGenerateNow(): string;
  cryptoGenCanHandle(expr: MethodCallNode): boolean;
  cryptoGenSha256(expr: MethodCallNode, params: string[]): string;
  cryptoGenMd5(expr: MethodCallNode, params: string[]): string;
  cryptoGenSha512(expr: MethodCallNode, params: string[]): string;
  cryptoGenRandomBytes(expr: MethodCallNode, params: string[]): string;
  sqliteGenCanHandle(expr: MethodCallNode): boolean;
  sqliteGenOpen(expr: MethodCallNode, params: string[]): string;
  sqliteGenExec(expr: MethodCallNode, params: string[]): string;
  sqliteGenGet(expr: MethodCallNode, params: string[]): string;
  sqliteGenAll(expr: MethodCallNode, params: string[]): string;
  sqliteGenClose(expr: MethodCallNode, params: string[]): string;
  responseGenGenerateText(responsePtr: string): string;
  responseGenGenerateJson(responsePtr: string): string;
  responseGenGenerateTypedJson(responsePtr: string, typeName: string, interfaceDef: InterfaceDefInfo): string;
  stringMapGenGenerateStringMapSet(mapAlloca: string, key: string, value: string): string;
  stringMapGenGenerateStringMapGet(mapAlloca: string, key: string): string;
  stringMapGenGenerateStringMapHas(mapAlloca: string, key: string): string;
  stringMapGenGenerateStringMapClear(mapAlloca: string): string;
  stringMapGenGenerateStringMapDelete(mapAlloca: string, key: string): string;
  stringMapGenGenerateStringMapEntries(mapAlloca: string): string;
  stringMapGenGenerateStringMapValues(mapAlloca: string): string;
  stringMapGenGenerateStringMapKeys(mapAlloca: string): string;
  stringSetGenGenerateStringSetAdd(setAlloca: string, value: string): string;
  stringSetGenGenerateStringSetHas(setAlloca: string, value: string): string;
  mapGenGenerateMapSet(expr: MethodCallNode, params: string[]): string;
  mapGenGenerateMapGet(expr: MethodCallNode, params: string[]): string;
  mapGenGenerateMapHas(expr: MethodCallNode, params: string[]): string;
  mapGenGenerateMapClear(expr: MethodCallNode, params: string[]): string;
  mapGenGenerateMapDelete(expr: MethodCallNode, params: string[]): string;
  pointerMapGenGeneratePointerMapGet(mapPtr: string, keyToFind: string, valueType: string): string;
  pointerMapGenGeneratePointerMapSet(mapPtr: string, keyValue: string, valueValue: string): string;
  pointerMapGenGeneratePointerMapClear(mapPtr: string): string;
  setGenGenerateSetAdd(expr: MethodCallNode, params: string[]): string;
  setGenGenerateSetHas(expr: MethodCallNode, params: string[]): string;
  setGenGenerateSetDelete(expr: MethodCallNode, params: string[]): string;
  arrayGenGenerateArrayPush(expr: MethodCallNode, params: string[]): string;
  arrayGenGenerateArrayPop(expr: MethodCallNode, params: string[]): string;
  arrayGenGenerateArrayIncludes(expr: MethodCallNode, params: string[]): string;
  arrayGenGenerateArrayMap(expr: MethodCallNode, params: string[]): string;
  arrayGenGenerateStringArrayMap(expr: MethodCallNode, params: string[]): string;
  arrayGenGenerateArrayJoin(expr: MethodCallNode, params: string[]): string;
  arrayGenGenerateArrayFind(expr: MethodCallNode, params: string[]): string;
  arrayGenGenerateArraySome(expr: MethodCallNode, params: string[]): string;
  arrayGenGenerateArrayEvery(expr: MethodCallNode, params: string[]): string;
  arrayGenGenerateArrayFilter(expr: MethodCallNode, params: string[]): string;
  arrayGenGenerateArrayForEach(expr: MethodCallNode, params: string[]): string;
  arrayGenGenerateArrayReduce(expr: MethodCallNode, params: string[]): string;
  arrayGenGenerateArraySlice(expr: MethodCallNode, params: string[]): string;
  arrayGenGenerateArrayConcat(expr: MethodCallNode, params: string[]): string;
  regexGenGenerateRegexTest(regexPtr: string, testStr: string): string;
  regexGenGenerateRegexCompile(pattern: string, flags: string): string;
  regexGenGenerateRegexMatch(regexPtr: string, testStr: string, numGroups: number): string;
}

export class MethodCallGenerator {
  constructor(private ctx: MethodCallGeneratorContext) {}

  private isVariableWithName(expr: Expression, name: string): boolean {
    if (!expr) {
      return false;
    }
    const e = expr as ExprBase;
    const eType = e.type;
    if (eType !== 'variable') {
      return false;
    }
    const varExpr = expr as VariableNode;
    const varName = varExpr.name;
    return varName === name;
  }

  private getVariableName(expr: Expression): string | null {
    const e = expr as ExprBase;
    if (e.type === 'variable') {
      return (expr as VariableNode).name;
    }
    return null;
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
    const result = this.ctx.typeResolverGetThisFieldMapKeyType(expr);
    if (result) {
      return result;
    }

    const e2 = expr as ExprBase;
    if (e2.type !== 'member_access') return null;
    const memberExpr = expr as MemberAccessNode;

    const objBase = memberExpr.object as ExprBase;
    if (objBase.type === 'this') {
      const classNameForLookup = this.ctx.getCurrentClassName();
      if (!classNameForLookup) return null;
      const fieldInfoResult = this.ctx.classGenGetFieldInfo(classNameForLookup, memberExpr.property);
      const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
      if (!fieldInfoResult || !fieldInfo.tsType) return null;

      const mapParsed = parseMapTypeString(fieldInfo.tsType);
      if (!mapParsed) return null;
      return mapParsed.keyType;
    }

    return null;
  }

  private getThisFieldSetValueType(expr: Expression): string | null {
    const result = this.ctx.typeResolverGetThisFieldSetValueType(expr);
    if (result) {
      return result;
    }

    const e = expr as ExprBase;
    if (e.type !== 'member_access') return null;
    const memberExpr = expr as MemberAccessNode;
    const objBase = memberExpr.object as ExprBase;
    if (objBase.type !== 'this') return null;

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
  private nextTemp(): string { return this.ctx.nextTemp(); }
  private emit(instruction: string): void { this.ctx.emit(instruction); }

  /**
   * Generate code for method call expression
   *
   * @example
   * Input: { type: 'method_call', object: str, method: 'substr', args: [0, 5] }
   * Output: result register with method call result
   */
  generate(expr: MethodCallNode, params: string[]): string {
    const objBase = expr.object as { type: string };
    const method = expr.method;

    // Handle Promise static methods (Promise.resolve, Promise.reject, Promise.all)
    if (this.isVariableWithName(expr.object, 'Promise')) {
      return handlePromiseStaticMethods(this.ctx, expr, params);
    }

    // Handle Array.from() - returns the argument as-is since our iterators already produce arrays
    if (this.isVariableWithName(expr.object, 'Array') && method === 'from') {
      if (expr.args.length === 0) {
        throw new Error('Array.from() requires at least 1 argument');
      }
      return this.ctx.generateExpression(expr.args[0], params);
    }

    if (this.isVariableWithName(expr.object, 'Array') && method === 'isArray') {
      if (expr.args.length === 0) {
        throw new Error('Array.isArray() requires at least 1 argument');
      }
      const arg = expr.args[0];
      const isArray = this.ctx.isArrayExpression(arg) || this.ctx.isStringArrayExpression(arg) || this.ctx.isObjectArrayExpression(arg);
      return isArray ? '1.0' : '0.0';
    }

    if (this.isVariableWithName(expr.object, 'Object') && method === 'keys') {
      return generateObjectKeys(this.ctx, expr, params);
    }

    if (this.isVariableWithName(expr.object, 'Object') && method === 'values') {
      return generateObjectValues(this.ctx, expr, params);
    }

    if (this.isVariableWithName(expr.object, 'Object') && method === 'entries') {
      return generateObjectEntries(this.ctx, expr, params);
    }

    if (this.isVariableWithName(expr.object, 'Number') && method === 'isFinite') {
      if (expr.args.length === 0) {
        throw new Error('Number.isFinite() requires at least 1 argument');
      }
      return handleNumberIsFinite(this.ctx, expr, params);
    }

    if (this.isVariableWithName(expr.object, 'Number') && method === 'isNaN') {
      if (expr.args.length === 0) {
        throw new Error('Number.isNaN() requires at least 1 argument');
      }
      return handleNumberIsNaN(this.ctx, expr, params);
    }

    if (this.isVariableWithName(expr.object, 'Number') && method === 'isInteger') {
      if (expr.args.length === 0) {
        throw new Error('Number.isInteger() requires at least 1 argument');
      }
      return handleNumberIsInteger(this.ctx, expr, params);
    }

    // Handle Promise instance methods (.then, .catch)
    if (method === 'then' || method === 'catch') {
      const isPromise = this.ctx.isPromiseExpression(expr.object);
      if (isPromise) {
        return handlePromiseThen(this.ctx, expr, params, method === 'catch');
      }
    }

    // Handle console.log and console.error - inline check to avoid cross-class property access
    const objBase2 = expr.object as ExprBase;
    if (objBase2.type === 'variable') {
      const varNode = expr.object as VariableNode;
      if (varNode.name === 'console') {
        const method2 = expr.method;
        if (method2 === 'log' || method2 === 'error' || method2 === 'warn' || method2 === 'debug') {
          return generateConsoleCallInline(this.ctx, expr, params);
        }
      }
    }

    // Handle process.exit() - inline check
    if (objBase2.type === 'variable') {
      const varNode = expr.object as VariableNode;
      if (varNode.name === 'process' && expr.method === 'exit') {
        return generateProcessExitInline(this.ctx, expr, params);
      }
      if (varNode.name === 'process' && expr.method === 'cwd') {
        return generateProcessCwdInline(this.ctx);
      }
      if (varNode.name === 'process' && expr.method === 'chdir') {
        return handleProcessChdir(this.ctx, expr, params);
      }
      if (varNode.name === 'process' && expr.method === 'abort') {
        this.ctx.emit(`call void @abort()`);
        return '0';
      }
      if (varNode.name === 'process' && expr.method === 'kill') {
        return handleProcessKill(this.ctx, expr, params);
      }
      if (varNode.name === 'process' && expr.method === 'uptime') {
        return handleProcessUptime(this.ctx);
      }
      if (varNode.name === 'process' && expr.method === 'getuid') {
        return handleProcessSyscallI32(this.ctx, '@getuid');
      }
      if (varNode.name === 'process' && expr.method === 'getgid') {
        return handleProcessSyscallI32(this.ctx, '@getgid');
      }
      if (varNode.name === 'process' && expr.method === 'geteuid') {
        return handleProcessSyscallI32(this.ctx, '@geteuid');
      }
      if (varNode.name === 'process' && expr.method === 'getegid') {
        return handleProcessSyscallI32(this.ctx, '@getegid');
      }
      if (varNode.name === 'tty' && expr.method === 'isatty') {
        if (expr.args.length === 0) {
          throw new Error('tty.isatty() requires 1 argument (fd)');
        }
        const fdValue = this.ctx.generateExpression(expr.args[0], params);
        const fdInt = this.nextTemp();
        this.ctx.emit(`${fdInt} = fptosi double ${fdValue} to i32`);
        const rawResult = this.nextTemp();
        this.ctx.emit(`${rawResult} = call i32 @isatty(i32 ${fdInt})`);
        const boolResult = this.nextTemp();
        this.ctx.emit(`${boolResult} = icmp ne i32 ${rawResult}, 0`);
        const doubleResult = this.nextTemp();
        this.ctx.emit(`${doubleResult} = uitofp i1 ${boolResult} to double`);
        return doubleResult;
      }
    }

    // Handle fs.* methods - inline check to avoid interface dispatch issues
    if (objBase2.type === 'variable' && (expr.object as VariableNode).name === 'fs') {
      if (method === 'readFileSync') {
        return this.ctx.fsGenReadFileSync(expr, params);
      } else if (method === 'writeFileSync') {
        return this.ctx.fsGenWriteFileSync(expr, params);
      } else if (method === 'appendFileSync') {
        return this.ctx.fsGenAppendFileSync(expr, params);
      } else if (method === 'existsSync') {
        return this.ctx.fsGenExistsSync(expr, params);
      } else if (method === 'unlinkSync') {
        return this.ctx.fsGenUnlinkSync(expr, params);
      } else if (method === 'readdirSync') {
        return this.ctx.fsGenReaddirSync(expr, params);
      } else if (method === 'statSync') {
        return this.ctx.fsGenStatSync(expr, params);
      }
    }

    // Handle path.resolve() and path.dirname() (delegated to PathGenerator)
    if (method === 'resolve' && this.isVariableWithName(expr.object, 'path')) {
      return this.ctx.pathGenGenerateResolve(expr, params);
    }
    if (method === 'dirname' && this.isVariableWithName(expr.object, 'path')) {
      return this.ctx.pathGenGenerateDirname(expr, params);
    }
    if (method === 'basename' && this.isVariableWithName(expr.object, 'path')) {
      return this.ctx.pathGenGenerateBasename(expr, params);
    }
    if (method === 'join' && this.isVariableWithName(expr.object, 'path')) {
      return this.ctx.pathGenGenerateJoin(expr, params);
    }

    // Handle execSync() from child_process
    if (method === 'execSync') {
      const objName = this.getVariableName(expr.object);
      if (objName === 'child_process' || objName === 'cp') {
        return this.handleExecSync(expr, params);
      }
    }

    if (method === 'write' && isProcessStdoutOrStderr(expr)) {
      return handleProcessWrite(this.ctx, expr, params);
    }

    // Handle JSON.parse() and JSON.stringify() - inline check
    if (objBase2.type === 'variable' && (expr.object as VariableNode).name === 'JSON') {
      if (method === 'parse') {
        this.ctx.setUsesJson(true);
        return this.ctx.jsonGenGenerateParse(expr, params);
      } else if (method === 'stringify') {
        return this.ctx.jsonGenGenerateStringify(expr, params);
      }
    }

    // Handle Math.* methods (delegated to MathGenerator)
    if (this.ctx.mathGenCanHandle(expr)) {
      return this.ctx.mathGenGenerateMathMethod(expr, params);
    }

    // Handle Date.now()
    if (this.ctx.dateGenCanHandle(expr)) {
      return this.ctx.dateGenGenerateNow();
    }

    // Handle crypto.* methods
    if (objBase2.type === 'variable' && (expr.object as VariableNode).name === 'crypto') {
      this.ctx.setUsesCrypto(true);
      if (method === 'sha256') {
        return this.ctx.cryptoGenSha256(expr, params);
      } else if (method === 'md5') {
        return this.ctx.cryptoGenMd5(expr, params);
      } else if (method === 'sha512') {
        return this.ctx.cryptoGenSha512(expr, params);
      } else if (method === 'randomBytes') {
        return this.ctx.cryptoGenRandomBytes(expr, params);
      }
    }

    // Handle sqlite.* methods
    if (objBase2.type === 'variable' && (expr.object as VariableNode).name === 'sqlite') {
      this.ctx.setUsesSqlite(true);
      if (method === 'open') {
        return this.ctx.sqliteGenOpen(expr, params);
      } else if (method === 'exec') {
        return this.ctx.sqliteGenExec(expr, params);
      } else if (method === 'get') {
        return this.ctx.sqliteGenGet(expr, params);
      } else if (method === 'all') {
        return this.ctx.sqliteGenAll(expr, params);
      } else if (method === 'close') {
        return this.ctx.sqliteGenClose(expr, params);
      }
    }

    // Handle JSON.stringify() (legacy implementation)
    if (method === 'stringify' && this.isVariableWithName(expr.object, 'JSON')) {
      return this.handleJsonStringify(expr, params);
    }

    // Handle regex methods
    if (method === 'test') {
      const isRegex = this.ctx.isRegexExpression(expr.object);
      if (isRegex) {
        return this.handleRegexTest(expr, params);
      }
    }

    if (method === 'exec') {
      const isRegex = this.ctx.isRegexExpression(expr.object);
      if (isRegex) {
        return this.handleRegexExec(expr, params);
      }
    }

    // Handle Response methods (from fetch())
    if (method === 'text' || method === 'json') {
      const isLikelyResponse = this.isLikelyResponseExpression(expr);
      if (isLikelyResponse) {
        try {
          this.ctx.syncStateToGenerators();
          let responsePtr = this.ctx.generateExpression(expr.object, params);

          const objType = this.ctx.getVariableType(responsePtr);
          if (objType === 'i8*') {
            const castPtr = this.ctx.nextTemp();
            this.ctx.emit(`${castPtr} = bitcast i8* ${responsePtr} to %__FetchResponse*`);
            responsePtr = castPtr;
          }

          if (method === 'text') {
            return this.ctx.responseGenGenerateText(responsePtr);
          } else if (method === 'json') {
            this.ctx.setUsesJson(true);
            if (expr.typeParameter) {
              const typeName = expr.typeParameter;
              const interfaceDefResult = getInterfaceFromAST(this.ctx, typeName);
              if (interfaceDefResult) {
                const interfaceDef = interfaceDefResult as InterfaceDefInfo;
                return this.ctx.responseGenGenerateTypedJson(responsePtr, typeName, interfaceDef);
              }
            }
            return this.ctx.responseGenGenerateJson(responsePtr);
          }
        } catch (e) {
          throw e;
        }
      }
    }

    // Handle string methods
    if (method === 'substr') {
      return handleSubstr(this.ctx, expr, params);
    }
    if (method === 'substring') {
      return handleSubstring(this.ctx, expr, params);
    }
    if (method === 'concat' && !this.ctx.isArrayExpression(expr.object) && !this.ctx.isStringArrayExpression(expr.object) && !this.ctx.isObjectArrayExpression(expr.object)) {
      return handleConcat(this.ctx, expr, params);
    }
    if (method === 'repeat') {
      return handleRepeat(this.ctx, expr, params);
    }
    if (method === 'padStart') {
      return handlePadStart(this.ctx, expr, params);
    }
    if (method === 'split') {
      return handleSplit(this.ctx, expr, params);
    }
    if (method === 'startsWith') {
      return handleStartsWith(this.ctx, expr, params);
    }
    if (method === 'endsWith') {
      return handleEndsWith(this.ctx, expr, params);
    }
    if (method === 'trim') {
      return handleTrim(this.ctx, expr, params);
    }
    if (method === 'trimStart') {
      return handleTrimStart(this.ctx, expr, params);
    }
    if (method === 'trimEnd') {
      return handleTrimEnd(this.ctx, expr, params);
    }
    if (method === 'indexOf') {
      if (this.ctx.isStringArrayExpression(expr.object)) {
        return handleStringArrayIndexOf(this.ctx, expr, params);
      }
      return handleIndexOf(this.ctx, expr, params);
    }
    if (method === 'includes') {
      if (this.ctx.isStringArrayExpression(expr.object)) {
        return handleStringArrayIncludes(this.ctx, expr, params);
      }
      if (!this.ctx.isArrayExpression(expr.object)) {
        return handleStringIncludes(this.ctx, expr, params);
      }
    }
    if (method === 'slice' && !this.ctx.isArrayExpression(expr.object) && !this.ctx.isStringArrayExpression(expr.object) && !this.ctx.isObjectArrayExpression(expr.object)) {
      return handleSlice(this.ctx, expr, params);
    }
    if (method === 'replace') {
      return handleReplace(this.ctx, expr, params);
    }
    if (method === 'replaceAll') {
      return handleReplaceAll(this.ctx, expr, params);
    }
    if (method === 'charAt') {
      return handleCharAt(this.ctx, expr, params);
    }
    if (method === 'charCodeAt') {
      return handleCharCodeAt(this.ctx, expr, params);
    }
    if (method === 'toUpperCase') {
      return handleToUpperCase(this.ctx, expr, params);
    }
    if (method === 'toLowerCase') {
      return handleToLowerCase(this.ctx, expr, params);
    }
    if (method === 'toString') {
      if (!this.ctx.isStringExpression(expr.object) && !this.ctx.isArrayExpression(expr.object) && !this.ctx.isStringArrayExpression(expr.object)) {
        return handleNumberToString(this.ctx, expr, params);
      }
    }
    if (method === 'match') {
      if (this.ctx.isStringExpression(expr.object)) {
        return handleMatch(this.ctx, expr, params);
      }
    }

    // Handle Map methods
    if (method === 'set' || method === 'get' || method === 'has' || method === 'clear' || method === 'delete' || method === 'entries' || method === 'values' || method === 'keys') {
      const varName = this.getVariableName(expr.object);
      if (varName && this.ctx.symbolTableIsMap(varName)) {
        this.ctx.syncStateToGenerators();
        const mapMeta = this.ctx.symbolTableGetMapMetadata(varName);

        if (mapMeta && mapMeta.keyType === 'string') {
          const mapAlloca = this.ctx.symbolTableGetAlloca(varName);
          if (mapAlloca) {
            if (method === 'set') {
              const keyValue = this.ctx.generateExpression(expr.args[0], params);
              const valueValue = this.ctx.generateExpression(expr.args[1], params);
              return this.ctx.stringMapGenGenerateStringMapSet(mapAlloca, keyValue, valueValue);
            } else if (method === 'get') {
              const keyValue = this.ctx.generateExpression(expr.args[0], params);
              return this.ctx.stringMapGenGenerateStringMapGet(mapAlloca, keyValue);
            } else if (method === 'has') {
              const keyValue = this.ctx.generateExpression(expr.args[0], params);
              return this.ctx.stringMapGenGenerateStringMapHas(mapAlloca, keyValue);
            } else if (method === 'delete') {
              const keyValue = this.ctx.generateExpression(expr.args[0], params);
              return this.ctx.stringMapGenGenerateStringMapDelete(mapAlloca, keyValue);
            } else if (method === 'entries') {
              return this.ctx.stringMapGenGenerateStringMapEntries(mapAlloca);
            } else if (method === 'values') {
              return this.ctx.stringMapGenGenerateStringMapValues(mapAlloca);
            } else if (method === 'keys') {
              return this.ctx.stringMapGenGenerateStringMapKeys(mapAlloca);
            } else {
              return this.ctx.stringMapGenGenerateStringMapClear(mapAlloca);
            }
          }
        }

        if (method === 'set') {
          return this.ctx.mapGenGenerateMapSet(expr, params);
        } else if (method === 'get') {
          return this.ctx.mapGenGenerateMapGet(expr, params);
        } else if (method === 'has') {
          return this.ctx.mapGenGenerateMapHas(expr, params);
        } else if (method === 'delete') {
          return this.ctx.mapGenGenerateMapDelete(expr, params);
        } else if (method === 'entries' || method === 'values' || method === 'keys') {
          throw new Error(`Map.${method}() only supported for Map<string, *> types`);
        } else {
          return this.ctx.mapGenGenerateMapClear(expr, params);
        }
      }

      if (varName) {
        const paramMapKeyType = this.getParameterMapKeyType(varName);
        if (paramMapKeyType) {
          this.ctx.syncStateToGenerators();
          const mapPtr = this.ctx.generateExpression(expr.object, params);
          if (paramMapKeyType === 'string') {
            if (method === 'set') {
              const keyValue = this.ctx.generateExpression(expr.args[0], params);
              const valueValue = this.ctx.generateExpression(expr.args[1], params);
              return this.ctx.stringMapGenGenerateStringMapSet(mapPtr, keyValue, valueValue);
            } else if (method === 'get') {
              const keyValue = this.ctx.generateExpression(expr.args[0], params);
              return this.ctx.stringMapGenGenerateStringMapGet(mapPtr, keyValue);
            } else if (method === 'has') {
              const keyValue = this.ctx.generateExpression(expr.args[0], params);
              return this.ctx.stringMapGenGenerateStringMapHas(mapPtr, keyValue);
            } else if (method === 'delete') {
              const keyValue = this.ctx.generateExpression(expr.args[0], params);
              return this.ctx.stringMapGenGenerateStringMapDelete(mapPtr, keyValue);
            } else if (method === 'clear') {
              return this.ctx.stringMapGenGenerateStringMapClear(mapPtr);
            } else if (method === 'entries') {
              return this.ctx.stringMapGenGenerateStringMapEntries(mapPtr);
            } else if (method === 'values') {
              return this.ctx.stringMapGenGenerateStringMapValues(mapPtr);
            } else {
              return this.ctx.stringMapGenGenerateStringMapKeys(mapPtr);
            }
          } else {
            if (method === 'set') {
              const keyValue = this.ctx.generateExpression(expr.args[0], params);
              const valueValue = this.ctx.generateExpression(expr.args[1], params);
              return this.ctx.pointerMapGenGeneratePointerMapSet(mapPtr, keyValue, valueValue);
            } else if (method === 'get') {
              const keyValue = this.ctx.generateExpression(expr.args[0], params);
              return this.ctx.pointerMapGenGeneratePointerMapGet(mapPtr, keyValue, 'i8*');
            } else if (method === 'clear') {
              return this.ctx.pointerMapGenGeneratePointerMapClear(mapPtr);
            } else {
              throw new Error(`Map.${method}() not supported for Map<${paramMapKeyType}, *> parameter types`);
            }
          }
        }
      }

      const thisFieldMapKeyType = this.getThisFieldMapKeyType(expr.object);
      if (thisFieldMapKeyType) {
        const mapPtr = this.ctx.generateExpression(expr.object, params);
        if (thisFieldMapKeyType === 'string') {
          if (method === 'set') {
            const keyValue = this.ctx.generateExpression(expr.args[0], params);
            const valueValue = this.ctx.generateExpression(expr.args[1], params);
            return this.ctx.stringMapGenGenerateStringMapSet(mapPtr, keyValue, valueValue);
          } else if (method === 'get') {
            const keyValue = this.ctx.generateExpression(expr.args[0], params);
            return this.ctx.stringMapGenGenerateStringMapGet(mapPtr, keyValue);
          } else if (method === 'has') {
            const keyValue = this.ctx.generateExpression(expr.args[0], params);
            return this.ctx.stringMapGenGenerateStringMapHas(mapPtr, keyValue);
          } else if (method === 'delete') {
            const keyValue = this.ctx.generateExpression(expr.args[0], params);
            return this.ctx.stringMapGenGenerateStringMapDelete(mapPtr, keyValue);
          } else if (method === 'entries') {
            return this.ctx.stringMapGenGenerateStringMapEntries(mapPtr);
          } else if (method === 'values') {
            return this.ctx.stringMapGenGenerateStringMapValues(mapPtr);
          } else {
            return this.ctx.stringMapGenGenerateStringMapClear(mapPtr);
          }
        } else {
          const mapPtr = this.ctx.generateExpression(expr.object, params);
          if (method === 'set') {
            const keyValue = this.ctx.generateExpression(expr.args[0], params);
            const valueValue = this.ctx.generateExpression(expr.args[1], params);
            return this.ctx.pointerMapGenGeneratePointerMapSet(mapPtr, keyValue, valueValue);
          } else if (method === 'get') {
            const keyValue = this.ctx.generateExpression(expr.args[0], params);
            return this.ctx.pointerMapGenGeneratePointerMapGet(mapPtr, keyValue, 'i8*');
          } else if (method === 'clear') {
            return this.ctx.pointerMapGenGeneratePointerMapClear(mapPtr);
          } else {
            throw new Error(`Map.${method}() not supported for Map<${thisFieldMapKeyType}, *> types`);
          }
        }
      }
    }

    // Handle Set methods
    if (method === 'add' || method === 'has' || method === 'delete') {
      const varName = this.getVariableName(expr.object);
      if (varName && this.ctx.symbolTableIsSet(varName)) {
        this.ctx.syncStateToGenerators();
        const setValueType = this.ctx.symbolTableGetSetMetadata(varName);

        if (setValueType && setValueType === 'string') {
          const setAlloca = this.ctx.symbolTableGetAlloca(varName);
          if (setAlloca) {
            if (method === 'add') {
              const valueValue = this.ctx.generateExpression(expr.args[0], params);
              return this.ctx.stringSetGenGenerateStringSetAdd(setAlloca, valueValue);
            } else if (method === 'has') {
              const valueValue = this.ctx.generateExpression(expr.args[0], params);
              return this.ctx.stringSetGenGenerateStringSetHas(setAlloca, valueValue);
            } else {
              throw new Error('Set.delete() not yet implemented for Set<string>');
            }
          }
        }

        if (method === 'add') {
          return this.ctx.setGenGenerateSetAdd(expr, params);
        } else if (method === 'has') {
          return this.ctx.setGenGenerateSetHas(expr, params);
        } else {
          return this.ctx.setGenGenerateSetDelete(expr, params);
        }
      }

      const thisFieldSetValueType = this.getThisFieldSetValueType(expr.object);
      if (thisFieldSetValueType) {
        const setPtr = this.ctx.generateExpression(expr.object, params);
        if (thisFieldSetValueType === 'string') {
          if (method === 'add') {
            const valueValue = this.ctx.generateExpression(expr.args[0], params);
            return this.ctx.stringSetGenGenerateStringSetAdd(setPtr, valueValue);
          } else if (method === 'has') {
            const valueValue = this.ctx.generateExpression(expr.args[0], params);
            return this.ctx.stringSetGenGenerateStringSetHas(setPtr, valueValue);
          } else {
            throw new Error('Set.delete() not yet implemented for Set<string>');
          }
        }
      }
    }

    // Handle array methods (arrayGen uses context pattern - no sync needed! 🎯)
    if (method === 'push') {
      return this.ctx.arrayGenGenerateArrayPush(expr, params);
    } else if (method === 'pop') {
      return this.ctx.arrayGenGenerateArrayPop(expr, params);
    } else if (method === 'includes' && this.ctx.isArrayExpression(expr.object)) {
      return this.ctx.arrayGenGenerateArrayIncludes(expr, params);
    } else if (method === 'map') {
      if (this.ctx.isStringArrayExpression(expr.object)) {
        return this.ctx.arrayGenGenerateStringArrayMap(expr, params);
      }
      return this.ctx.arrayGenGenerateArrayMap(expr, params);
    } else if (method === 'join' && (this.ctx.isStringArrayExpression(expr.object) || this.ctx.isArrayExpression(expr.object) || this.ctx.isObjectArrayExpression(expr.object))) {
      return this.ctx.arrayGenGenerateArrayJoin(expr, params);
    } else if (method === 'find') {
      return this.ctx.arrayGenGenerateArrayFind(expr, params);
    } else if (method === 'some') {
      return this.ctx.arrayGenGenerateArraySome(expr, params);
    } else if (method === 'every') {
      return this.ctx.arrayGenGenerateArrayEvery(expr, params);
    } else if (method === 'filter') {
      return this.ctx.arrayGenGenerateArrayFilter(expr, params);
    } else if (method === 'forEach') {
      return this.ctx.arrayGenGenerateArrayForEach(expr, params);
    } else if (method === 'reduce') {
      return this.ctx.arrayGenGenerateArrayReduce(expr, params);
    } else if (method === 'slice' && (this.ctx.isArrayExpression(expr.object) || this.ctx.isStringArrayExpression(expr.object) || this.ctx.isObjectArrayExpression(expr.object))) {
      return this.ctx.arrayGenGenerateArraySlice(expr, params);
    } else if (method === 'concat' && (this.ctx.isArrayExpression(expr.object) || this.ctx.isStringArrayExpression(expr.object) || this.ctx.isObjectArrayExpression(expr.object))) {
      return this.ctx.arrayGenGenerateArrayConcat(expr, params);
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
    if (exprObjBase.type === 'variable') {
      const varName = (expr.object as VariableNode).name;
      const ast = this.ctx.getAst();
      if (ast && ast.imports) {
        for (let ii = 0; ii < ast.imports.length; ii++) {
          const imp = ast.imports[ii];
          if (!imp) continue;
          const isRelative = imp.source.startsWith('./') || imp.source.startsWith('../') || imp.source.startsWith('/');
          if (!isRelative && imp.specifiers && imp.specifiers.indexOf(varName) !== -1) {
            return 'null';
          }
        }
      }
    }

    this.throwUnsupportedMethodError(method, exprObjBase.type, expr);
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
    this.emit(`${result} = call i32 @system(i8* ${commandPtr})`);

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
      this.emit(`${strLen} = call i64 @strlen(i8* ${strPtr})`);
      const bufferSize = this.nextTemp();
      this.emit(`${bufferSize} = add i64 ${strLen}, 3`);
      const buffer = this.nextTemp();
      this.emit(`${buffer} = call i8* @GC_malloc_atomic(i64 ${bufferSize})`);

      // Create format string: "\"%s\""
      const formatStr = this.ctx.stringGenCreateStringConstant('"%s"');
      const sprintfResult = this.nextTemp();
      this.emit(`${sprintfResult} = call i32 (i8*, i8*, ...) @sprintf(i8* ${buffer}, i8* ${formatStr}, i8* ${strPtr})`);

      return buffer;
    } else {
      // For numbers, convert to string
      const numValue = this.ctx.generateExpression(arg, params);

      // Allocate buffer for number string (30 chars should be enough for double)
      const buffer = this.nextTemp();
      this.emit(`${buffer} = call i8* @GC_malloc_atomic(i64 30)`);

      // Create format string: "%f"
      const formatStr = this.ctx.stringGenCreateStringConstant('%f');
      const sprintfResult = this.nextTemp();
      this.emit(`${sprintfResult} = call i32 (i8*, i8*, ...) @sprintf(i8* ${buffer}, i8* ${formatStr}, double ${numValue})`);

      return buffer;
    }
  }

  private handleRegexTest(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const regexPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length !== 1) {
      throw new Error(`test() expects 1 argument, got ${expr.args.length}`);
    }

    const testStr = this.ctx.generateExpression(expr.args[0], params);
    return this.ctx.regexGenGenerateRegexTest(regexPtr, testStr);
  }

  private handleRegexExec(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();

    if (expr.args.length !== 1) {
      throw new Error(`exec() expects 1 argument, got ${expr.args.length}`);
    }

    const strPtr = this.ctx.generateExpression(expr.args[0], params);

    const regexObj = expr.object;
    const regexBase = regexObj as { type: string; pattern?: string; flags?: string };

    let numGroups = 0;
    if (regexBase.type === 'regex' && regexBase.pattern) {
      const pattern = regexBase.pattern;
      for (let gi = 0; gi < pattern.length; gi++) {
        if (pattern[gi] === '(') {
          numGroups = numGroups + 1;
        }
      }
    } else {
      numGroups = 9;
    }

    const regexPtr = this.ctx.generateExpression(regexObj, params);
    return this.ctx.regexGenGenerateRegexMatch(regexPtr, strPtr, numGroups);
  }


  private throwUnsupportedMethodError(method: string, _objectType?: string, methodCallExpr?: MethodCallNode): never {
    let objectDescription = '';
    let pos: number | undefined = undefined;

    if (methodCallExpr) {
      pos = methodCallExpr.pos;
      const expr = methodCallExpr.object;
      if (expr) {
        const e = expr as ExprBase;
        if (e.type === 'member_access') {
          const memberExpr = expr as MemberAccessNode;
          const memberObjBase = memberExpr.object as ExprBase;
          if (memberObjBase && memberObjBase.type === 'variable') {
            objectDescription = `${(memberExpr.object as VariableNode).name}.${memberExpr.property}`;
          } else {
            objectDescription = memberExpr.property;
          }
        } else if (e.type === 'variable') {
          objectDescription = (expr as VariableNode).name;
        }
      }
    }

    // Simple one-line suggestions for common unsupported methods
    let suggestion: string | undefined = undefined;
    if (method === 'isInteger') {
      suggestion = `Use (value % 1 === 0) instead`;
    } else if (method === 'isNaN') {
      suggestion = `Use (value !== value) instead`;
    } else if (method === 'includes') {
      suggestion = `Use indexOf(...) !== -1 instead`;
    }

    const errorMsg = objectDescription
      ? `Method '${method}' on '${objectDescription}' is not supported.`
      : `Method '${method}' is not supported.`;

    throw new Error(this.ctx.formatCodegenError(errorMsg, suggestion || '', pos));
  }

  private isLikelyResponseExpression(expr: MethodCallNode): boolean {
    const exprObj = expr.object as ExprBase;
    if (exprObj.type === 'variable') {
      const varName = (expr.object as VariableNode).name;
      const varType = this.ctx.symbolTableGetType(varName);
      if (varType === '%__FetchResponse*') return true;
    }
    if (exprObj.type === 'index_access' || exprObj.type === 'member_access') {
      return true;
    }
    if (exprObj.type === 'call') {
      return true;
    }
    if (exprObj.type === 'await') {
      return true;
    }
    return false;
  }
}
