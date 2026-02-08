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
  NewNode,
  VariableNode,
  ObjectNode,
  ArrowFunctionNode,
  AST,
  ClassNode,
  FunctionNode,
  MemberAccessNode,
  InterfaceDeclaration,
  InterfaceField,
  RegexNode,
  TypeAssertionNode,
} from '../../ast/types.js';
import type { SymbolTable } from '../infrastructure/symbol-table.js';
import type { TypeChecker } from '../../typescript/type-checker.js';
import type { TypeResolver } from '../infrastructure/type-resolver/index.js';
import { parseMapTypeString, parseSetTypeString } from '../infrastructure/type-system.js';

interface ExprBase { type: string; }

interface SubGenerator {
  canHandle(expr: MethodCallNode): boolean;
}

interface ConsoleGeneratorLike extends SubGenerator {
  generateConsoleCall(method: string, args: Expression[], params: string[]): string;
}

interface ProcessGeneratorLike extends SubGenerator {
  generateProcessExit(expr: MethodCallNode, params: string[]): string;
}

interface FilesystemGeneratorLike extends SubGenerator {
  generateReadFileSync(expr: MethodCallNode, params: string[]): string;
  generateWriteFileSync(expr: MethodCallNode, params: string[]): string;
  generateAppendFileSync(expr: MethodCallNode, params: string[]): string;
  generateExistsSync(expr: MethodCallNode, params: string[]): string;
  generateUnlinkSync(expr: MethodCallNode, params: string[]): string;
}

interface PathGeneratorLike {
  generateResolve(expr: MethodCallNode, params: string[]): string;
  generateDirname(expr: MethodCallNode, params: string[]): string;
  generateBasename(expr: MethodCallNode, params: string[]): string;
}

interface JsonGeneratorLike extends SubGenerator {
  generateParse(expr: MethodCallNode, params: string[]): string;
  generateStringify(expr: MethodCallNode, params: string[]): string;
}

interface MathGeneratorLike extends SubGenerator {
  generateMathMethod(expr: MethodCallNode, params: string[]): string;
}

interface StringGeneratorLike {
  doCreateStringConstant(value: string): string;
  doGenerateSubstr(strPtr: string, startIndex: string, length: string | null): string;
  doGenerateStringConcatDirect(left: string, right: string): string;
  doGenerateRepeat(strPtr: string, count: string): string;
  doGeneratePadStart(strPtr: string, targetLength: string, padString: string): string;
  doGenerateSplit(strPtr: string, delimiter: string): string;
  doGenerateStartsWith(strPtr: string, prefix: string): string;
  doGenerateEndsWith(strPtr: string, suffix: string): string;
  doGenerateTrim(strPtr: string): string;
  doGenerateToUpperCase(strPtr: string): string;
  doGenerateToLowerCase(strPtr: string): string;
  doGenerateIndexOf(strPtr: string, substring: string): string;
  doGenerateIncludes(strPtr: string, substring: string): string;
  doGenerateSlice(strPtr: string, start: string, end: string | null): string;
  doGenerateCharAt(strPtr: string, index: string): string;
  doGenerateCharCodeAt(strPtr: string, index: string): string;
  doGenerateReplace(strPtr: string, search: string, replace: string): string;
  doGenerateReplaceAll(strPtr: string, search: string, replace: string): string;
  doGenerateGlobalString(value: string): string;
}

interface RegexGeneratorLike {
  generateRegexTest(regexPtr: string, testStr: string): string;
  generateRegexCompile(pattern: string, flags: string): string;
  generateRegexMatch(regexPtr: string, testStr: string, numGroups: number): string;
}

interface ResponseGeneratorLike {
  generateText(responsePtr: string): string;
  generateJson(responsePtr: string): string;
  generateTypedJson(responsePtr: string, typeName: string, interfaceDef: InterfaceDefInfo): string;
}

interface InterfaceDefInfo {
  properties: { name: string; type: string }[];
}

interface StringMapGeneratorLike {
  generateStringMapSet(mapAlloca: string, key: string, value: string): string;
  generateStringMapGet(mapAlloca: string, key: string): string;
  generateStringMapHas(mapAlloca: string, key: string): string;
  generateStringMapClear(mapAlloca: string): string;
  generateStringMapDelete(mapAlloca: string, key: string): string;
  generateStringMapEntries(mapAlloca: string): string;
  generateStringMapValues(mapAlloca: string): string;
  generateStringMapKeys(mapAlloca: string): string;
}

interface StringSetGeneratorLike {
  generateStringSetAdd(setAlloca: string, value: string): string;
  generateStringSetHas(setAlloca: string, value: string): string;
}

interface MapGeneratorLike {
  generateMapSet(expr: MethodCallNode, params: string[]): string;
  generateMapGet(expr: MethodCallNode, params: string[]): string;
  generateMapHas(expr: MethodCallNode, params: string[]): string;
  generateMapClear(expr: MethodCallNode, params: string[]): string;
  generateMapDelete(expr: MethodCallNode, params: string[]): string;
}

interface PointerMapGeneratorLike {
  generatePointerMapGet(mapPtr: string, keyToFind: string, valueType: string): string;
  generatePointerMapSet(mapPtr: string, keyValue: string, valueValue: string): string;
  generatePointerMapClear(mapPtr: string): string;
}

interface SetGeneratorLike {
  generateSetAdd(expr: MethodCallNode, params: string[]): string;
  generateSetHas(expr: MethodCallNode, params: string[]): string;
  generateSetDelete(expr: MethodCallNode, params: string[]): string;
}

interface ArrayGeneratorLike {
  generateArrayPush(expr: MethodCallNode, params: string[]): string;
  generateArrayPop(expr: MethodCallNode, params: string[]): string;
  generateArrayIncludes(expr: MethodCallNode, params: string[]): string;
  generateArrayMap(expr: MethodCallNode, params: string[]): string;
  generateStringArrayMap(expr: MethodCallNode, params: string[]): string;
  generateArrayJoin(expr: MethodCallNode, params: string[]): string;
  generateArrayFind(expr: MethodCallNode, params: string[]): string;
  generateArraySome(expr: MethodCallNode, params: string[]): string;
  generateArrayEvery(expr: MethodCallNode, params: string[]): string;
  generateArrayFilter(expr: MethodCallNode, params: string[]): string;
  generateArrayForEach(expr: MethodCallNode, params: string[]): string;
  generateArraySlice(expr: MethodCallNode, params: string[]): string;
  generateArrayConcat(expr: MethodCallNode, params: string[]): string;
}

interface ClassGeneratorLike {
  generateMethodCall(instancePtr: string, className: string, method: string, args: Expression[], params: string[]): string;
  getFieldInfo(className: string, fieldName: string): { index: number; type: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' | 'boolean'; tsType?: string } | null;
  thisPointer?: string | null;
  currentClassName?: string | null;
  getCurrentClassName(): string | null;
}

interface ArrowFunctionGeneratorLike {
  generateArrowFunction(
    callback: Expression,
    params: string[],
    callbackTypes?: { paramTypes?: string[]; returnType?: string },
    scopeVarNames?: string[],
    scopeVarTypes?: string[]
  ): string;
}

interface ExpressionGeneratorLike {
  arrowFunctionGen: ArrowFunctionGeneratorLike;
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
  typeChecker: TypeChecker | null;
  typeResolver?: TypeResolver;
  usesPromises: boolean;
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
  fsGenReadFileSync(expr: MethodCallNode, params: string[]): string;
  fsGenWriteFileSync(expr: MethodCallNode, params: string[]): string;
  fsGenAppendFileSync(expr: MethodCallNode, params: string[]): string;
  fsGenExistsSync(expr: MethodCallNode, params: string[]): string;
  fsGenUnlinkSync(expr: MethodCallNode, params: string[]): string;
  pathGenGenerateResolve(expr: MethodCallNode, params: string[]): string;
  pathGenGenerateDirname(expr: MethodCallNode, params: string[]): string;
  pathGenGenerateBasename(expr: MethodCallNode, params: string[]): string;
  jsonGenGenerateParse(expr: MethodCallNode, params: string[]): string;
  jsonGenGenerateStringify(expr: MethodCallNode, params: string[]): string;
  mathGenCanHandle(expr: MethodCallNode): boolean;
  mathGenGenerateMathMethod(expr: MethodCallNode, params: string[]): string;
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
  arrayGenGenerateArraySlice(expr: MethodCallNode, params: string[]): string;
  arrayGenGenerateArrayConcat(expr: MethodCallNode, params: string[]): string;
  regexGenGenerateRegexTest(regexPtr: string, testStr: string): string;
  regexGenGenerateRegexCompile(pattern: string, flags: string): string;
  regexGenGenerateRegexMatch(regexPtr: string, testStr: string, numGroups: number): string;
}

export class MethodCallGenerator {
  constructor(private ctx: MethodCallGeneratorContext) {}

  private getInterfaceFromAST(name: string): InterfaceDefInfo | null {
    const len = this.ctx.getAstInterfacesLength();
    for (let i = 0; i < len; i++) {
      const ifaceName = this.ctx.getAstInterfaceNameAt(i);
      if (ifaceName === name) {
        const ifaceItem = this.ctx.getAstInterfaceAt(i);
        if (!ifaceItem) continue;
        const properties: { name: string; type: string }[] = [];
        for (let j = 0; j < ifaceItem.fields.length; j++) {
          const field = ifaceItem.fields[j] as { name: string; type: string };
          properties.push({ name: field.name, type: field.type });
        }
        return { properties };
      }
    }
    return null;
  }

  private getInterfaceDecl(name: string): InterfaceDeclaration | null {
    const len = this.ctx.getAstInterfacesLength();
    for (let i = 0; i < len; i++) {
      const ifaceName = this.ctx.getAstInterfaceNameAt(i);
      if (ifaceName === name) {
        return this.ctx.getAstInterfaceAt(i);
      }
    }
    return null;
  }

  private getFunctionFromAST(name: string): FunctionNode | null {
    const len = this.ctx.getAstFunctionsLength();
    for (let i = 0; i < len; i++) {
      const funcName = this.ctx.getAstFunctionNameAt(i);
      if (funcName === name) {
        return this.ctx.getAstFunctionAt(i);
      }
    }
    return null;
  }

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

  private generateConsoleCallInline(expr: MethodCallNode, params: string[]): string {
    const method = expr.method;
    const useStderr = method === 'error' || method === 'warn';

    if (expr.args.length === 0) {
      if (useStderr) {
        const stderrPtr = this.ctx.nextTemp();
        this.ctx.emit(`${stderrPtr} = load i8*, i8** @stderr`);
        const temp = this.ctx.nextTemp();
        this.ctx.emit(`${temp} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, i8* getelementptr([2 x i8], [2 x i8]* @.str.newline, i32 0, i32 0))`);
        const flushTemp = this.ctx.nextTemp();
        this.ctx.emit(`${flushTemp} = call i32 @fflush(i8* ${stderrPtr})`);
        return temp;
      } else {
        const temp = this.ctx.nextTemp();
        this.ctx.emit(`${temp} = call i32 (i8*, ...) @printf(i8* getelementptr([2 x i8], [2 x i8]* @.str.newline, i32 0, i32 0))`);
        return temp;
      }
    }

    const arg = expr.args[0];
    const argTyped = arg as { type: string; value: string | number };

    if (argTyped.type === 'string') {
      const strValue = argTyped.value as string;
      const strConstPtr = this.ctx.stringGenCreateStringConstant(strValue + '\n');
      if (useStderr) {
        const stderrPtr = this.ctx.nextTemp();
        this.ctx.emit(`${stderrPtr} = load i8*, i8** @stderr`);
        const temp = this.ctx.nextTemp();
        this.ctx.emit(`${temp} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, i8* ${strConstPtr})`);
        const flushTemp = this.ctx.nextTemp();
        this.ctx.emit(`${flushTemp} = call i32 @fflush(i8* ${stderrPtr})`);
        return temp;
      } else {
        const temp = this.ctx.nextTemp();
        this.ctx.emit(`${temp} = call i32 (i8*, ...) @printf(i8* ${strConstPtr})`);
        return temp;
      }
    } else if (argTyped.type === 'number') {
      const argValue = this.ctx.generateExpression(arg as Expression, params);
      if (useStderr) {
        const stderrPtr = this.ctx.nextTemp();
        this.ctx.emit(`${stderrPtr} = load i8*, i8** @stderr`);
        const temp = this.ctx.nextTemp();
        this.ctx.emit(`${temp} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, i8* getelementptr([4 x i8], [4 x i8]* @.str.numfmt, i32 0, i32 0), double ${argValue})`);
        const flushTemp = this.ctx.nextTemp();
        this.ctx.emit(`${flushTemp} = call i32 @fflush(i8* ${stderrPtr})`);
        return temp;
      } else {
        const temp = this.ctx.nextTemp();
        this.ctx.emit(`${temp} = call i32 (i8*, ...) @printf(i8* getelementptr([4 x i8], [4 x i8]* @.str.numfmt, i32 0, i32 0), double ${argValue})`);
        return temp;
      }
    } else {
      const argValue = this.ctx.generateExpression(arg as Expression, params);
      const isString = this.ctx.isStringExpression(arg as Expression);
      if (isString) {
        if (useStderr) {
          const stderrPtr = this.ctx.nextTemp();
          this.ctx.emit(`${stderrPtr} = load i8*, i8** @stderr`);
          const temp = this.ctx.nextTemp();
          this.ctx.emit(`${temp} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, i8* getelementptr([4 x i8], [4 x i8]* @.str.strfmt, i32 0, i32 0), i8* ${argValue})`);
          const flushTemp = this.ctx.nextTemp();
          this.ctx.emit(`${flushTemp} = call i32 @fflush(i8* ${stderrPtr})`);
          return temp;
        } else {
          const temp = this.ctx.nextTemp();
          this.ctx.emit(`${temp} = call i32 (i8*, ...) @printf(i8* getelementptr([4 x i8], [4 x i8]* @.str.strfmt, i32 0, i32 0), i8* ${argValue})`);
          return temp;
        }
      } else {
        if (useStderr) {
          const stderrPtr = this.ctx.nextTemp();
          this.ctx.emit(`${stderrPtr} = load i8*, i8** @stderr`);
          const temp = this.ctx.nextTemp();
          this.ctx.emit(`${temp} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, i8* getelementptr([4 x i8], [4 x i8]* @.str.numfmt, i32 0, i32 0), double ${argValue})`);
          const flushTemp = this.ctx.nextTemp();
          this.ctx.emit(`${flushTemp} = call i32 @fflush(i8* ${stderrPtr})`);
          return temp;
        } else {
          const temp = this.ctx.nextTemp();
          this.ctx.emit(`${temp} = call i32 (i8*, ...) @printf(i8* getelementptr([4 x i8], [4 x i8]* @.str.numfmt, i32 0, i32 0), double ${argValue})`);
          return temp;
        }
      }
    }
  }

  private generateProcessExitInline(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length > 0) {
      const arg = expr.args[0];
      const argTyped = arg as { type: string; value: number };
      if (argTyped.type === 'number') {
        const exprResult = this.ctx.generateExpression(arg as Expression, params);
        const intTemp = this.ctx.nextTemp();
        this.ctx.emit(`${intTemp} = fptosi double ${exprResult} to i32`);
        this.ctx.emit(`call void @exit(i32 ${intTemp})`);
      } else {
        const exprResult = this.ctx.generateExpression(arg as Expression, params);
        const intTemp = this.ctx.nextTemp();
        this.ctx.emit(`${intTemp} = fptosi double ${exprResult} to i32`);
        this.ctx.emit(`call void @exit(i32 ${intTemp})`);
      }
    } else {
      this.ctx.emit(`call void @exit(i32 0)`);
    }
    return '0';
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
    const objBase = expr.object as { type: string };
    const method = expr.method;

    // Handle Promise static methods (Promise.resolve, Promise.reject, Promise.all)
    if (this.isVariableWithName(expr.object, 'Promise')) {
      return this.handlePromiseStaticMethods(expr, params);
    }

    // Handle Array.from() - returns the argument as-is since our iterators already produce arrays
    if (this.isVariableWithName(expr.object, 'Array') && method === 'from') {
      if (expr.args.length === 0) {
        throw new Error('Array.from() requires at least 1 argument');
      }
      return this.ctx.generateExpression(expr.args[0], params);
    }

    // Handle Promise instance methods (.then, .catch)
    if (method === 'then' || method === 'catch') {
      const isPromise = this.isPromiseExpression(expr.object);
      if (isPromise) {
        return this.handlePromiseThen(expr, params, method === 'catch');
      }
    }

    // Handle console.log and console.error - inline check to avoid cross-class property access
    const objBase2 = expr.object as ExprBase;
    if (objBase2.type === 'variable') {
      const varNode = expr.object as VariableNode;
      if (varNode.name === 'console') {
        const method2 = expr.method;
        if (method2 === 'log' || method2 === 'error' || method2 === 'warn' || method2 === 'debug') {
          return this.generateConsoleCallInline(expr, params);
        }
      }
    }

    // Handle process.exit() - inline check
    if (objBase2.type === 'variable') {
      const varNode = expr.object as VariableNode;
      if (varNode.name === 'process' && expr.method === 'exit') {
        return this.generateProcessExitInline(expr, params);
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

    // Handle execSync() from child_process
    if (method === 'execSync') {
      const objName = this.getVariableName(expr.object);
      if (objName === 'child_process' || objName === 'cp') {
        return this.handleExecSync(expr, params);
      }
    }

    // Handle JSON.parse() and JSON.stringify() - inline check
    if (objBase2.type === 'variable' && (expr.object as VariableNode).name === 'JSON') {
      if (method === 'parse') {
        return this.ctx.jsonGenGenerateParse(expr, params);
      } else if (method === 'stringify') {
        return this.ctx.jsonGenGenerateStringify(expr, params);
      }
    }

    // Handle Math.* methods (delegated to MathGenerator)
    if (this.ctx.mathGenCanHandle(expr)) {
      return this.ctx.mathGenGenerateMathMethod(expr, params);
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

    // Handle Response methods (from fetch())
    if (method === 'text' || method === 'json') {
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
          if (expr.typeParameter) {
            const typeName = expr.typeParameter;
            const interfaceDefResult = this.getInterfaceFromAST(typeName);
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

    // Handle string methods
    if (method === 'substr') {
      return this.handleSubstr(expr, params);
    }
    if (method === 'substring') {
      return this.handleSubstring(expr, params);
    }
    if (method === 'concat' && !this.ctx.isArrayExpression(expr.object) && !this.ctx.isStringArrayExpression(expr.object) && !this.ctx.isObjectArrayExpression(expr.object)) {
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
    if (method === 'endsWith') {
      return this.handleEndsWith(expr, params);
    }
    if (method === 'trim') {
      return this.handleTrim(expr, params);
    }
    if (method === 'indexOf') {
      if (this.ctx.isStringArrayExpression(expr.object)) {
        return this.handleStringArrayIndexOf(expr, params);
      }
      return this.handleIndexOf(expr, params);
    }
    if (method === 'includes' && !this.ctx.isArrayExpression(expr.object) && !this.ctx.isStringArrayExpression(expr.object)) {
      return this.handleStringIncludes(expr, params);
    }
    if (method === 'slice' && !this.ctx.isArrayExpression(expr.object) && !this.ctx.isStringArrayExpression(expr.object) && !this.ctx.isObjectArrayExpression(expr.object)) {
      return this.handleSlice(expr, params);
    }
    if (method === 'replace') {
      return this.handleReplace(expr, params);
    }
    if (method === 'charAt') {
      return this.handleCharAt(expr, params);
    }
    if (method === 'charCodeAt') {
      return this.handleCharCodeAt(expr, params);
    }
    if (method === 'toUpperCase') {
      return this.handleToUpperCase(expr, params);
    }
    if (method === 'toLowerCase') {
      return this.handleToLowerCase(expr, params);
    }
    if (method === 'match') {
      return this.handleMatch(expr, params);
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
    } else if (method === 'join') {
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
    } else if (method === 'slice' && (this.ctx.isArrayExpression(expr.object) || this.ctx.isStringArrayExpression(expr.object) || this.ctx.isObjectArrayExpression(expr.object))) {
      return this.ctx.arrayGenGenerateArraySlice(expr, params);
    } else if (method === 'concat' && (this.ctx.isArrayExpression(expr.object) || this.ctx.isStringArrayExpression(expr.object) || this.ctx.isObjectArrayExpression(expr.object))) {
      return this.ctx.arrayGenGenerateArrayConcat(expr, params);
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
    const exprObjBase = expr.object as ExprBase;
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

  private handleSubstr(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length < 1 || expr.args.length > 2) {
      throw new Error(`substr() expects 1 or 2 arguments, got ${expr.args.length}`);
    }

    const startIndexDouble = this.ctx.generateExpression(expr.args[0], params);
    const startIndex = this.convertToI32(startIndexDouble);
    const length = expr.args.length === 2 ? this.convertToI32(this.ctx.generateExpression(expr.args[1], params)) : null;

    return this.ctx.stringGenGenerateSubstr(strPtr, startIndex, length);
  }

  private handleSubstring(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length < 1 || expr.args.length > 2) {
      throw new Error(`substring() expects 1 or 2 arguments, got ${expr.args.length}`);
    }

    const startIndexDouble = this.ctx.generateExpression(expr.args[0], params);
    const startIndex = this.convertToI32(startIndexDouble);

    let length: string | null = null;
    if (expr.args.length === 2) {
      const endIndexDouble = this.ctx.generateExpression(expr.args[1], params);
      const endIndex = this.convertToI32(endIndexDouble);
      length = this.nextTemp();
      this.emit(`${length} = sub i32 ${endIndex}, ${startIndex}`);
    }

    return this.ctx.stringGenGenerateSubstr(strPtr, startIndex, length);
  }

  private handleConcat(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    const ptrType = this.ctx.getVariableType(strPtr);
    if (ptrType && (ptrType === '%Array*' || ptrType === '%StringArray*' || ptrType === '%ObjectArray*' || ptrType.endsWith('Array*'))) {
      const exprObjBase = expr.object as ExprBase;
      let details = `Expression type: ${exprObjBase.type}`;
      if (exprObjBase.type === 'member_access') {
        const memberExpr = expr.object as MemberAccessNode;
        const objBase = memberExpr.object as ExprBase;
        details += `, property: ${memberExpr.property}`;
        details += `, object base type: ${objBase.type}`;
        if (objBase.type === 'variable') {
          const varName = (memberExpr.object as VariableNode).name;
          const isClass = this.ctx.symbolTableIsClass(varName);
          const symbolType = this.ctx.symbolTableGetType(varName);
          const interfaceType = this.ctx.symbolTableGetInterfaceType(varName);
          details += `, variable: ${varName}, isClass: ${isClass}`;
          details += `, symbolType: ${symbolType}, interfaceType: ${interfaceType}`;
          if (isClass) {
            const className = this.ctx.symbolTableGetClassName(varName);
            details += `, className: ${className}`;
          }
        }
      }
      throw new Error(
        `concat() was dispatched to string handler but received an array type '${ptrType}'.\n` +
        `  This indicates isArrayExpression/isStringArrayExpression/isObjectArrayExpression failed to detect the array.\n` +
        `  ${details}\n` +
        `  Check type tracking for this expression.`
      );
    }

    if (expr.args.length < 1) {
      throw new Error(`concat() expects at least 1 argument, got ${expr.args.length}`);
    }

    let result = strPtr;
    for (let _mci = 0; _mci < expr.args.length; _mci++) {
      const arg = expr.args[_mci];
      const argStr = this.ctx.generateExpression(arg, params);
      result = this.ctx.stringGenGenerateStringConcatDirect(result, argStr);
    }

    return result;
  }

  private handleRepeat(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length !== 1) {
      throw new Error(`repeat() expects 1 argument, got ${expr.args.length}`);
    }

    const countDouble = this.ctx.generateExpression(expr.args[0], params);
    const count = this.convertToI32(countDouble);
    return this.ctx.stringGenGenerateRepeat(strPtr, count);
  }

  private handlePadStart(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length < 1 || expr.args.length > 2) {
      throw new Error(`padStart() expects 1 or 2 arguments, got ${expr.args.length}`);
    }

    const targetLengthDouble = this.ctx.generateExpression(expr.args[0], params);
    const targetLength = this.convertToI32(targetLengthDouble);
    const padString = expr.args.length === 2
      ? this.ctx.generateExpression(expr.args[1], params)
      : this.ctx.stringGenCreateStringConstant(' ');

    return this.ctx.stringGenGeneratePadStart(strPtr, targetLength, padString);
  }

  private handleSplit(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length !== 1) {
      throw new Error(`split() expects 1 argument, got ${expr.args.length}`);
    }

    const delimiter = this.ctx.generateExpression(expr.args[0], params);
    return this.ctx.stringGenGenerateSplit(strPtr, delimiter);
  }

  private handleStartsWith(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length !== 1) {
      throw new Error(`startsWith() expects 1 argument, got ${expr.args.length}`);
    }

    const prefix = this.ctx.generateExpression(expr.args[0], params);
    return this.ctx.stringGenGenerateStartsWith(strPtr, prefix);
  }

  private handleEndsWith(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length !== 1) {
      throw new Error(`endsWith() expects 1 argument, got ${expr.args.length}`);
    }

    const suffix = this.ctx.generateExpression(expr.args[0], params);
    return this.ctx.stringGenGenerateEndsWith(strPtr, suffix);
  }

  private handleTrim(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length !== 0) {
      throw new Error(`trim() expects 0 arguments, got ${expr.args.length}`);
    }

    return this.ctx.stringGenGenerateTrim(strPtr);
  }

  private handleIndexOf(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length !== 1) {
      throw new Error(`indexOf() expects 1 argument, got ${expr.args.length}`);
    }

    const substring = this.ctx.generateExpression(expr.args[0], params);
    return this.ctx.stringGenGenerateIndexOf(strPtr, substring);
  }

  private handleStringArrayIndexOf(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const arrayPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length !== 1) {
      throw new Error(`indexOf() expects 1 argument, got ${expr.args.length}`);
    }

    const searchValue = this.ctx.generateExpression(expr.args[0], params);

    const checkLabel = this.ctx.nextLabel('indexof_check');
    const bodyLabel = this.ctx.nextLabel('indexof_body');
    const foundLabel = this.ctx.nextLabel('indexof_found');
    const notfoundLabel = this.ctx.nextLabel('indexof_notfound');
    const endLabel = this.ctx.nextLabel('indexof_end');

    const arrIsNull = this.ctx.nextTemp();
    this.ctx.emit(`${arrIsNull} = icmp eq %StringArray* ${arrayPtr}, null`);
    this.ctx.emit(`br i1 ${arrIsNull}, label %${notfoundLabel}, label %${checkLabel}_arrvalid`);

    this.ctx.emit(`${checkLabel}_arrvalid:`);
    const lenPtr = this.ctx.nextTemp();
    this.ctx.emit(`${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`);
    const length = this.ctx.nextTemp();
    this.ctx.emit(`${length} = load i32, i32* ${lenPtr}`);

    const dataPtrField = this.ctx.nextTemp();
    this.ctx.emit(`${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.ctx.nextTemp();
    this.ctx.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField}`);

    const dataPtrIsNull = this.ctx.nextTemp();
    this.ctx.emit(`${dataPtrIsNull} = icmp eq i8** ${dataPtr}, null`);
    this.ctx.emit(`br i1 ${dataPtrIsNull}, label %${notfoundLabel}, label %${checkLabel}_start`);

    this.ctx.emit(`${checkLabel}_start:`);
    const counterPtr = this.ctx.nextTemp();
    this.ctx.emit(`${counterPtr} = alloca i32`);
    this.ctx.emit(`store i32 0, i32* ${counterPtr}`);

    this.ctx.emit(`br label %${checkLabel}`);

    this.ctx.emit(`${checkLabel}:`);
    const counter = this.ctx.nextTemp();
    this.ctx.emit(`${counter} = load i32, i32* ${counterPtr}`);
    const cond = this.ctx.nextTemp();
    this.ctx.emit(`${cond} = icmp slt i32 ${counter}, ${length}`);
    this.ctx.emit(`br i1 ${cond}, label %${bodyLabel}, label %${notfoundLabel}`);

    this.ctx.emit(`${bodyLabel}:`);
    const counter64 = this.ctx.nextTemp();
    this.ctx.emit(`${counter64} = sext i32 ${counter} to i64`);
    const elemPtr = this.ctx.nextTemp();
    this.ctx.emit(`${elemPtr} = getelementptr i8*, i8** ${dataPtr}, i64 ${counter64}`);
    const elem = this.ctx.nextTemp();
    this.ctx.emit(`${elem} = load i8*, i8** ${elemPtr}`);

    const elemIsNull = this.ctx.nextTemp();
    this.ctx.emit(`${elemIsNull} = icmp eq i8* ${elem}, null`);
    this.ctx.emit(`br i1 ${elemIsNull}, label %${checkLabel}_next, label %${checkLabel}_cmp`);

    this.ctx.emit(`${checkLabel}_cmp:`);
    const cmpResult = this.ctx.nextTemp();
    this.ctx.emit(`${cmpResult} = call i32 @strcmp(i8* ${elem}, i8* ${searchValue})`);
    const isMatch = this.ctx.nextTemp();
    this.ctx.emit(`${isMatch} = icmp eq i32 ${cmpResult}, 0`);
    this.ctx.emit(`br i1 ${isMatch}, label %${foundLabel}, label %${checkLabel}_next`);

    this.ctx.emit(`${checkLabel}_next:`);
    const nextCounter = this.ctx.nextTemp();
    this.ctx.emit(`${nextCounter} = add i32 ${counter}, 1`);
    this.ctx.emit(`store i32 ${nextCounter}, i32* ${counterPtr}`);
    this.ctx.emit(`br label %${checkLabel}`);

    this.ctx.emit(`${foundLabel}:`);
    const foundIndex = this.ctx.nextTemp();
    this.ctx.emit(`${foundIndex} = load i32, i32* ${counterPtr}`);
    this.ctx.emit(`br label %${endLabel}`);

    this.ctx.emit(`${notfoundLabel}:`);
    this.ctx.emit(`br label %${endLabel}`);

    this.ctx.emit(`${endLabel}:`);
    const resultI32 = this.ctx.nextTemp();
    this.ctx.emit(`${resultI32} = phi i32 [ ${foundIndex}, %${foundLabel} ], [ -1, %${notfoundLabel} ]`);

    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = sitofp i32 ${resultI32} to double`);
    this.ctx.setVariableType(result, 'double');
    return result;
  }

  private handleStringIncludes(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    const ptrType = this.ctx.getVariableType(strPtr);
    if (ptrType && (ptrType === '%Array*' || ptrType === '%StringArray*' || ptrType === '%ObjectArray*' || ptrType.endsWith('Array*'))) {
      throw new Error(
        `includes() was dispatched to string handler but received an array type '${ptrType}'.\n` +
        `  This indicates isArrayExpression/isStringArrayExpression failed to detect the array.\n` +
        `  Expression type: ${expr.object.type}\n` +
        `  Check type tracking for this expression.`
      );
    }

    if (!ptrType || ptrType === 'unknown') {
      const exprObjBase = expr.object as ExprBase;
      let details = `Expression type: ${exprObjBase.type}`;
      if (exprObjBase.type === 'variable') {
        details += `, variable: ${(expr.object as VariableNode).name}`;
      } else if (exprObjBase.type === 'method_call') {
        const mc = expr.object as MethodCallNode;
        details += `, method: ${mc.method}`;
      }
      throw new Error(
        `includes() called on expression with unknown type.\n` +
        `  Result register: ${strPtr}, type: ${ptrType || 'undefined'}\n` +
        `  ${details}\n` +
        `  If this is an array, isArrayExpression/isStringArrayExpression is not detecting it.\n` +
        `  Fix type tracking to ensure proper dispatch.`
      );
    }

    if (expr.args.length !== 1) {
      throw new Error(`includes() expects 1 argument, got ${expr.args.length}`);
    }

    const substring = this.ctx.generateExpression(expr.args[0], params);
    return this.ctx.stringGenGenerateIncludes(strPtr, substring);
  }

  private handleSlice(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    const ptrType = this.ctx.getVariableType(strPtr);
    if (ptrType && (ptrType === '%Array*' || ptrType === '%StringArray*' || ptrType === '%ObjectArray*' || ptrType.endsWith('Array*'))) {
      throw new Error(
        `slice() was dispatched to string handler but received an array type '${ptrType}'.\n` +
        `  This indicates isArrayExpression/isStringArrayExpression/isObjectArrayExpression failed to detect the array.\n` +
        `  Expression type: ${expr.object.type}\n` +
        `  Check type tracking for this expression.`
      );
    }

    if (!ptrType || ptrType === 'unknown') {
      const exprObjBase = expr.object as ExprBase;
      let details = `Expression type: ${exprObjBase.type}`;
      if (exprObjBase.type === 'variable') {
        details += `, variable: ${(expr.object as VariableNode).name}`;
      } else if (exprObjBase.type === 'method_call') {
        const mc = expr.object as MethodCallNode;
        details += `, method: ${mc.method}`;
      }
      throw new Error(
        `slice() called on expression with unknown type.\n` +
        `  Result register: ${strPtr}, type: ${ptrType || 'undefined'}\n` +
        `  ${details}\n` +
        `  If this is an array, isArrayExpression/isStringArrayExpression/isObjectArrayExpression is not detecting it.\n` +
        `  Fix type tracking to ensure proper dispatch.`
      );
    }

    if (expr.args.length < 1 || expr.args.length > 2) {
      throw new Error(`slice() expects 1 or 2 arguments, got ${expr.args.length}`);
    }

    const startDouble = this.ctx.generateExpression(expr.args[0], params);
    const startI32 = this.nextTemp();
    this.emit(`${startI32} = fptosi double ${startDouble} to i32`);

    let endI32: string | null = null;
    if (expr.args.length === 2) {
      const endDouble = this.ctx.generateExpression(expr.args[1], params);
      endI32 = this.nextTemp();
      this.emit(`${endI32} = fptosi double ${endDouble} to i32`);
    }

    return this.ctx.stringGenGenerateSlice(strPtr, startI32, endI32);
  }

  private handleReplace(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length !== 2) {
      throw new Error(`replace() expects 2 arguments, got ${expr.args.length}`);
    }

    const searchArg = expr.args[0];
    const replaceArg = expr.args[1];

    if (searchArg.type === 'regex') {
      const regexNode = searchArg as { pattern: string; flags: string };
      const isGlobal = regexNode.flags.indexOf('g') !== -1;
      const searchStr = this.ctx.stringGenGenerateGlobalString(regexNode.pattern);
      const replaceStr = this.ctx.generateExpression(replaceArg, params);
      if (isGlobal) {
        return this.ctx.stringGenGenerateReplaceAll(strPtr, searchStr, replaceStr);
      } else {
        return this.ctx.stringGenGenerateReplace(strPtr, searchStr, replaceStr);
      }
    }

    const searchStr = this.ctx.generateExpression(searchArg, params);
    const replaceStr = this.ctx.generateExpression(replaceArg, params);
    return this.ctx.stringGenGenerateReplace(strPtr, searchStr, replaceStr);
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
    return this.ctx.stringGenGenerateCharAt(strPtr, indexI32);
  }

  private handleCharCodeAt(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length !== 1) {
      throw new Error('charCodeAt() expects 1 argument, got ' + expr.args.length);
    }

    const indexDouble = this.ctx.generateExpression(expr.args[0], params);
    const indexI32 = this.ctx.nextTemp();
    this.ctx.emit(indexI32 + ' = fptosi double ' + indexDouble + ' to i32');
    return this.ctx.stringGenGenerateCharCodeAt(strPtr, indexI32);
  }

  private handleToUpperCase(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);
    return this.ctx.stringGenGenerateToUpperCase(strPtr);
  }

  private handleToLowerCase(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);
    return this.ctx.stringGenGenerateToLowerCase(strPtr);
  }

  private handleMatch(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length !== 1) {
      throw new Error('match() expects 1 argument (a regex), got ' + expr.args.length);
    }

    const regexArg = expr.args[0];
    if (regexArg.type !== 'regex') {
      throw new Error('match() expects a regex literal argument');
    }

    const regexNode = regexArg as RegexNode;
    const pattern = regexNode.pattern;
    const flags = regexNode.flags || '';

    let numGroups = 0;
    for (let gi = 0; gi < pattern.length; gi++) {
      if (pattern[gi] === '(') {
        numGroups = numGroups + 1;
      }
    }

    const regexPtr = this.ctx.regexGenGenerateRegexCompile(pattern, flags);
    const result = this.ctx.regexGenGenerateRegexMatch(regexPtr, strPtr, numGroups);

    return result;
  }

  private handleClassMethods(expr: MethodCallNode, params: string[]): string | null {
    const method = expr.method;
    let className: string | null = null;
    let instancePtr: string | null = null;

    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type === 'variable') {
      const varName = (expr.object as VariableNode).name;
      if (this.ctx.symbolTableIsClass(varName)) {
        const classMeta = this.ctx.symbolTableGetClassInfo(varName)!;
        className = classMeta.className;
        instancePtr = this.ctx.generateExpression(expr.object, params);
      } else {
        const concreteClass = this.ctx.symbolTableGetConcreteClass(varName);
        if (concreteClass) {
          instancePtr = this.ctx.generateExpression(expr.object, params);
          className = concreteClass;
        } else {
          const interfaceType = this.ctx.symbolTableGetInterfaceType(varName);
          if (interfaceType) {
            const implClass = this.findClassImplementingInterfaceMethod(interfaceType, method);
            if (implClass) {
              instancePtr = this.ctx.generateExpression(expr.object, params);
              className = implClass;
            }
          }
        }
      }
    } else if (exprObjBase.type === 'new') {
      const newExpr = expr.object as NewNode;
      className = newExpr.className;
      instancePtr = this.ctx.generateExpression(expr.object, params);
    } else if (exprObjBase.type === 'this') {
      const thisPtr = this.ctx.getThisPointer();
      if (!thisPtr) {
        throw new Error(`this.${method}() called outside of class method`);
      }
      instancePtr = thisPtr;
      if (this.ctx.getCurrentClassName()) {
        className = this.ctx.getCurrentClassName();
      } else {
        const classesLen5 = this.ctx.getAstClassesLength();
        if (classesLen5 === 0) {
          throw new Error(`Method ${method} not found in any class - no AST`);
        }
        let classWithMethodResult: ClassNode | null = null;
        for (let ci = 0; ci < classesLen5; ci++) {
          const c = this.ctx.getAstClassAt(ci);
          if (!c) continue;
          let hasMethod = false;
          for (let mi = 0; mi < c.methods.length; mi++) {
            const m = c.methods[mi];
            if (m.name === method && !m.isConstructor) { hasMethod = true; break; }
          }
          if (hasMethod) { classWithMethodResult = c; break; }
        }
        const classWithMethod = classWithMethodResult as ClassNode;
        if (!classWithMethodResult) {
          throw new Error(`Method ${method} not found in any class`);
        }
        className = classWithMethod.name;
      }
    } else if (exprObjBase.type === 'member_access') {
      const memberAccess = expr.object as MemberAccessNode;
      const memberAccessObjBase = memberAccess.object as ExprBase;
      const classNameForField = this.ctx.getCurrentClassName();
      if (memberAccessObjBase.type === 'this' && classNameForField) {
        const fieldInfoResult = this.ctx.classGenGetFieldInfo(classNameForField, memberAccess.property);
        const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
        if (fieldInfoResult && fieldInfo.tsType) {
          const fieldClassName = fieldInfo.tsType;
          let classExists = false;
          const classesLen = this.ctx.getAstClassesLength();
          for (let ci = 0; ci < classesLen; ci++) {
            const cName = this.ctx.getAstClassNameAt(ci);
            if (cName === fieldClassName) { classExists = true; break; }
          }
          if (classExists) {
            instancePtr = this.ctx.generateExpression(expr.object, params);
            className = fieldClassName;
          } else {
            let interfaceExists = false;
            const interfacesLen = this.ctx.getAstInterfacesLength();
            for (let ii = 0; ii < interfacesLen; ii++) {
              const ifaceName = this.ctx.getAstInterfaceNameAt(ii);
              if (ifaceName === fieldClassName) { interfaceExists = true; break; }
            }
            if (interfaceExists) {
              const implClass = this.findClassImplementingInterfaceMethod(fieldClassName, method);
              if (implClass) {
                instancePtr = this.ctx.generateExpression(expr.object, params);
                className = implClass;
              } else {
              }
            } else {
            }
          }
        }
      } else if (memberAccessObjBase.type === 'variable') {
        const varName = (memberAccess.object as VariableNode).name;
        const concreteClass = this.ctx.symbolTableGetConcreteClass(varName) || this.ctx.getActualClassType(varName);
        if (concreteClass) {
          const fieldInfoResult = this.ctx.classGenGetFieldInfo(concreteClass, memberAccess.property);
          const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
          if (fieldInfoResult && fieldInfo.tsType) {
            const fieldClassName = fieldInfo.tsType;
            const resolvedClass = this.findClassWithMethod(fieldClassName, method);
            if (resolvedClass) {
              instancePtr = this.ctx.generateExpression(expr.object, params);
              className = resolvedClass;
            } else {
              const implClass = this.findClassImplementingInterfaceMethod(fieldClassName, method);
              if (implClass) {
                instancePtr = this.ctx.generateExpression(expr.object, params);
                className = implClass;
              }
            }
          }
        } else if (this.ctx.symbolTableIsClass(varName)) {
          const classMeta = this.ctx.symbolTableGetClassInfo(varName)!;
          const outerClassName = classMeta.className;
          const fieldInfoResult = this.ctx.classGenGetFieldInfo(outerClassName, memberAccess.property);
          const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
          if (fieldInfoResult && fieldInfo.tsType) {
            const fieldClassName = fieldInfo.tsType;
            let classExists = false;
            const classesLen2 = this.ctx.getAstClassesLength();
            for (let ci = 0; ci < classesLen2; ci++) {
              const cName = this.ctx.getAstClassNameAt(ci);
              if (cName === fieldClassName) { classExists = true; break; }
            }
            if (classExists) {
              instancePtr = this.ctx.generateExpression(expr.object, params);
              className = fieldClassName;
            } else {
              let interfaceExists = false;
              const interfacesLen2 = this.ctx.getAstInterfacesLength();
              for (let ii = 0; ii < interfacesLen2; ii++) {
                const ifaceName = this.ctx.getAstInterfaceNameAt(ii);
                if (ifaceName === fieldClassName) { interfaceExists = true; break; }
              }
              if (interfaceExists) {
                const implClass = this.findClassImplementingInterfaceMethod(fieldClassName, method);
                if (implClass) {
                  instancePtr = this.ctx.generateExpression(expr.object, params);
                  className = implClass;
                }
              }
            }
          }
        }
      } else if (memberAccessObjBase.type === 'member_access') {
        const resolvedType = this.resolveNestedMemberAccessType(expr.object);
        if (resolvedType) {
          instancePtr = this.ctx.generateExpression(expr.object, params);
          className = resolvedType;
        }
      }
    } else if (exprObjBase.type === 'super') {
      const thisPtr = this.ctx.getThisPointer();
      if (!thisPtr) {
        throw new Error('super.method() called outside of class method');
      }
      if (!this.ctx.getCurrentClassName()) {
        throw new Error('super.method() called outside of class context');
      }
      let currentClassResult: ClassNode | null = null;
      const classesLen6 = this.ctx.getAstClassesLength();
      for (let ci = 0; ci < classesLen6; ci++) {
        const cName = this.ctx.getAstClassNameAt(ci);
        if (cName === this.ctx.getCurrentClassName()) {
          currentClassResult = this.ctx.getAstClassAt(ci);
          break;
        }
      }
      const currentClass = currentClassResult as ClassNode;
      if (!currentClassResult || !currentClass.extends) {
        throw new Error(`super.method() called but current class ${this.ctx.getCurrentClassName()} has no parent class`);
      }
      instancePtr = thisPtr;
      className = currentClass.extends;

      if (method === '') {
        return '0';
      }
    } else if (exprObjBase.type === 'type_assertion') {
      const assertExpr = expr.object as TypeAssertionNode;
      const innerExpr = assertExpr.expression;
      const innerExprBase = innerExpr as ExprBase;
      if (innerExprBase.type === 'variable') {
        const varName = (innerExpr as VariableNode).name;
        if (this.ctx.symbolTableIsClass(varName)) {
          const classMeta = this.ctx.symbolTableGetClassInfo(varName)!;
          className = classMeta.className;
          instancePtr = this.ctx.generateExpression(innerExpr, params);
        }
      }
    }

    if (className && instancePtr) {
      let resolvedClass = this.findClassWithMethod(className, method);
      let isInterfaceClass = false;
      if (!resolvedClass) {
        let interfaceExists = false;
        const interfacesLen5 = this.ctx.getAstInterfacesLength();
        for (let ii = 0; ii < interfacesLen5; ii++) {
          const ifaceName = this.ctx.getAstInterfaceNameAt(ii);
          if (ifaceName === className) { interfaceExists = true; break; }
        }
        if (interfaceExists) {
          isInterfaceClass = true;
          resolvedClass = this.findClassImplementingInterfaceMethod(className, method);
        }
      }
      if (!resolvedClass) {
        throw new Error(`Method ${method} not found in class ${className}`);
      }

      this.ctx.syncStateToGenerators();
      const instanceClass = isInterfaceClass ? resolvedClass : className;
      return this.ctx.classGenGenerateMethodCall(instancePtr, instanceClass, method, expr.args, params);
    }

    if (!className && !instancePtr && exprObjBase.type === 'member_access') {
      instancePtr = this.ctx.generateExpression(expr.object, params);
      if (instancePtr) {
        const actualClass = this.ctx.getActualClassType(instancePtr);
        if (actualClass) {
          className = actualClass;
          const resolvedClass = this.findClassWithMethod(actualClass, method);
          if (resolvedClass) {
            this.ctx.syncStateToGenerators();
            return this.ctx.classGenGenerateMethodCall(instancePtr, resolvedClass, method, expr.args, params);
          }
        }
      }
    }

    return null;
  }

  private findClassWithMethod(className: string, methodName: string): string | null {
    let classNodeResult: ClassNode | null = null;
    const classesLen7 = this.ctx.getAstClassesLength();
    for (let ci = 0; ci < classesLen7; ci++) {
      const cName = this.ctx.getAstClassNameAt(ci);
      if (cName === className) {
        classNodeResult = this.ctx.getAstClassAt(ci);
        break;
      }
    }
    const classNode = classNodeResult as ClassNode;
    if (!classNodeResult) return null;

    let methodExists = false;
    for (let mi = 0; mi < classNode.methods.length; mi++) {
      const m = classNode.methods[mi];
      if (m.name === methodName && !m.isConstructor) { methodExists = true; break; }
    }
    if (methodExists) return className;

    if (classNode.extends) {
      return this.findClassWithMethod(classNode.extends, methodName);
    }

    return null;
  }

  private findClassImplementingInterfaceMethod(interfaceName: string, methodName: string): string | null {
    const classesLen8 = this.ctx.getAstClassesLength();
    for (let i = 0; i < classesLen8; i++) {
      const cls = this.ctx.getAstClassAt(i);
      if (!cls) continue;
      if (!this.classImplementsInterface(cls.name, interfaceName)) {
        continue;
      }
      let hasMethod = false;
      for (let mi = 0; mi < cls.methods.length; mi++) {
        const m = cls.methods[mi];
        if (m.name === methodName && !m.isConstructor) { hasMethod = true; break; }
      }
      if (hasMethod) {
        return cls.name;
      }
      if (cls.extends) {
        const parentHasMethod = this.findClassWithMethod(cls.extends, methodName);
        if (parentHasMethod) {
          return cls.name;
        }
      }
    }
    const structuralMatch = this.findClassStructurallyMatchingInterface(interfaceName, methodName);
    if (structuralMatch) {
      return structuralMatch;
    }
    return null;
  }

  private findClassStructurallyMatchingInterface(interfaceName: string, methodName: string): string | null {
    const allMethods = this.getAllInterfaceMethods(interfaceName);
    if (allMethods.length === 0) {
      const primaryClass = this.findPrimaryImplementingClass(methodName);
      if (primaryClass) {
        return primaryClass;
      }
      return null;
    }
    const classesLen9 = this.ctx.getAstClassesLength();
    for (let ci = 0; ci < classesLen9; ci++) {
      const clsName = this.ctx.getAstClassNameAt(ci);
      if (!clsName) continue;
      if (this.classHasAllMethods(clsName, allMethods)) {
        const hasTargetMethod = this.findClassWithMethod(clsName, methodName);
        if (hasTargetMethod) {
          return clsName;
        }
      }
    }
    return null;
  }

  private getAllInterfaceMethods(interfaceName: string): string[] {
    const visited: string[] = [];
    const methods: string[] = [];
    this.collectInterfaceMethods(interfaceName, methods, visited);
    return methods;
  }

  private collectInterfaceMethods(interfaceName: string, methods: string[], visited: string[]): void {
    for (let v = 0; v < visited.length; v++) {
      if (visited[v] === interfaceName) return;
    }
    visited.push(interfaceName);

    let bestInterface: { name: string; extends?: string[]; fields: { name: string; type: string }[]; methods?: { name: string }[] } | null = null;
    let maxMethods = 0;
    const interfacesLen4 = this.ctx.getAstInterfacesLength();
    for (let i = 0; i < interfacesLen4; i++) {
      const ifaceName = this.ctx.getAstInterfaceNameAt(i);
      if (ifaceName === interfaceName) {
        const iface = this.ctx.getAstInterfaceAt(i);
        if (!iface) continue;
        const methodCount = iface.methods ? iface.methods.length : 0;
        if (methodCount > maxMethods || !bestInterface) {
          maxMethods = methodCount;
          bestInterface = iface;
        }
      }
    }
    if (!bestInterface) return;

    if (bestInterface.methods) {
      for (let i = 0; i < bestInterface.methods.length; i++) {
        const methodName = bestInterface.methods[i].name;
        let alreadyHas = false;
        for (let m = 0; m < methods.length; m++) {
          if (methods[m] === methodName) { alreadyHas = true; break; }
        }
        if (!alreadyHas) {
          methods.push(methodName);
        }
      }
    }

    if (bestInterface.extends) {
      for (let i = 0; i < bestInterface.extends.length; i++) {
        this.collectInterfaceMethods(bestInterface.extends[i], methods, visited);
      }
    }
  }

  private findPrimaryImplementingClass(methodName: string): string | null {
    const classesLen10 = this.ctx.getAstClassesLength();
    for (let ci = 0; ci < classesLen10; ci++) {
      const cls = this.ctx.getAstClassAt(ci);
      if (!cls) continue;
      if (cls.implements && cls.implements.length > 0) {
        const hasMethod = this.findClassWithMethod(cls.name, methodName);
        if (hasMethod) {
          return hasMethod;
        }
      }
    }
    for (let ci = 0; ci < classesLen10; ci++) {
      const clsName = this.ctx.getAstClassNameAt(ci);
      if (!clsName) continue;
      const hasMethod = this.findClassWithMethod(clsName, methodName);
      if (hasMethod) {
        return hasMethod;
      }
    }
    return null;
  }

  private classHasAllMethods(className: string, methods: string[]): boolean {
    for (let i = 0; i < methods.length; i++) {
      if (!this.findClassWithMethod(className, methods[i])) {
        return false;
      }
    }
    return true;
  }

  private classImplementsInterface(className: string, interfaceName: string): boolean {
    const classesLen11 = this.ctx.getAstClassesLength();
    for (let i = 0; i < classesLen11; i++) {
      const cName = this.ctx.getAstClassNameAt(i);
      if (cName === className) {
        const cls = this.ctx.getAstClassAt(i);
        if (!cls) return false;
        if (cls.implements) {
          for (let j = 0; j < cls.implements.length; j++) {
            if (cls.implements[j] === interfaceName) {
              return true;
            }
          }
        }
        if (cls.extends) {
          return this.classImplementsInterface(cls.extends, interfaceName);
        }
        return false;
      }
    }
    return false;
  }

  private resolveNestedMemberAccessType(expr: Expression): string | null {
    const e = expr as ExprBase;
    if (e.type === 'this') {
      return this.ctx.getCurrentClassName();
    }

    if (e.type === 'variable') {
      const varName = (expr as VariableNode).name;
      if (this.ctx.symbolTableIsClass(varName)) {
        const classMeta = this.ctx.symbolTableGetClassInfo(varName);
        return classMeta?.className || null;
      }
      return null;
    }

    if (e.type === 'member_access') {
      const memberAccess = expr as MemberAccessNode;
      const parentType = this.resolveNestedMemberAccessType(memberAccess.object);
      if (!parentType) {
        return null;
      }

      let classExists = false;
      const classesLen3 = this.ctx.getAstClassesLength();
      for (let ci = 0; ci < classesLen3; ci++) {
        const cName = this.ctx.getAstClassNameAt(ci);
        if (cName === parentType) { classExists = true; break; }
      }
      if (classExists) {
        const fieldInfoResult = this.ctx.classGenGetFieldInfo(parentType, memberAccess.property);
        const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
        if (fieldInfoResult && fieldInfo.tsType) {
          let fieldClassExists = false;
          const classesLen4 = this.ctx.getAstClassesLength();
          for (let ci = 0; ci < classesLen4; ci++) {
            const cName = this.ctx.getAstClassNameAt(ci);
            if (cName === fieldInfo.tsType) { fieldClassExists = true; break; }
          }
          if (fieldClassExists) {
            return fieldInfo.tsType;
          }
          let fieldInterfaceExists = false;
          const interfacesLen3 = this.ctx.getAstInterfacesLength();
          for (let ii = 0; ii < interfacesLen3; ii++) {
            const ifaceName = this.ctx.getAstInterfaceNameAt(ii);
            if (ifaceName === fieldInfo.tsType) { fieldInterfaceExists = true; break; }
          }
          if (fieldInterfaceExists) {
            return fieldInfo.tsType;
          }
        }
        return null;
      }

      const interfaceDeclResult = this.getInterfaceDecl(parentType);
      const interfaceDecl = interfaceDeclResult as InterfaceDeclaration;
      if (interfaceDeclResult) {
        let fieldResult: InterfaceField | null = null;
        for (let i = 0; i < interfaceDecl.fields.length; i++) {
          const f = interfaceDecl.fields[i] as { name: string; type: string };
          if (f.name === memberAccess.property) {
            fieldResult = f;
            break;
          }
        }
        const field = fieldResult as { name: string; type: string };
        if (fieldResult) {
          let fieldType = field.type;
          if (fieldType.endsWith(' | null') || fieldType.endsWith(' | undefined')) {
            fieldType = fieldType.replace(/ \| null$/, '').replace(/ \| undefined$/, '');
          }
          let fieldClassExists = false;
          const classesLen12 = this.ctx.getAstClassesLength();
          for (let ci = 0; ci < classesLen12; ci++) {
            const cName = this.ctx.getAstClassNameAt(ci);
            if (cName === fieldType) { fieldClassExists = true; break; }
          }
          if (fieldClassExists) {
            return fieldType;
          }
          let fieldInterfaceExists = false;
          const interfacesLen6 = this.ctx.getAstInterfacesLength();
          for (let ii = 0; ii < interfacesLen6; ii++) {
            const ifaceName = this.ctx.getAstInterfaceNameAt(ii);
            if (ifaceName === fieldType) { fieldInterfaceExists = true; break; }
          }
          if (fieldInterfaceExists) {
            return fieldType;
          }
        }
        return null;
      }

      return null;
    }

    return null;
  }

  private handleObjectMethods(expr: MethodCallNode, params: string[]): string | null {
    const method = expr.method;
    let isObjectMethod = false;

    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type === 'variable') {
      const varName = (expr.object as VariableNode).name;
      if (this.ctx.symbolTableIsObject(varName)) {
        const objMetaRaw = this.ctx.symbolTableGetObjectInfo(varName);
        if (!objMetaRaw) {
          return null;
        }
        const objMeta = objMetaRaw as { ptr: string; keys: string[]; types: string[]; tsTypes: string[] | undefined };
        isObjectMethod = objMeta.keys.indexOf(method) !== -1;
      }
    } else if (exprObjBase.type === 'object') {
      const objExpr = expr.object as ObjectNode;
      for (let pi = 0; pi < objExpr.properties.length; pi++) {
        const p = objExpr.properties[pi] as { key: string };
        if (p.key === method) { isObjectMethod = true; break; }
      }
    }

    if (!isObjectMethod) {
      return null;
    }

    let funcExists = false;
    const funcLen2 = this.ctx.getAstFunctionsLength();
    for (let i = 0; i < funcLen2; i++) {
      const fName = this.ctx.getAstFunctionNameAt(i);
      if (fName === method) {
        funcExists = true;
        break;
      }
    }
    if (!funcExists) {
      throw new Error(`Function ${method} not found for object method call`);
    }

    // Get function type from AST for correct parameter/return types
    let returnType = 'double';
    let paramTypes: string[] = [];

    const funcNode = this.getFunctionFromAST(method);
    if (funcNode) {
      returnType = funcNode.returnType === 'string' ? 'i8*' : 'double';
      if (funcNode.parameters) {
        for (let i = 0; i < funcNode.parameters.length; i++) {
          const param = funcNode.parameters[i];
          paramTypes.push(param.type === 'string' ? 'i8*' : 'double');
        }
      } else if (funcNode.paramTypes) {
        for (let i = 0; i < funcNode.paramTypes.length; i++) {
          const t = funcNode.paramTypes[i];
          paramTypes.push(t === 'string' ? 'i8*' : 'double');
        }
      }
    }

    // Generate arguments
    const argParts: string[] = [];
    for (let i = 0; i < expr.args.length; i++) {
      const arg = expr.args[i];
      const result = this.ctx.generateExpression(arg, params);
      const paramType = paramTypes[i] || 'double';
      argParts.push(paramType + ' ' + result);
    }
    const args = argParts.join(', ');

    const temp = this.nextTemp();
    this.emit(`${temp} = call ${returnType} @${method}(${args})`);
    return temp;
  }

  private isPromiseExpression(expr: Expression): boolean {
    return this.ctx.isPromiseExpression(expr);
  }

  private handlePromiseStaticMethods(expr: MethodCallNode, params: string[]): string {
    const method = expr.method;
    this.ctx.usesPromises = true;

    if (method === 'resolve') {
      let valuePtr: string;
      if (expr.args.length > 0) {
        const value = this.ctx.generateExpression(expr.args[0], params);
        valuePtr = this.nextTemp();
        this.emit(`${valuePtr} = bitcast i8* null to i8*`);
        const valueType = this.ctx.getVariableType(value) || 'double';
        if (valueType === 'i8*') {
          valuePtr = value;
        } else {
          const allocMem = this.nextTemp();
          this.emit(`${allocMem} = call i8* @GC_malloc(i64 8)`);
          const doublePtr = this.nextTemp();
          this.emit(`${doublePtr} = bitcast i8* ${allocMem} to double*`);
          this.emit(`store double ${value}, double* ${doublePtr}`);
          valuePtr = allocMem;
        }
      } else {
        valuePtr = 'null';
      }
      const result = this.nextTemp();
      this.emit(`${result} = call %Promise* @__Promise_resolve_static(i8* ${valuePtr})`);
      this.ctx.setVariableType(result, '%Promise*');
      return result;
    }

    if (method === 'reject') {
      let reasonPtr: string;
      if (expr.args.length > 0) {
        const reason = this.ctx.generateExpression(expr.args[0], params);
        const reasonType = this.ctx.getVariableType(reason) || 'double';
        if (reasonType === 'i8*') {
          reasonPtr = reason;
        } else {
          const allocMem = this.nextTemp();
          this.emit(`${allocMem} = call i8* @GC_malloc(i64 8)`);
          const doublePtr = this.nextTemp();
          this.emit(`${doublePtr} = bitcast i8* ${allocMem} to double*`);
          this.emit(`store double ${reason}, double* ${doublePtr}`);
          reasonPtr = allocMem;
        }
      } else {
        reasonPtr = 'null';
      }
      const result = this.nextTemp();
      this.emit(`${result} = call %Promise* @__Promise_reject_static(i8* ${reasonPtr})`);
      this.ctx.setVariableType(result, '%Promise*');
      return result;
    }

    if (method === 'all') {
      if (expr.args.length < 1) {
        throw new Error('Promise.all() requires 1 argument (array of promises)');
      }
      const promisesArray = this.ctx.generateExpression(expr.args[0], params);
      const result = this.nextTemp();
      this.emit(`${result} = call %Promise* @__Promise_all(%Array* ${promisesArray})`);
      this.ctx.setVariableType(result, '%Promise*');
      return result;
    }

    throw new Error(`Unsupported Promise static method: ${method}`);
  }

  private handlePromiseThen(expr: MethodCallNode, params: string[], isCatch: boolean): string {
    this.ctx.usesPromises = true;
    const promisePtr = this.ctx.generateExpression(expr.object, params);

    let onFulfilled = 'null';
    let onRejected = 'null';

    const promiseCallbackTypes = { paramTypes: ['string', 'any'], returnType: 'void' };
    const scopeVarsResult = this.ctx.symbolTableGetScopeVarsArraysForClosure();
    const scopeVarsTyped = scopeVarsResult as { names: string[]; types: string[] };

    if (isCatch) {
      if (expr.args.length > 0) {
        const callback = expr.args[0] as Expression;
        const callbackBase = callback as ExprBase;
        if (callbackBase.type === 'arrow_function') {
          const callbackName = this.ctx.arrowFunctionGenGenerate(callback as ArrowFunctionNode, params, promiseCallbackTypes, scopeVarsTyped.names, scopeVarsTyped.types);
          onRejected = `@${callbackName}`;
        } else if (callbackBase.type === 'variable') {
          onRejected = `@${(callback as VariableNode).name}`;
        }
      }
    } else {
      if (expr.args.length > 0) {
        const callback = expr.args[0] as Expression;
        const callbackBase = callback as ExprBase;
        if (callbackBase.type === 'arrow_function') {
          const callbackName = this.ctx.arrowFunctionGenGenerate(callback as ArrowFunctionNode, params, promiseCallbackTypes, scopeVarsTyped.names, scopeVarsTyped.types);
          onFulfilled = `@${callbackName}`;
        } else if (callbackBase.type === 'variable') {
          onFulfilled = `@${(callback as VariableNode).name}`;
        }
      }
      if (expr.args.length > 1) {
        const callback = expr.args[1] as Expression;
        const callbackBase = callback as ExprBase;
        if (callbackBase.type === 'arrow_function') {
          const callbackName = this.ctx.arrowFunctionGenGenerate(callback as ArrowFunctionNode, params, promiseCallbackTypes, scopeVarsTyped.names, scopeVarsTyped.types);
          onRejected = `@${callbackName}`;
        } else if (callbackBase.type === 'variable') {
          onRejected = `@${(callback as VariableNode).name}`;
        }
      }
    }

    const onFulfilledPtr = this.nextTemp();
    if (onFulfilled === 'null') {
      this.emit(`${onFulfilledPtr} = bitcast i8* null to void (i8*, i8*)*`);
    } else {
      this.emit(`${onFulfilledPtr} = bitcast void (i8*, i8*)* ${onFulfilled} to void (i8*, i8*)*`);
    }

    const onRejectedPtr = this.nextTemp();
    if (onRejected === 'null') {
      this.emit(`${onRejectedPtr} = bitcast i8* null to void (i8*, i8*)*`);
    } else {
      this.emit(`${onRejectedPtr} = bitcast void (i8*, i8*)* ${onRejected} to void (i8*, i8*)*`);
    }

    const result = this.nextTemp();
    this.emit(`${result} = call %Promise* @__Promise_then(%Promise* ${promisePtr}, void (i8*, i8*)* ${onFulfilledPtr}, void (i8*, i8*)* ${onRejectedPtr})`);
    this.ctx.setVariableType(result, '%Promise*');
    return result;
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
}
