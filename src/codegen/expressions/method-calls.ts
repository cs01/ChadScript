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
  ClassMethod,
  FunctionNode,
  MemberAccessNode,
} from '../../ast/types.js';
import type { SymbolTable } from '../infrastructure/symbol-table.js';
import type { TypeChecker } from '../../typescript/type-checker.js';
import type { TypeResolver } from '../infrastructure/type-resolver/index.js';

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
  generateExistsSync(expr: MethodCallNode, params: string[]): string;
  generateUnlinkSync(expr: MethodCallNode, params: string[]): string;
}

interface PathGeneratorLike {
  generateResolve(expr: MethodCallNode, params: string[]): string;
  generateDirname(expr: MethodCallNode, params: string[]): string;
}

interface JsonGeneratorLike extends SubGenerator {
  generateParse(expr: MethodCallNode, params: string[]): string;
  generateStringify(expr: MethodCallNode, params: string[]): string;
}

interface MathGeneratorLike extends SubGenerator {
  generateMathMethod(expr: MethodCallNode, params: string[]): string;
}

interface StringGeneratorLike {
  createStringConstant(value: string): string;
  generateSubstr(strPtr: string, startIndex: string, length: string | null): string;
  generateStringConcatDirect(left: string, right: string): string;
  generateRepeat(strPtr: string, count: string): string;
  generatePadStart(strPtr: string, targetLength: string, padString: string): string;
  generateSplit(strPtr: string, delimiter: string): string;
  generateStartsWith(strPtr: string, prefix: string): string;
  generateEndsWith(strPtr: string, suffix: string): string;
  generateTrim(strPtr: string): string;
  generateIndexOf(strPtr: string, substring: string): string;
  generateIncludes(strPtr: string, substring: string): string;
  generateSlice(strPtr: string, start: string, end: string | null): string;
  generateCharAt(strPtr: string, index: string): string;
  generateReplace(strPtr: string, search: string, replace: string): string;
  generateReplaceAll(strPtr: string, search: string, replace: string): string;
  generateGlobalString(value: string): string;
}

interface RegexGeneratorLike {
  generateRegexTest(regexPtr: string, testStr: string): string;
}

interface ResponseGeneratorLike {
  generateText(responsePtr: string): string;
  generateJson(responsePtr: string): string;
  generateTypedJson(responsePtr: string, typeName: string, interfaceDef: { properties: { name: string; type: string }[] }): string;
}

interface StringMapGeneratorLike {
  generateStringMapSet(mapAlloca: string, key: string, value: string): string;
  generateStringMapGet(mapAlloca: string, key: string): string;
  generateStringMapHas(mapAlloca: string, key: string): string;
  generateStringMapClear(mapAlloca: string): string;
  generateStringMapDelete(mapAlloca: string, key: string): string;
  generateStringMapEntries(mapAlloca: string): string;
  generateStringMapValues(mapAlloca: string): string;
}

interface StringSetGeneratorLike {
  generateStringSetAdd(setAlloca: string, value: string): string;
  generateStringSetHas(setAlloca: string, value: string): string;
}

interface MapGeneratorLike {
  generateMapSet(expr: MethodCallNode, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string;
  generateMapGet(expr: MethodCallNode, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string;
  generateMapHas(expr: MethodCallNode, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string;
  generateMapClear(expr: MethodCallNode, params: string[]): string;
  generateMapDelete(expr: MethodCallNode, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string;
}

interface SetGeneratorLike {
  generateSetAdd(expr: MethodCallNode, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string;
  generateSetHas(expr: MethodCallNode, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string;
  generateSetDelete(expr: MethodCallNode, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string;
}

interface ArrayGeneratorLike {
  generateArrayPush(expr: MethodCallNode, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string;
  generateArrayPop(expr: MethodCallNode, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string;
  generateArrayIncludes(expr: MethodCallNode, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string;
  generateArrayMap(expr: MethodCallNode, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string;
  generateArrayJoin(expr: MethodCallNode, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string;
  generateArrayFind(expr: MethodCallNode, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string;
  generateArraySome(expr: MethodCallNode, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string;
  generateArrayFilter(expr: MethodCallNode, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string;
  generateArrayForEach(expr: MethodCallNode, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string;
}

interface ClassGeneratorLike {
  generateMethodCall(instancePtr: string, className: string, method: string, args: Expression[], params: string[]): string;
  getFieldInfo(className: string, fieldName: string): { index: number; type: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' | 'boolean'; tsType?: string } | null;
}

interface ArrowFunctionGeneratorLike {
  generateArrowFunction(
    callback: Expression,
    params: string[],
    callbackTypes?: { paramTypes?: string[]; returnType?: string },
    scopeVars?: Map<string, string>
  ): string;
}

interface ExpressionGeneratorLike {
  getArrowFunctionGenerator(): ArrowFunctionGeneratorLike;
}

export interface MethodCallGeneratorContext {
  nextTemp(): string;
  emit(instruction: string): void;
  generateExpression(expr: Expression, params: string[]): string;
  syncStateToGenerators(): void;
  isStringExpression(expr: Expression): boolean;
  isArrayExpression(expr: Expression): boolean;
  isStringArrayExpression(expr: Expression): boolean;
  isRegexExpression(expr: Expression): boolean;
  isPromiseExpression(expr: Expression): boolean;
  formatCodegenError(message: string, suggestion: string): string;
  symbolTable: SymbolTable;
  variableTypes: Map<string, string>;
  thisPointer: string | null;
  currentClassName: string | null;
  ast: AST;
  typeChecker: TypeChecker | null;
  typeResolver?: TypeResolver;
  usesPromises: boolean;
  consoleGen: ConsoleGeneratorLike;
  processGen: ProcessGeneratorLike;
  fsGen: FilesystemGeneratorLike;
  pathGen: PathGeneratorLike;
  jsonGen: JsonGeneratorLike;
  mathGen: MathGeneratorLike;
  stringGen: StringGeneratorLike;
  regexGen: RegexGeneratorLike;
  responseGen: ResponseGeneratorLike;
  stringMapGen: StringMapGeneratorLike;
  stringSetGen: StringSetGeneratorLike;
  mapGen: MapGeneratorLike;
  setGen: SetGeneratorLike;
  arrayGen: ArrayGeneratorLike;
  classGen: ClassGeneratorLike;
  exprGen: ExpressionGeneratorLike;
}

export class MethodCallGenerator {
  constructor(private ctx: MethodCallGeneratorContext) {}

  private isVariableWithName(expr: Expression, name: string): expr is VariableNode {
    return expr.type === 'variable' && (expr as VariableNode).name === name;
  }

  private getVariableName(expr: Expression): string | null {
    if (expr.type === 'variable') {
      return (expr as VariableNode).name;
    }
    return null;
  }

  private getThisFieldMapType(expr: Expression): { fieldName: string; keyType: string; valueType: string } | null {
    if (this.ctx.typeResolver) {
      return this.ctx.typeResolver.getThisFieldMapType(expr);
    }

    if (expr.type !== 'member_access') return null;
    const memberExpr = expr as MemberAccessNode;
    if (memberExpr.object.type !== 'this') return null;

    const fieldName = memberExpr.property;
    if (!this.ctx.currentClassName) return null;

    const fieldInfo = this.ctx.classGen.getFieldInfo(this.ctx.currentClassName, fieldName);
    if (!fieldInfo?.tsType) return null;

    const mapMatch = fieldInfo.tsType.match(/^Map<(\w+),\s*(.+)>$/);
    if (!mapMatch) return null;

    return { fieldName, keyType: mapMatch[1], valueType: mapMatch[2] };
  }

  private getThisFieldSetType(expr: Expression): { fieldName: string; valueType: string } | null {
    if (this.ctx.typeResolver) {
      return this.ctx.typeResolver.getThisFieldSetType(expr);
    }

    if (expr.type !== 'member_access') return null;
    const memberExpr = expr as MemberAccessNode;
    if (memberExpr.object.type !== 'this') return null;

    const fieldName = memberExpr.property;
    if (!this.ctx.currentClassName) return null;

    const fieldInfo = this.ctx.classGen.getFieldInfo(this.ctx.currentClassName, fieldName);
    if (!fieldInfo?.tsType) return null;

    const setMatch = fieldInfo.tsType.match(/^Set<(\w+)>$/);
    if (!setMatch) return null;

    return { fieldName, valueType: setMatch[1] };
  }

  // Helper methods delegate to context
  private nextTemp() { return this.ctx.nextTemp(); }
  private emit(instruction: string) { this.ctx.emit(instruction); }
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

    // Handle console.log and console.error (delegated to ConsoleGenerator)
    if (this.ctx.consoleGen.canHandle(expr)) {
      return this.ctx.consoleGen.generateConsoleCall(expr.method, expr.args, params);
    }

    // Handle process.exit() (delegated to ProcessGenerator)
    if (this.ctx.processGen.canHandle(expr)) {
      return this.ctx.processGen.generateProcessExit(expr, params);
    }

    // Handle fs.* methods (delegated to FilesystemGenerator)
    if (this.ctx.fsGen.canHandle(expr)) {
      switch (expr.method) {
        case 'readFileSync':
          return this.ctx.fsGen.generateReadFileSync(expr, params);
        case 'writeFileSync':
          return this.ctx.fsGen.generateWriteFileSync(expr, params);
        case 'existsSync':
          return this.ctx.fsGen.generateExistsSync(expr, params);
        case 'unlinkSync':
          return this.ctx.fsGen.generateUnlinkSync(expr, params);
        default:
          throw new Error('Unsupported fs method: ' + expr.method);
      }
    }

    // Handle path.resolve() and path.dirname() (delegated to PathGenerator)
    if (method === 'resolve' && this.isVariableWithName(expr.object, 'path')) {
      return this.ctx.pathGen.generateResolve(expr, params);
    }
    if (method === 'dirname' && this.isVariableWithName(expr.object, 'path')) {
      return this.ctx.pathGen.generateDirname(expr, params);
    }

    // Handle execSync() from child_process
    if (method === 'execSync') {
      const objName = this.getVariableName(expr.object);
      if (objName === 'child_process' || objName === 'cp') {
        return this.handleExecSync(expr, params);
      }
    }

    // Handle JSON.parse() and JSON.stringify() (delegated to JsonGenerator)
    if (this.ctx.jsonGen.canHandle(expr)) {
      if (method === 'parse') {
        return this.ctx.jsonGen.generateParse(expr, params);
      } else if (method === 'stringify') {
        return this.ctx.jsonGen.generateStringify(expr, params);
      }
    }

    // Handle Math.* methods (delegated to MathGenerator)
    if (this.ctx.mathGen.canHandle(expr)) {
      return this.ctx.mathGen.generateMathMethod(expr, params);
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

        const objType = this.ctx.variableTypes.get(responsePtr);
        if (objType === 'i8*') {
          const castPtr = this.ctx.nextTemp();
          this.ctx.emit(`${castPtr} = bitcast i8* ${responsePtr} to %Response*`);
          responsePtr = castPtr;
        }

        if (method === 'text') {
          return this.ctx.responseGen.generateText(responsePtr);
        } else if (method === 'json') {
          if (expr.typeParameter && this.ctx.typeChecker) {
            const typeName = expr.typeParameter;
            const interfaceDef = this.ctx.typeChecker.getInterfaceDefinition(typeName);
            if (interfaceDef) {
              return this.ctx.responseGen.generateTypedJson(responsePtr, typeName, interfaceDef);
            }
          }
          return this.ctx.responseGen.generateJson(responsePtr);
        }
      } catch (e) {
        // Log error and rethrow so we can see what's happening
        console.error('[Response method error]:', e);
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
    if (method === 'concat') {
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
      return this.handleIndexOf(expr, params);
    }
    if (method === 'includes' && !this.ctx.isArrayExpression(expr.object) && !this.ctx.isStringArrayExpression(expr.object)) {
      return this.handleStringIncludes(expr, params);
    }
    if (method === 'slice') {
      return this.handleSlice(expr, params);
    }
    if (method === 'replace') {
      return this.handleReplace(expr, params);
    }
    if (method === 'charAt') {
      return this.handleCharAt(expr, params);
    }

    // Handle Map methods
    if (method === 'set' || method === 'get' || method === 'has' || method === 'clear' || method === 'delete' || method === 'entries' || method === 'values') {
      const varName = this.getVariableName(expr.object);
      if (varName && this.ctx.symbolTable.isMap(varName)) {
        this.ctx.syncStateToGenerators();
        const mapMeta = this.ctx.symbolTable.getMapMetadata(varName);

        if (mapMeta && mapMeta.keyType === 'string') {
          const mapAlloca = this.ctx.symbolTable.getAlloca(varName);
          if (mapAlloca) {
            if (method === 'set') {
              const keyValue = this.ctx.generateExpression(expr.args[0], params);
              const valueValue = this.ctx.generateExpression(expr.args[1], params);
              return this.ctx.stringMapGen.generateStringMapSet(mapAlloca, keyValue, valueValue);
            } else if (method === 'get') {
              const keyValue = this.ctx.generateExpression(expr.args[0], params);
              return this.ctx.stringMapGen.generateStringMapGet(mapAlloca, keyValue);
            } else if (method === 'has') {
              const keyValue = this.ctx.generateExpression(expr.args[0], params);
              return this.ctx.stringMapGen.generateStringMapHas(mapAlloca, keyValue);
            } else if (method === 'delete') {
              const keyValue = this.ctx.generateExpression(expr.args[0], params);
              return this.ctx.stringMapGen.generateStringMapDelete(mapAlloca, keyValue);
            } else if (method === 'entries') {
              return this.ctx.stringMapGen.generateStringMapEntries(mapAlloca);
            } else if (method === 'values') {
              return this.ctx.stringMapGen.generateStringMapValues(mapAlloca);
            } else {
              return this.ctx.stringMapGen.generateStringMapClear(mapAlloca);
            }
          }
        }

        if (method === 'set') {
          return this.ctx.mapGen.generateMapSet(expr, params, this.ctx.generateExpression.bind(this.ctx));
        } else if (method === 'get') {
          return this.ctx.mapGen.generateMapGet(expr, params, this.ctx.generateExpression.bind(this.ctx));
        } else if (method === 'has') {
          return this.ctx.mapGen.generateMapHas(expr, params, this.ctx.generateExpression.bind(this.ctx));
        } else if (method === 'delete') {
          return this.ctx.mapGen.generateMapDelete(expr, params, this.ctx.generateExpression.bind(this.ctx));
        } else if (method === 'entries' || method === 'values') {
          throw new Error(`Map.${method}() only supported for Map<string, *> types`);
        } else {
          return this.ctx.mapGen.generateMapClear(expr, params);
        }
      }

      const thisFieldMap = this.getThisFieldMapType(expr.object);
      if (thisFieldMap) {
        const mapPtr = this.ctx.generateExpression(expr.object, params);
        if (thisFieldMap.keyType === 'string') {
          if (method === 'set') {
            const keyValue = this.ctx.generateExpression(expr.args[0], params);
            const valueValue = this.ctx.generateExpression(expr.args[1], params);
            return this.ctx.stringMapGen.generateStringMapSet(mapPtr, keyValue, valueValue);
          } else if (method === 'get') {
            const keyValue = this.ctx.generateExpression(expr.args[0], params);
            return this.ctx.stringMapGen.generateStringMapGet(mapPtr, keyValue);
          } else if (method === 'has') {
            const keyValue = this.ctx.generateExpression(expr.args[0], params);
            return this.ctx.stringMapGen.generateStringMapHas(mapPtr, keyValue);
          } else if (method === 'delete') {
            const keyValue = this.ctx.generateExpression(expr.args[0], params);
            return this.ctx.stringMapGen.generateStringMapDelete(mapPtr, keyValue);
          } else if (method === 'entries') {
            return this.ctx.stringMapGen.generateStringMapEntries(mapPtr);
          } else if (method === 'values') {
            return this.ctx.stringMapGen.generateStringMapValues(mapPtr);
          } else {
            return this.ctx.stringMapGen.generateStringMapClear(mapPtr);
          }
        }
      }
    }

    // Handle Set methods
    if (method === 'add' || method === 'has' || method === 'delete') {
      const varName = this.getVariableName(expr.object);
      if (varName && this.ctx.symbolTable.isSet(varName)) {
        this.ctx.syncStateToGenerators();
        const setMeta = this.ctx.symbolTable.getSetMetadata(varName);

        if (setMeta && setMeta.valueType === 'string') {
          const setAlloca = this.ctx.symbolTable.getAlloca(varName);
          if (setAlloca) {
            if (method === 'add') {
              const valueValue = this.ctx.generateExpression(expr.args[0], params);
              return this.ctx.stringSetGen.generateStringSetAdd(setAlloca, valueValue);
            } else if (method === 'has') {
              const valueValue = this.ctx.generateExpression(expr.args[0], params);
              return this.ctx.stringSetGen.generateStringSetHas(setAlloca, valueValue);
            } else {
              throw new Error('Set.delete() not yet implemented for Set<string>');
            }
          }
        }

        if (method === 'add') {
          return this.ctx.setGen.generateSetAdd(expr, params, this.ctx.generateExpression.bind(this.ctx));
        } else if (method === 'has') {
          return this.ctx.setGen.generateSetHas(expr, params, this.ctx.generateExpression.bind(this.ctx));
        } else {
          return this.ctx.setGen.generateSetDelete(expr, params, this.ctx.generateExpression.bind(this.ctx));
        }
      }

      const thisFieldSet = this.getThisFieldSetType(expr.object);
      if (thisFieldSet) {
        const setPtr = this.ctx.generateExpression(expr.object, params);
        if (thisFieldSet.valueType === 'string') {
          if (method === 'add') {
            const valueValue = this.ctx.generateExpression(expr.args[0], params);
            return this.ctx.stringSetGen.generateStringSetAdd(setPtr, valueValue);
          } else if (method === 'has') {
            const valueValue = this.ctx.generateExpression(expr.args[0], params);
            return this.ctx.stringSetGen.generateStringSetHas(setPtr, valueValue);
          } else {
            throw new Error('Set.delete() not yet implemented for Set<string>');
          }
        }
      }
    }

    // Handle array methods (arrayGen uses context pattern - no sync needed! 🎯)
    if (method === 'push') {
      return this.ctx.arrayGen.generateArrayPush(expr, params, this.ctx.generateExpression.bind(this.ctx));
    } else if (method === 'pop') {
      return this.ctx.arrayGen.generateArrayPop(expr, params, this.ctx.generateExpression.bind(this.ctx));
    } else if (method === 'includes' && this.ctx.isArrayExpression(expr.object)) {
      return this.ctx.arrayGen.generateArrayIncludes(expr, params, this.ctx.generateExpression.bind(this.ctx));
    } else if (method === 'map') {
      return this.ctx.arrayGen.generateArrayMap(expr, params, this.ctx.generateExpression.bind(this.ctx));
    } else if (method === 'join') {
      return this.ctx.arrayGen.generateArrayJoin(expr, params, this.ctx.generateExpression.bind(this.ctx));
    } else if (method === 'find') {
      return this.ctx.arrayGen.generateArrayFind(expr, params, this.ctx.generateExpression.bind(this.ctx));
    } else if (method === 'some') {
      return this.ctx.arrayGen.generateArraySome(expr, params, this.ctx.generateExpression.bind(this.ctx));
    } else if (method === 'filter') {
      return this.ctx.arrayGen.generateArrayFilter(expr, params, this.ctx.generateExpression.bind(this.ctx));
    } else if (method === 'forEach') {
      return this.ctx.arrayGen.generateArrayForEach(expr, params, this.ctx.generateExpression.bind(this.ctx));
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
    this.throwUnsupportedMethodError(method);
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
      const formatStr = this.ctx.stringGen.createStringConstant('"%s"');
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
      const formatStr = this.ctx.stringGen.createStringConstant('%f');
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
    return this.ctx.regexGen.generateRegexTest(regexPtr, testStr);
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

    return this.ctx.stringGen.generateSubstr(strPtr, startIndex, length);
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

    return this.ctx.stringGen.generateSubstr(strPtr, startIndex, length);
  }

  private handleConcat(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length < 1) {
      throw new Error(`concat() expects at least 1 argument, got ${expr.args.length}`);
    }

    let result = strPtr;
    for (const arg of expr.args) {
      const argStr = this.ctx.generateExpression(arg, params);
      result = this.ctx.stringGen.generateStringConcatDirect(result, argStr);
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
    return this.ctx.stringGen.generateRepeat(strPtr, count);
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
      : this.ctx.stringGen.createStringConstant(' ');

    return this.ctx.stringGen.generatePadStart(strPtr, targetLength, padString);
  }

  private handleSplit(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length !== 1) {
      throw new Error(`split() expects 1 argument, got ${expr.args.length}`);
    }

    const delimiter = this.ctx.generateExpression(expr.args[0], params);
    return this.ctx.stringGen.generateSplit(strPtr, delimiter);
  }

  private handleStartsWith(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length !== 1) {
      throw new Error(`startsWith() expects 1 argument, got ${expr.args.length}`);
    }

    const prefix = this.ctx.generateExpression(expr.args[0], params);
    return this.ctx.stringGen.generateStartsWith(strPtr, prefix);
  }

  private handleEndsWith(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length !== 1) {
      throw new Error(`endsWith() expects 1 argument, got ${expr.args.length}`);
    }

    const suffix = this.ctx.generateExpression(expr.args[0], params);
    return this.ctx.stringGen.generateEndsWith(strPtr, suffix);
  }

  private handleTrim(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length !== 0) {
      throw new Error(`trim() expects 0 arguments, got ${expr.args.length}`);
    }

    return this.ctx.stringGen.generateTrim(strPtr);
  }

  private handleIndexOf(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length !== 1) {
      throw new Error(`indexOf() expects 1 argument, got ${expr.args.length}`);
    }

    const substring = this.ctx.generateExpression(expr.args[0], params);
    return this.ctx.stringGen.generateIndexOf(strPtr, substring);
  }

  private handleStringIncludes(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

    if (expr.args.length !== 1) {
      throw new Error(`includes() expects 1 argument, got ${expr.args.length}`);
    }

    const substring = this.ctx.generateExpression(expr.args[0], params);
    return this.ctx.stringGen.generateIncludes(strPtr, substring);
  }

  private handleSlice(expr: MethodCallNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    const strPtr = this.ctx.generateExpression(expr.object, params);

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

    return this.ctx.stringGen.generateSlice(strPtr, startI32, endI32);
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
      const isGlobal = regexNode.flags.includes('g');
      const searchStr = this.ctx.stringGen.generateGlobalString(regexNode.pattern);
      const replaceStr = this.ctx.generateExpression(replaceArg, params);
      if (isGlobal) {
        return this.ctx.stringGen.generateReplaceAll(strPtr, searchStr, replaceStr);
      } else {
        return this.ctx.stringGen.generateReplace(strPtr, searchStr, replaceStr);
      }
    }

    const searchStr = this.ctx.generateExpression(searchArg, params);
    const replaceStr = this.ctx.generateExpression(replaceArg, params);
    return this.ctx.stringGen.generateReplace(strPtr, searchStr, replaceStr);
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
    return this.ctx.stringGen.generateCharAt(strPtr, indexI32);
  }

  private handleClassMethods(expr: MethodCallNode, params: string[]): string | null {
    const method = expr.method;
    let className: string | null = null;
    let instancePtr: string | null = null;

    if (expr.object.type === 'variable') {
      const varName = (expr.object as VariableNode).name;
      if (this.ctx.symbolTable.isClass(varName)) {
        const classMeta = this.ctx.symbolTable.getClassInfo(varName)!;
        className = classMeta.className;
        instancePtr = this.ctx.generateExpression(expr.object, params);
      }
    } else if (expr.object.type === 'new') {
      const newExpr = expr.object as NewNode;
      className = newExpr.className;
      instancePtr = this.ctx.generateExpression(expr.object, params);
    } else if (expr.object.type === 'this') {
      if (!this.ctx.thisPointer) {
        throw new Error('this.method() called outside of class method');
      }
      instancePtr = this.ctx.thisPointer;
      if (this.ctx.currentClassName) {
        className = this.ctx.currentClassName;
      } else {
        const classWithMethod = this.ctx.ast.classes.find((c: ClassNode) =>
          c.methods.some((m: ClassMethod) => m.name === method && !m.isConstructor)
        );
        if (!classWithMethod) {
          throw new Error(`Method ${method} not found in any class`);
        }
        className = classWithMethod.name;
      }
    } else if (expr.object.type === 'member_access') {
      const memberAccess = expr.object as MemberAccessNode;
      if (memberAccess.object.type === 'this' && this.ctx.currentClassName) {
        const fieldInfo = this.ctx.classGen.getFieldInfo(this.ctx.currentClassName, memberAccess.property);
        if (fieldInfo?.tsType) {
          const fieldClassName = fieldInfo.tsType;
          const classExists = this.ctx.ast.classes.some((c: ClassNode) => c.name === fieldClassName);
          if (classExists) {
            instancePtr = this.ctx.generateExpression(expr.object, params);
            className = fieldClassName;
          }
        }
      } else if (memberAccess.object.type === 'variable') {
        const varName = (memberAccess.object as VariableNode).name;
        if (this.ctx.symbolTable.isClass(varName)) {
          const classMeta = this.ctx.symbolTable.getClassInfo(varName)!;
          const outerClassName = classMeta.className;
          const fieldInfo = this.ctx.classGen.getFieldInfo(outerClassName, memberAccess.property);
          if (fieldInfo?.tsType) {
            const fieldClassName = fieldInfo.tsType;
            const classExists = this.ctx.ast.classes.some((c: ClassNode) => c.name === fieldClassName);
            if (classExists) {
              instancePtr = this.ctx.generateExpression(expr.object, params);
              className = fieldClassName;
            }
          }
        }
      } else if (memberAccess.object.type === 'member_access') {
        const resolvedType = this.resolveNestedMemberAccessType(expr.object);
        if (resolvedType) {
          instancePtr = this.ctx.generateExpression(expr.object, params);
          className = resolvedType;
        }
      }
    } else if (expr.object.type === 'super') {
      if (!this.ctx.thisPointer) {
        throw new Error('super.method() called outside of class method');
      }
      if (!this.ctx.currentClassName) {
        throw new Error('super.method() called outside of class context');
      }
      const currentClass = this.ctx.ast.classes.find((c: ClassNode) => c.name === this.ctx.currentClassName);
      if (!currentClass || !currentClass.extends) {
        throw new Error(`super.method() called but current class ${this.ctx.currentClassName} has no parent class`);
      }
      instancePtr = this.ctx.thisPointer;
      className = currentClass.extends;

      if (method === '') {
        return '0';
      }
    }

    if (className && instancePtr) {
      const resolvedClass = this.findClassWithMethod(className, method);
      if (!resolvedClass) {
        throw new Error(`Method ${method} not found in class ${className}`);
      }

      this.ctx.syncStateToGenerators();
      return this.ctx.classGen.generateMethodCall(instancePtr, resolvedClass, method, expr.args, params);
    }

    return null;
  }

  private findClassWithMethod(className: string, methodName: string): string | null {
    const classNode = this.ctx.ast.classes.find((c: ClassNode) => c.name === className);
    if (!classNode) return null;

    const methodExists = classNode.methods.some((m: ClassMethod) => m.name === methodName && !m.isConstructor);
    if (methodExists) return className;

    if (classNode.extends) {
      return this.findClassWithMethod(classNode.extends, methodName);
    }

    return null;
  }

  private resolveNestedMemberAccessType(expr: Expression): string | null {
    if (expr.type === 'this') {
      return this.ctx.currentClassName;
    }

    if (expr.type === 'variable') {
      const varName = (expr as VariableNode).name;
      if (this.ctx.symbolTable.isClass(varName)) {
        const classMeta = this.ctx.symbolTable.getClassInfo(varName);
        return classMeta?.className || null;
      }
      return null;
    }

    if (expr.type === 'member_access') {
      const memberAccess = expr as MemberAccessNode;
      const parentType = this.resolveNestedMemberAccessType(memberAccess.object);
      if (!parentType) {
        return null;
      }

      const classExists = this.ctx.ast.classes.some((c: ClassNode) => c.name === parentType);
      if (classExists) {
        const fieldInfo = this.ctx.classGen.getFieldInfo(parentType, memberAccess.property);
        if (fieldInfo?.tsType) {
          const fieldClassExists = this.ctx.ast.classes.some((c: ClassNode) => c.name === fieldInfo.tsType);
          if (fieldClassExists) {
            return fieldInfo.tsType;
          }
          const fieldInterfaceExists = this.ctx.ast.interfaces.some(i => i.name === fieldInfo.tsType);
          if (fieldInterfaceExists) {
            return fieldInfo.tsType;
          }
        }
        return null;
      }

      const interfaceDecl = this.ctx.ast.interfaces.find(i => i.name === parentType);
      if (interfaceDecl) {
        const field = interfaceDecl.fields.find(f => f.name === memberAccess.property);
        if (field) {
          let fieldType = field.type;
          if (fieldType.endsWith(' | null') || fieldType.endsWith(' | undefined')) {
            fieldType = fieldType.replace(/ \| null$/, '').replace(/ \| undefined$/, '');
          }
          const fieldClassExists = this.ctx.ast.classes.some((c: ClassNode) => c.name === fieldType);
          if (fieldClassExists) {
            return fieldType;
          }
          const fieldInterfaceExists = this.ctx.ast.interfaces.some(i => i.name === fieldType);
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

    if (expr.object.type === 'variable') {
      const varName = (expr.object as VariableNode).name;
      if (this.ctx.symbolTable.isObject(varName)) {
        const objMeta = this.ctx.symbolTable.getObjectInfo(varName);
        if (!objMeta) {
          return null;
        }
        isObjectMethod = objMeta.keys.includes(method);
      }
    } else if (expr.object.type === 'object') {
      const objExpr = expr.object as ObjectNode;
      isObjectMethod = objExpr.properties.some((p: { key: string; value: Expression }) => p.key === method);
    }

    if (!isObjectMethod) {
      return null;
    }

    const funcExists = this.ctx.ast.functions.some((f: FunctionNode) => f.name === method);
    if (!funcExists) {
      throw new Error(`Function ${method} not found for object method call`);
    }

    // Get function type from type checker for correct parameter/return types
    let returnType = 'double';
    let paramTypes: string[] = [];

    if (this.ctx.typeChecker) {
      try {
        const funcType = this.ctx.typeChecker.getFunctionType(method);
        if (funcType) {
          returnType = funcType.returnType === 'string' ? 'i8*' : 'double';
          paramTypes = funcType.parameters.map((p: { name: string; type: string }) => p.type === 'string' ? 'i8*' : 'double');
        }
      } catch (e) {
      }
    }

    // Generate arguments
    const args = expr.args.map((arg, i) => {
      const result = this.ctx.generateExpression(arg, params);
      const paramType = paramTypes[i] || 'double';
      return `${paramType} ${result}`;
    }).join(', ');

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
        const valueType = this.ctx.variableTypes.get(value) || 'double';
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
      this.ctx.variableTypes.set(result, '%Promise*');
      return result;
    }

    if (method === 'reject') {
      let reasonPtr: string;
      if (expr.args.length > 0) {
        const reason = this.ctx.generateExpression(expr.args[0], params);
        const reasonType = this.ctx.variableTypes.get(reason) || 'double';
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
      this.ctx.variableTypes.set(result, '%Promise*');
      return result;
    }

    if (method === 'all') {
      if (expr.args.length < 1) {
        throw new Error('Promise.all() requires 1 argument (array of promises)');
      }
      const promisesArray = this.ctx.generateExpression(expr.args[0], params);
      const result = this.nextTemp();
      this.emit(`${result} = call %Promise* @__Promise_all(%Array* ${promisesArray})`);
      this.ctx.variableTypes.set(result, '%Promise*');
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
    const arrowFuncGen = this.ctx.exprGen.getArrowFunctionGenerator();
    const scopeVars = this.ctx.symbolTable.getScopeVarsForClosure();

    const processCallback = (callback: Expression): string | null => {
      if (callback.type === 'arrow_function') {
        const callbackName = arrowFuncGen.generateArrowFunction(callback, params, promiseCallbackTypes, scopeVars);
        return `@${callbackName}`;
      } else if (callback.type === 'variable') {
        return `@${(callback as VariableNode).name}`;
      }
      return null;
    };

    if (isCatch) {
      if (expr.args.length > 0) {
        const result = processCallback(expr.args[0]);
        if (result) onRejected = result;
      }
    } else {
      if (expr.args.length > 0) {
        const result = processCallback(expr.args[0]);
        if (result) onFulfilled = result;
      }
      if (expr.args.length > 1) {
        const result = processCallback(expr.args[1]);
        if (result) onRejected = result;
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
    this.ctx.variableTypes.set(result, '%Promise*');
    return result;
  }

  private throwUnsupportedMethodError(method: string): never {
    const stringMethods = [
      'charAt', 'concat', 'padStart', 'repeat', 'split', 'startsWith', 'substring', 'substr'
    ];
    const arrayMethods = [
      'push', 'map', 'join', 'find', 'some', 'filter', 'forEach'
    ];
    const mapMethods = [
      'set', 'get', 'has'
    ];
    const setMethods = [
      'add', 'has', 'delete'
    ];
    const otherMethods = [
      'console.log', 'console.error',
      'process.exit', 'process.argv',
      'fs.readFileSync', 'fs.writeFileSync', 'fs.existsSync', 'fs.unlinkSync',
      'path.resolve', 'path.dirname',
      'child_process.execSync',
      'JSON.parse', 'JSON.stringify',
      'regex.test'
    ];

    const suggestion =
      `\x1b[33mSupported methods:\x1b[0m\n\n` +
      `\x1b[36mString methods:\x1b[0m\n  ${stringMethods.join(', ')}\n\n` +
      `\x1b[36mArray methods:\x1b[0m\n  ${arrayMethods.join(', ')}\n\n` +
      `\x1b[36mMap methods:\x1b[0m\n  ${mapMethods.join(', ')}\n\n` +
      `\x1b[36mSet methods:\x1b[0m\n  ${setMethods.join(', ')}\n\n` +
      `\x1b[36mOther built-in methods:\x1b[0m\n  ${otherMethods.join(', ')}\n\n` +
      `\x1b[33mIf you need '${method}', consider:\x1b[0m\n` +
      `  • Using a similar method from the list above\n` +
      `  • Implementing it using supported operations\n` +
      `  • Opening an issue: https://github.com/your-repo/issues`;

    throw new Error(this.ctx.formatCodegenError(
      `Method '${method}' is not supported yet.`,
      suggestion
    ));
  }
}
