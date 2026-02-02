import { Expression, NewNode, AST, VariableDeclaration, InterfaceDeclaration, ObjectNode, IndexAccessNode, MemberAccessNode, VariableNode, TypeAliasDeclaration } from '../../ast/types.js';
import { SymbolKind, SymbolTable, ObjectMetadata, MapMetadata, ClassMetadata, ClosureMetadata, SetMetadata } from './symbol-table.js';
import type { TypeChecker } from '../../typescript/type-checker.js';
import { TypeResolver } from './type-resolver/index.js';

interface ClassGeneratorLike {
  getClassFields(className: string): { name: string; fieldType: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' | 'boolean' }[];
  getFieldInfo(className: string, fieldName: string): { index: number; type: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' | 'boolean'; tsType?: string } | null;
}

interface ArrowFunctionGeneratorLike {
  generateArrowFunction(expr: Expression | null, params: string[], returnType?: string | { paramTypes?: string[], returnType?: string }, scopeVars?: Map<string, string>): string;
  getClosureInfoForLambda(lambdaName: string): { envStructName: string; captures: { name: string; llvmType: string }[] } | null;
}

interface ExpressionGeneratorLike {
  getArrowFunctionGenerator(): ArrowFunctionGeneratorLike;
}

type VariableMetadata = {
  objectMetadata?: ObjectMetadata;
  classMetadata?: ClassMetadata;
  closureMetadata?: ClosureMetadata;
  mapMetadata?: MapMetadata;
  setMetadata?: SetMetadata;
};

export interface VariableAllocatorContext {
  nextTemp(): string;
  emit(instruction: string): void;
  defineVariable(name: string, allocaReg: string, llvmType: string, kind: SymbolKind, scope: 'local' | 'global', metadata?: VariableMetadata): void;
  generateExpression(expr: Expression, params: string[]): string;
  isStringExpression(expr: Expression): boolean;
  isArrayExpression(expr: Expression): boolean;
  isStringArrayExpression(expr: Expression): boolean;
  isObjectExpression(expr: Expression): boolean;
  isMapExpression(expr: Expression): boolean;
  isSetExpression(expr: Expression): boolean;
  isRegexExpression(expr: Expression): boolean;
  isClassInstanceExpression(expr: Expression): boolean;
  isPromiseExpression(expr: Expression): boolean;
  isResponseExpression(expr: Expression): boolean;
  isJSONParseExpression(expr: Expression): boolean;
  isAwaitExpression(expr: Expression): boolean;
  currentDeclaredMapType: string | undefined;
  currentDeclaredSetType: string | undefined;
  getTypedJsonInterface(expr: Expression): string | null;
  getFunctionCallInterfaceReturn(expr: Expression): string | null;
  getJSONParseInterface(expr: Expression): string | null;
  getObjectMetadata(objExpr: ObjectNode): { keys: string[]; types: string[] };
  formatCodegenError(message: string, suggestion?: string): string;
  ast: AST;
  classGen: ClassGeneratorLike;
  symbolTable: SymbolTable;
  exprGen: ExpressionGeneratorLike;
  expectedArrayElementType: 'string' | 'number' | 'boolean' | null;
  currentDeclaredInterfaceType: string | undefined;
  currentClassName: string | null;
  typeChecker?: TypeChecker | null;
  typeResolver?: TypeResolver;
}

export class VariableAllocator {
  constructor(private ctx: VariableAllocatorContext) {}

  allocate(stmt: VariableDeclaration, params: string[]): void {
    if (stmt.value === null) {
      const allocaReg = this.ctx.nextTemp();
      this.ctx.defineVariable(stmt.name, allocaReg, 'double', SymbolKind.Number, 'local');
      this.ctx.emit(`${allocaReg} = alloca double`);
      this.ctx.emit(`store double 0.0, double* ${allocaReg}`);
      return;
    }

    if (stmt.declaredType) {
      if (stmt.declaredType === 'string[]') {
        this.ctx.expectedArrayElementType = 'string';
      } else if (stmt.declaredType === 'number[]' || stmt.declaredType === 'boolean[]') {
        this.ctx.expectedArrayElementType = 'number';
      }
    }

    const isString = this.ctx.isStringExpression(stmt.value);
    const isStringArray = this.ctx.isStringArrayExpression(stmt.value);
    const isArray = !isStringArray && this.ctx.isArrayExpression(stmt.value);
    const isJSONObject = this.ctx.isJSONParseExpression(stmt.value);
    const isObject = !isJSONObject && this.ctx.isObjectExpression(stmt.value);
    const isMap = this.ctx.isMapExpression(stmt.value);
    const isSet = this.ctx.isSetExpression(stmt.value);
    const isRegex = this.ctx.isRegexExpression(stmt.value);
    const isPromise = this.ctx.isPromiseExpression(stmt.value);
    const isAwait = this.ctx.isAwaitExpression(stmt.value);
    const isClassInstance = !isPromise && this.ctx.isClassInstanceExpression(stmt.value);
    const isResponse = this.ctx.isResponseExpression(stmt.value);
    const typedJsonInterface = this.ctx.getTypedJsonInterface(stmt.value);
    const functionInterfaceReturn = this.ctx.getFunctionCallInterfaceReturn(stmt.value);
    const mapGetInterfaceType = this.getMapGetInterfaceType(stmt.value);
    const declaredInterfaceType = this.getDeclaredInterfaceType(stmt);

    if (declaredInterfaceType) {
      this.allocateDeclaredInterface(stmt, params, declaredInterfaceType);
    } else if (mapGetInterfaceType) {
      this.allocateMapGetInterface(stmt, params, mapGetInterfaceType);
    } else if (functionInterfaceReturn) {
      this.allocateFunctionInterfaceReturn(stmt, params, functionInterfaceReturn);
    } else if (isAwait) {
      this.allocateAwaitResult(stmt, params);
    } else if (isPromise) {
      this.allocatePromise(stmt, params);
    } else if (isClassInstance) {
      this.allocateClassInstance(stmt, params);
    } else if (typedJsonInterface) {
      this.allocateTypedJsonInterface(stmt, params, typedJsonInterface);
    } else if (isResponse) {
      this.allocateResponse(stmt, params);
    } else if (isJSONObject) {
      this.allocateJSONObject(stmt, params);
    } else if (isObject) {
      this.allocateObject(stmt, params);
    } else if (isMap) {
      this.allocateMap(stmt, params);
    } else if (isSet) {
      this.allocateSet(stmt, params);
    } else if (isStringArray) {
      this.allocateStringArray(stmt, params);
    } else if (isArray) {
      this.allocateArray(stmt, params);
    } else if (isRegex) {
      this.allocateRegex(stmt, params);
    } else if (isString) {
      this.allocateString(stmt, params);
    } else if (stmt.value && stmt.value.type === 'arrow_function') {
      this.allocateArrowFunction(stmt, params);
    } else {
      const indexedObjectType = this.getIndexedObjectArrayType(stmt.value);
      if (indexedObjectType) {
        this.allocateIndexedObjectArray(stmt, params, indexedObjectType);
      } else {
        this.allocateNumeric(stmt, params);
      }
    }

    this.ctx.expectedArrayElementType = null;
  }

  private allocateFunctionInterfaceReturn(stmt: VariableDeclaration, params: string[], interfaceName: string): void {
    const interfaceDef = this.ctx.ast.interfaces!.find((i: InterfaceDeclaration) => i.name === interfaceName)!;
    const allocaReg = this.ctx.nextTemp();
    const keys = interfaceDef.fields.map((f) => f.name);
    const types = interfaceDef.fields.map((f) => this.tsTypeToLlvm(f.type));
    this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.Object, 'local', {
      objectMetadata: { keys, types }
    });
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    const objPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${objPtr}, i8** ${allocaReg}`);
  }

  private getDeclaredInterfaceType(stmt: VariableDeclaration): string | null {
    if (stmt.value?.type === 'type_assertion') {
      const assertedType = (stmt.value as { type: 'type_assertion'; expression: Expression; assertedType: string }).assertedType;
      const interfaceDef = this.ctx.ast.interfaces?.find((i: InterfaceDeclaration) => i.name === assertedType);
      if (interfaceDef) {
        return assertedType;
      }
    }
    if (!stmt.declaredType) return null;
    if (stmt.value?.type !== 'variable') return null;
    const interfaceDef = this.ctx.ast.interfaces?.find((i: InterfaceDeclaration) => i.name === stmt.declaredType);
    if (!interfaceDef) return null;
    return stmt.declaredType;
  }

  private allocateDeclaredInterface(stmt: VariableDeclaration, params: string[], interfaceName: string): void {
    const interfaceDef = this.ctx.ast.interfaces!.find((i: InterfaceDeclaration) => i.name === interfaceName)!;
    const allocaReg = this.ctx.nextTemp();
    const keys = interfaceDef.fields.map((f) => f.name);
    const types = interfaceDef.fields.map((f) => this.tsTypeToLlvm(f.type));
    const tsTypes = interfaceDef.fields.map((f) => f.type);
    this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.Object, 'local', {
      objectMetadata: { keys, types, tsTypes }
    });
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    const objPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${objPtr}, i8** ${allocaReg}`);
  }

  private getMapGetInterfaceType(expr: Expression): string | null {
    if (this.ctx.typeResolver) {
      return this.ctx.typeResolver.getMapGetInterfaceType(expr);
    }
    if (expr?.type !== 'method_call') return null;
    if (expr.method !== 'get') return null;

    let valueType: string | null = null;

    if (expr.object?.type === 'variable') {
      const mapName = expr.object.name;
      if (!this.ctx.symbolTable.isMap(mapName)) return null;

      const mapMeta = this.ctx.symbolTable.getMapMetadata(mapName);
      if (!mapMeta) return null;
      if (mapMeta.keyType !== 'string') return null;

      valueType = mapMeta.valueType;
    } else if (expr.object?.type === 'member_access') {
      const memberExpr = expr.object as MemberAccessNode;
      if (memberExpr.object.type !== 'this') return null;
      if (!this.ctx.currentClassName) return null;

      const fieldInfo = this.ctx.classGen.getFieldInfo(this.ctx.currentClassName, memberExpr.property);
      if (!fieldInfo?.tsType) return null;

      const mapMatch = fieldInfo.tsType.match(/^Map<(\w+),\s*(.+)>$/);
      if (!mapMatch) return null;
      if (mapMatch[1] !== 'string') return null;

      valueType = mapMatch[2];
    }

    if (!valueType) return null;
    if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') return null;

    const interfaceDef = this.ctx.ast.interfaces?.find((i: InterfaceDeclaration) => i.name === valueType);
    if (!interfaceDef) return null;

    return valueType;
  }

  private allocateMapGetInterface(stmt: VariableDeclaration, params: string[], interfaceName: string): void {
    const interfaceDef = this.ctx.ast.interfaces!.find((i: InterfaceDeclaration) => i.name === interfaceName)!;
    const allocaReg = this.ctx.nextTemp();
    const keys = interfaceDef.fields.map((f) => f.name);
    const types = interfaceDef.fields.map((f) => this.tsTypeToLlvm(f.type));
    const llvmType = `%${interfaceName}*`;
    this.ctx.defineVariable(stmt.name, allocaReg, llvmType, SymbolKind.Object, 'local', {
      objectMetadata: { keys, types }
    });
    this.ctx.emit(`${allocaReg} = alloca ${llvmType}`);
    const objPtr = this.ctx.generateExpression(stmt.value!, params);
    const typedPtr = this.ctx.nextTemp();
    this.ctx.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${llvmType}`);
    this.ctx.emit(`store ${llvmType} ${typedPtr}, ${llvmType}* ${allocaReg}`);
  }

  private allocateClassInstance(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextTemp();
    const newExpr = stmt.value as NewNode;
    const className = newExpr.className;
    const fields = this.ctx.classGen.getClassFields(className);
    const ptrType = fields.length > 0 ? `%${className}_struct*` : 'i32*';

    this.ctx.defineVariable(stmt.name, allocaReg, ptrType, SymbolKind.Class, 'local', {
      classMetadata: { className }
    });
    this.ctx.emit(`${allocaReg} = alloca ${ptrType}`);

    const instancePtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store ${ptrType} ${instancePtr}, ${ptrType}* ${allocaReg}`);
  }

  private allocatePromise(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextTemp();
    this.ctx.defineVariable(stmt.name, allocaReg, '%Promise*', SymbolKind.Object, 'local');
    this.ctx.emit(`${allocaReg} = alloca %Promise*`);

    const promisePtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store %Promise* ${promisePtr}, %Promise** ${allocaReg}`);
  }

  private allocateAwaitResult(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextTemp();
    this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.String, 'local');
    this.ctx.emit(`${allocaReg} = alloca i8*`);

    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${value}, i8** ${allocaReg}`);
  }

  private allocateTypedJsonInterface(stmt: VariableDeclaration, params: string[], interfaceName: string): void {
    const allocaReg = this.ctx.nextTemp();
    const structType = `%${interfaceName}*`;
    this.ctx.defineVariable(stmt.name, allocaReg, structType, SymbolKind.Object, 'local');
    this.ctx.emit(`${allocaReg} = alloca ${structType}`);

    const structPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store ${structType} ${structPtr}, ${structType}* ${allocaReg}`);
  }

  private allocateResponse(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextTemp();
    this.ctx.defineVariable(stmt.name, allocaReg, '%Response*', SymbolKind.Object, 'local');
    this.ctx.emit(`${allocaReg} = alloca %Response*`);

    const responsePtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store %Response* ${responsePtr}, %Response** ${allocaReg}`);
  }

  private allocateJSONObject(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextTemp();
    const interfaceName = this.ctx.getJSONParseInterface(stmt.value!);
    if (!interfaceName) {
      throw new Error(
        this.ctx.formatCodegenError(
          'JSON.parse() requires a type parameter. This should have been caught by the parser.\n' +
          'Use: JSON.parse<InterfaceName>(jsonString)'
        )
      );
    }

    const interfaceDef = this.ctx.ast.interfaces?.find((iface: InterfaceDeclaration) => iface.name === interfaceName);

    if (!interfaceDef) {
      this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.JSON, 'local');
      this.ctx.emit(`${allocaReg} = alloca i8*`);
      const jsonPtr = this.ctx.generateExpression(stmt.value!, params);
      this.ctx.emit(`store i8* ${jsonPtr}, i8** ${allocaReg}`);
    } else {
      const keys = interfaceDef.fields.map((f) => f.name);
      const tsTypes = interfaceDef.fields.map((f) => f.type);
      const types = interfaceDef.fields.map((f) => this.tsTypeToLlvmJson(f.type));

      this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.JSON, 'local', {
        objectMetadata: { keys, types, tsTypes }
      });

      this.ctx.emit(`${allocaReg} = alloca i8*`);
      const jsonPtr = this.ctx.generateExpression(stmt.value!, params);
      this.ctx.emit(`store i8* ${jsonPtr}, i8** ${allocaReg}`);
    }
  }

  private allocateObject(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextTemp();
    const interfaceDef = stmt.declaredType
      ? this.ctx.ast.interfaces?.find((iface: InterfaceDeclaration) => iface.name === stmt.declaredType)
      : undefined;

    let keys: string[];
    let types: string[];

    if (interfaceDef) {
      keys = interfaceDef.fields.map((f) => f.name);
      types = interfaceDef.fields.map((f) => this.tsTypeToLlvm(f.type));
    } else {
      const metadata = this.ctx.getObjectMetadata(stmt.value as ObjectNode);
      keys = metadata.keys;
      types = metadata.types;
    }

    this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.Object, 'local', {
      objectMetadata: { keys, types }
    });
    this.ctx.emit(`${allocaReg} = alloca i8*`);

    if (interfaceDef) {
      this.ctx.currentDeclaredInterfaceType = stmt.declaredType;
    }
    const objExpr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.currentDeclaredInterfaceType = undefined;
    this.ctx.emit(`store i8* ${objExpr}, i8** ${allocaReg}`);
  }

  private allocateMap(stmt: VariableDeclaration, params: string[]): void {
    const mapTypeInfo = this.parseMapType(stmt.declaredType);

    if (mapTypeInfo && mapTypeInfo.keyType === 'string') {
      this.allocateStringMap(stmt, params, mapTypeInfo);
    } else {
      const allocaReg = this.ctx.nextTemp();
      this.ctx.defineVariable(stmt.name, allocaReg, '%Map*', SymbolKind.Map, 'local');
      this.ctx.emit(`${allocaReg} = alloca %Map`);

      const value = this.ctx.generateExpression(stmt.value!, params);
      const loadedMap = this.ctx.nextTemp();
      this.ctx.emit(`${loadedMap} = load %Map, %Map* ${value}`);
      this.ctx.emit(`store %Map ${loadedMap}, %Map* ${allocaReg}`);
    }
  }

  private allocateStringMap(stmt: VariableDeclaration, params: string[], mapTypeInfo: { keyType: string; valueType: string }): void {
    const allocaReg = this.ctx.nextTemp();
    const llvmValueType = this.tsTypeToLlvm(mapTypeInfo.valueType);

    this.ctx.defineVariable(stmt.name, allocaReg, '%StringMap*', SymbolKind.Map, 'local', {
      mapMetadata: {
        keyType: 'string',
        valueType: mapTypeInfo.valueType,
        llvmKeyType: 'i8*',
        llvmValueType
      }
    });
    this.ctx.emit(`${allocaReg} = alloca %StringMap`);

    this.ctx.currentDeclaredMapType = stmt.declaredType;
    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.currentDeclaredMapType = undefined;

    const loadedMap = this.ctx.nextTemp();
    this.ctx.emit(`${loadedMap} = load %StringMap, %StringMap* ${value}`);
    this.ctx.emit(`store %StringMap ${loadedMap}, %StringMap* ${allocaReg}`);
  }

  private parseMapType(declaredType: string | undefined): { keyType: string; valueType: string } | null {
    if (!declaredType) return null;

    const match = declaredType.match(/^Map<\s*(\w+)\s*,\s*(\w+)\s*>$/);
    if (!match) return null;

    return {
      keyType: match[1],
      valueType: match[2]
    };
  }

  private parseSetType(declaredType: string | undefined): { valueType: string } | null {
    if (!declaredType) return null;

    const match = declaredType.match(/^Set<\s*(\w+)\s*>$/);
    if (!match) return null;

    return {
      valueType: match[1]
    };
  }

  private allocateSet(stmt: VariableDeclaration, params: string[]): void {
    const setTypeInfo = this.parseSetType(stmt.declaredType);

    if (setTypeInfo && setTypeInfo.valueType === 'string') {
      this.allocateStringSet(stmt, params, setTypeInfo);
    } else {
      const allocaReg = this.ctx.nextTemp();
      this.ctx.defineVariable(stmt.name, allocaReg, '%Set*', SymbolKind.Set, 'local');
      this.ctx.emit(`${allocaReg} = alloca %Set`);

      const value = this.ctx.generateExpression(stmt.value!, params);
      const loadedSet = this.ctx.nextTemp();
      this.ctx.emit(`${loadedSet} = load %Set, %Set* ${value}`);
      this.ctx.emit(`store %Set ${loadedSet}, %Set* ${allocaReg}`);
    }
  }

  private allocateStringSet(stmt: VariableDeclaration, params: string[], setTypeInfo: { valueType: string }): void {
    const allocaReg = this.ctx.nextTemp();
    const llvmValueType = this.tsTypeToLlvm(setTypeInfo.valueType);

    this.ctx.defineVariable(stmt.name, allocaReg, '%StringSet*', SymbolKind.Set, 'local', {
      setMetadata: {
        valueType: 'string',
        llvmValueType
      }
    });
    this.ctx.emit(`${allocaReg} = alloca %StringSet`);

    this.ctx.currentDeclaredSetType = stmt.declaredType;
    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.currentDeclaredSetType = undefined;

    const loadedSet = this.ctx.nextTemp();
    this.ctx.emit(`${loadedSet} = load %StringSet, %StringSet* ${value}`);
    this.ctx.emit(`store %StringSet ${loadedSet}, %StringSet* ${allocaReg}`);
  }

  private allocateStringArray(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextTemp();
    this.ctx.defineVariable(stmt.name, allocaReg, '%StringArray*', SymbolKind.StringArray, 'local');
    this.ctx.emit(`${allocaReg} = alloca %StringArray`);

    const value = this.ctx.generateExpression(stmt.value!, params);
    const loadedStringArray = this.ctx.nextTemp();
    this.ctx.emit(`${loadedStringArray} = load %StringArray, %StringArray* ${value}`);
    this.ctx.emit(`store %StringArray ${loadedStringArray}, %StringArray* ${allocaReg}`);
  }

  private allocateArray(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextTemp();
    this.ctx.defineVariable(stmt.name, allocaReg, '%Array*', SymbolKind.Array, 'local');
    this.ctx.emit(`${allocaReg} = alloca %Array`);

    const value = this.ctx.generateExpression(stmt.value!, params);
    const loadedArray = this.ctx.nextTemp();
    this.ctx.emit(`${loadedArray} = load %Array, %Array* ${value}`);
    this.ctx.emit(`store %Array ${loadedArray}, %Array* ${allocaReg}`);
  }

  private allocateRegex(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextTemp();
    this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.Regex, 'local');
    this.ctx.emit(`${allocaReg} = alloca i8*`);

    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${value}, i8** ${allocaReg}`);
  }

  private allocateString(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextTemp();
    this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.String, 'local');
    this.ctx.emit(`${allocaReg} = alloca i8*`);

    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${value}, i8** ${allocaReg}`);
  }

  private allocateNumeric(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextTemp();
    this.ctx.defineVariable(stmt.name, allocaReg, 'double', SymbolKind.Number, 'local');
    this.ctx.emit(`${allocaReg} = alloca double`);

    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store double ${value}, double* ${allocaReg}`);
  }

  private allocateArrowFunction(stmt: VariableDeclaration, params: string[]): void {
    const arrowFuncGen = this.ctx.exprGen.getArrowFunctionGenerator();
    const scopeVars = this.ctx.symbolTable.getScopeVarsForClosure();
    const lambdaName = arrowFuncGen.generateArrowFunction(stmt.value, params, undefined, scopeVars);

    const closureInfo = arrowFuncGen.getClosureInfoForLambda(lambdaName);

    if (closureInfo && closureInfo.captures.length > 0) {
      const structSize = closureInfo.captures.length * 8;
      const envMemReg = this.ctx.nextTemp();
      this.ctx.emit(`${envMemReg} = call i8* @GC_malloc(i64 ${structSize})`);

      const envTypedReg = this.ctx.nextTemp();
      this.ctx.emit(`${envTypedReg} = bitcast i8* ${envMemReg} to ${closureInfo.envStructName}*`);

      for (let i = 0; i < closureInfo.captures.length; i++) {
        const capture = closureInfo.captures[i];
        const allocaReg = this.ctx.symbolTable.getAlloca(capture.name);
        if (!allocaReg) {
          throw new Error(`Closure capture error: variable '${capture.name}' not found`);
        }

        const valueReg = this.ctx.nextTemp();
        this.ctx.emit(`${valueReg} = load ${capture.llvmType}, ${capture.llvmType}* ${allocaReg}`);

        const fieldPtr = this.ctx.nextTemp();
        this.ctx.emit(`${fieldPtr} = getelementptr ${closureInfo.envStructName}, ${closureInfo.envStructName}* ${envTypedReg}, i32 0, i32 ${i}`);

        this.ctx.emit(`store ${capture.llvmType} ${valueReg}, ${capture.llvmType}* ${fieldPtr}`);
      }

      this.ctx.defineVariable(stmt.name, envTypedReg, 'i8*', SymbolKind.Closure, 'local', {
        closureMetadata: {
          lambdaName,
          envStructName: closureInfo.envStructName,
          envPtrRegister: envMemReg,
          captures: closureInfo.captures
        }
      });
    } else {
      const allocaReg = this.ctx.nextTemp();
      this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.Closure, 'local', {
        closureMetadata: {
          lambdaName,
          envStructName: '',
          envPtrRegister: 'null',
          captures: []
        }
      });
    }
  }

  private getIndexedObjectArrayType(expr: Expression | null): { keys: string[]; types: string[]; tsTypes: string[] } | null {
    if (!expr || expr.type !== 'index_access') return null;

    const indexExpr = expr as IndexAccessNode;
    if (indexExpr.object.type !== 'member_access') return null;

    const memberAccess = indexExpr.object as MemberAccessNode;
    const propertyName = memberAccess.property;

    let objectMeta: ObjectMetadata | undefined;

    if (memberAccess.object.type === 'variable') {
      const varName = (memberAccess.object as VariableNode).name;
      objectMeta = this.ctx.symbolTable.getObjectInfo(varName);
    } else if (memberAccess.object.type === 'member_access') {
      const elementType = this.resolveNestedMemberArrayType(memberAccess);
      if (elementType) {
        return this.getTypeInfoForElementType(elementType);
      }
      return null;
    }

    if (!objectMeta) return null;

    const propIndex = objectMeta.keys.indexOf(propertyName);
    if (propIndex === -1) return null;

    const propTsType = objectMeta.tsTypes?.[propIndex];
    if (!propTsType) return null;

    const arrayMatch = propTsType.match(/^(.+)\[\]$/);
    if (!arrayMatch) return null;

    const elementType = arrayMatch[1];
    return this.getTypeInfoForElementType(elementType);
  }

  private resolveNestedMemberArrayType(memberAccess: MemberAccessNode): string | null {
    if (memberAccess.object.type !== 'member_access') return null;

    const outerMember = memberAccess.object as MemberAccessNode;
    const outerProp = outerMember.property;
    const arrayProp = memberAccess.property;

    let baseVarName: string | null = null;
    if (outerMember.object.type === 'variable') {
      baseVarName = (outerMember.object as VariableNode).name;
    } else if (outerMember.object.type === 'this') {
      baseVarName = 'this';
    }

    if (!baseVarName) return null;

    let outerMeta: ObjectMetadata | undefined;
    if (baseVarName === 'this') {
      const classFieldInfo = this.getThisFieldInfo(outerProp);
      if (classFieldInfo?.tsType) {
        const interfaceDef = this.ctx.ast.interfaces?.find((i: InterfaceDeclaration) => i.name === classFieldInfo.tsType);
        if (interfaceDef) {
          outerMeta = {
            keys: interfaceDef.fields.map((f) => f.name),
            types: interfaceDef.fields.map((f) => this.tsTypeToLlvm(f.type)),
            tsTypes: interfaceDef.fields.map((f) => f.type)
          };
        }
      }
    } else {
      outerMeta = this.ctx.symbolTable.getObjectInfo(baseVarName);
    }

    if (!outerMeta) return null;

    const arrayPropIndex = outerMeta.keys.indexOf(arrayProp);
    if (arrayPropIndex === -1) return null;

    const arrayPropType = outerMeta.tsTypes?.[arrayPropIndex];
    if (!arrayPropType) return null;

    const arrayMatch = arrayPropType.match(/^(.+)\[\]$/);
    if (!arrayMatch) return null;

    return arrayMatch[1];
  }

  private getThisFieldInfo(fieldName: string): { tsType?: string } | null {
    if (!this.ctx.currentClassName) return null;
    return this.ctx.classGen.getFieldInfo(this.ctx.currentClassName, fieldName);
  }

  private getTypeInfoForElementType(elementType: string): { keys: string[]; types: string[]; tsTypes: string[] } | null {

    const interfaceDef = this.ctx.ast.interfaces?.find((i: InterfaceDeclaration) => i.name === elementType);
    if (interfaceDef) {
      return {
        keys: interfaceDef.fields.map((f) => f.name),
        types: interfaceDef.fields.map((f) => this.tsTypeToLlvm(f.type)),
        tsTypes: interfaceDef.fields.map((f) => f.type)
      };
    }

    const typeAlias = this.ctx.ast.typeAliases?.find((t: TypeAliasDeclaration) => t.name === elementType);
    if (typeAlias && typeAlias.unionMembers) {
      const commonFields = this.getUnionCommonFields(typeAlias.unionMembers);
      if (commonFields.keys.length > 0) {
        return commonFields;
      }
    }

    return null;
  }

  private getUnionCommonFields(memberNames: string[]): { keys: string[]; types: string[]; tsTypes: string[] } {
    if (this.ctx.typeResolver) {
      return this.ctx.typeResolver.getUnionCommonFields(memberNames);
    }
    const interfaces = memberNames
      .map(name => this.ctx.ast.interfaces?.find((i: InterfaceDeclaration) => i.name === name))
      .filter((i): i is InterfaceDeclaration => i !== undefined);

    if (interfaces.length === 0) {
      return { keys: [], types: [], tsTypes: [] };
    }

    const firstFields = interfaces[0].fields;
    const commonFields: { name: string; type: string }[] = [];

    for (const field of firstFields) {
      const isCommon = interfaces.every((iface) =>
        iface.fields.some((f) => f.name === field.name && this.areTypesCompatible(f.type, field.type))
      );
      if (isCommon) {
        commonFields.push({ name: field.name, type: this.normalizeType(field.type) });
      }
    }

    return {
      keys: commonFields.map((f) => f.name),
      types: commonFields.map((f) => this.tsTypeToLlvm(f.type)),
      tsTypes: commonFields.map((f) => f.type)
    };
  }

  private areTypesCompatible(type1: string, type2: string): boolean {
    if (this.ctx.typeResolver) {
      return this.ctx.typeResolver.areTypesCompatible(type1, type2);
    }
    if (type1 === type2) return true;
    const norm1 = this.normalizeType(type1);
    const norm2 = this.normalizeType(type2);
    return norm1 === norm2;
  }

  private normalizeType(type: string): string {
    if (this.ctx.typeResolver) {
      return this.ctx.typeResolver.normalizeType(type);
    }
    if (type.startsWith("'") && type.endsWith("'")) return 'string';
    if (type.startsWith('"') && type.endsWith('"')) return 'string';
    return type;
  }

  private allocateIndexedObjectArray(stmt: VariableDeclaration, params: string[], typeInfo: { keys: string[]; types: string[]; tsTypes: string[] }): void {
    const allocaReg = this.ctx.nextTemp();
    this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.Object, 'local', {
      objectMetadata: { keys: typeInfo.keys, types: typeInfo.types, tsTypes: typeInfo.tsTypes }
    });
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    const objPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${objPtr}, i8** ${allocaReg}`);
  }

  private tsTypeToLlvm(tsType: string): string {
    if (this.ctx.typeResolver) {
      return this.ctx.typeResolver.tsTypeToLlvm(tsType);
    }
    if (tsType === 'string') return 'i8*';
    if (tsType === 'number') return 'double';
    if (tsType === 'boolean') return 'i1';
    if (tsType === 'string[]') return '%StringArray*';
    if (tsType === 'number[]' || tsType === 'boolean[]') return '%Array*';
    return 'i8*';
  }

  private tsTypeToLlvmJson(tsType: string): string {
    if (this.ctx.typeResolver) {
      return this.ctx.typeResolver.tsTypeToLlvmJson(tsType);
    }
    if (tsType === 'string') return 'i8*';
    if (tsType === 'number') return 'double';
    if (tsType === 'boolean') return 'double';
    if (tsType === 'string[]') return '%StringArray*';
    if (tsType === 'number[]') return '%Array*';
    return 'i8*';
  }
}
