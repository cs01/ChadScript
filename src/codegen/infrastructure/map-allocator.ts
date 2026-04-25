import {
  Expression,
  VariableDeclaration,
  InterfaceDeclaration,
  InterfaceField,
  MethodCallNode,
  MemberAccessNode,
  VariableNode,
  SetNode,
  NewNode,
  MapNode,
  SourceLocation,
} from "../../ast/types.js";
import { InterfaceAllocator } from "./interface-allocator.js";
import {
  SymbolKind_Map,
  SymbolKind_Set,
  SymbolKind_Array,
  SymbolKind_StringArray,
  SymbolKind_ObjectArray,
  SymbolKind_Object,
  SymbolTable,
  SymbolMetadata,
  createMapMetadataSymbol,
  createSetMetadataSymbol,
  createObjectMetadataWithInterface,
  createInterfacePointerAllocaMetadata,
} from "./symbol-table.js";
import {
  stripOptional,
  parseMapTypeString,
  parseSetTypeString,
  isAnyArrayTsType,
} from "./type-system.js";
import type { FieldInfo } from "./type-resolver/types.js";
import type { ResolvedType } from "./type-system.js";

interface ExprBase {
  type: string;
}

interface MapTypeInfo {
  keyType: string;
  valueType: string;
}

interface SetTypeInfo {
  valueType: string;
}

export interface MapAllocatorContext {
  nextTemp(): string;
  nextAllocaReg(varName: string): string;
  emit(instruction: string): void;
  defineVariable(
    name: string,
    allocaReg: string,
    llvmType: string,
    kind: number,
    scope: string,
  ): void;
  defineVariableWithMetadata(
    name: string,
    allocaReg: string,
    llvmType: string,
    kind: number,
    scope: string,
    metadata: SymbolMetadata,
  ): void;
  generateExpression(expr: Expression, params: string[]): string;
  typeOf(expr: Expression): ResolvedType | null;
  setCurrentDeclaredMapType(type: string | undefined): void;
  setCurrentDeclaredSetType(type: string | undefined): void;
  getCurrentClassName(): string | null;
  hasClassGen(): boolean;
  classGenGetFieldInfo(className: string | null, fieldName: string | null): FieldInfo | null;
  readonly symbolTable: SymbolTable;
  emitError(message: string, loc?: SourceLocation, suggestion?: string): never;
}

export class MapAllocator {
  private ctx: MapAllocatorContext;
  private interfaceAlloc: InterfaceAllocator;

  constructor(ctx: MapAllocatorContext, interfaceAlloc: InterfaceAllocator) {
    this.ctx = ctx;
    this.interfaceAlloc = interfaceAlloc;
  }

  allocateMap(stmt: VariableDeclaration, params: string[]): void {
    let mapTypeInfoResult = this.parseMapType(stmt.declaredType);

    if (!mapTypeInfoResult && stmt.value && stmt.value.type === "map") {
      const mapNode = stmt.value as MapNode;
      if (mapNode.keyType && mapNode.valueType) {
        mapTypeInfoResult = { keyType: mapNode.keyType, valueType: mapNode.valueType };
      }
    }

    if (!mapTypeInfoResult && stmt.value && stmt.value.type === "new") {
      const newNode = stmt.value as NewNode;
      if (newNode.className === "Map" && newNode.typeArgs && newNode.typeArgs.length === 2) {
        mapTypeInfoResult = { keyType: newNode.typeArgs[0], valueType: newNode.typeArgs[1] };
      }
    }

    if (
      !mapTypeInfoResult &&
      stmt.value &&
      stmt.value.type !== "new" &&
      stmt.value.type !== "map"
    ) {
      const resolved = this.ctx.typeOf(stmt.value);
      if (resolved && resolved.base.startsWith("Map<")) {
        mapTypeInfoResult = this.parseMapType(resolved.base);
      }
    }

    if (mapTypeInfoResult) {
      const mapTypeInfo = mapTypeInfoResult as MapTypeInfo;
      if (mapTypeInfo.keyType === "string") {
        this.allocateStringMap(stmt, params, mapTypeInfo);
        return;
      }
      if (mapTypeInfo.keyType !== "number") {
        this.allocatePointerMap(stmt, params, mapTypeInfo);
        return;
      }
      if (mapTypeInfo.valueType !== "number" && mapTypeInfo.valueType !== "boolean") {
        this.ctx.emitError(
          `Map<number, ${mapTypeInfo.valueType}> is not supported. Use Map<string, ${mapTypeInfo.valueType}> instead`,
          stmt.loc,
        );
        return;
      }
    }
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariable(stmt.name, allocaReg, "%Map*", SymbolKind_Map, "local");
    const mapSizePtr = this.ctx.nextTemp();
    this.ctx.emit(`${mapSizePtr} = getelementptr %Map, %Map* null, i32 1`);
    const mapSizeI64 = this.ctx.nextTemp();
    this.ctx.emit(`${mapSizeI64} = ptrtoint %Map* ${mapSizePtr} to i64`);
    const mapMem = this.ctx.nextTemp();
    this.ctx.emit(`${mapMem} = call i8* @GC_malloc(i64 ${mapSizeI64})`);
    this.ctx.emit(`${allocaReg} = bitcast i8* ${mapMem} to %Map*`);

    const value = this.ctx.generateExpression(stmt.value!, params);
    const loadedMap = this.ctx.nextTemp();
    this.ctx.emit(`${loadedMap} = load %Map, %Map* ${value}`);
    this.ctx.emit(`store %Map ${loadedMap}, %Map* ${allocaReg}`);
  }

  private allocateStringMap(
    stmt: VariableDeclaration,
    params: string[],
    mapTypeInfo: MapTypeInfo,
  ): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const llvmValueType = this.interfaceAlloc.convertTsType(mapTypeInfo.valueType);

    this.ctx.defineVariableWithMetadata(
      stmt.name,
      allocaReg,
      "%StringMap*",
      SymbolKind_Map,
      "local",
      createMapMetadataSymbol({
        keyType: "string",
        valueType: mapTypeInfo.valueType,
        llvmKeyType: "i8*",
        llvmValueType,
      }),
    );
    const strMapSizePtr = this.ctx.nextTemp();
    this.ctx.emit(`${strMapSizePtr} = getelementptr %StringMap, %StringMap* null, i32 1`);
    const strMapSizeI64 = this.ctx.nextTemp();
    this.ctx.emit(`${strMapSizeI64} = ptrtoint %StringMap* ${strMapSizePtr} to i64`);
    const strMapMem = this.ctx.nextTemp();
    this.ctx.emit(`${strMapMem} = call i8* @GC_malloc(i64 ${strMapSizeI64})`);
    this.ctx.emit(`${allocaReg} = bitcast i8* ${strMapMem} to %StringMap*`);

    const declaredMapType =
      stmt.declaredType || `Map<${mapTypeInfo.keyType}, ${mapTypeInfo.valueType}>`;
    this.ctx.setCurrentDeclaredMapType(declaredMapType);
    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.setCurrentDeclaredMapType(undefined);

    const loadedMap = this.ctx.nextTemp();
    this.ctx.emit(`${loadedMap} = load %StringMap, %StringMap* ${value}`);
    this.ctx.emit(`store %StringMap ${loadedMap}, %StringMap* ${allocaReg}`);
  }

  private allocatePointerMap(
    stmt: VariableDeclaration,
    params: string[],
    mapTypeInfo: MapTypeInfo,
  ): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);

    this.ctx.defineVariableWithMetadata(
      stmt.name,
      allocaReg,
      "%StringMap*",
      SymbolKind_Map,
      "local",
      createMapMetadataSymbol({
        keyType: mapTypeInfo.keyType,
        valueType: mapTypeInfo.valueType,
        llvmKeyType: "i8*",
        llvmValueType: "i8*",
      }),
    );
    const ptrMapSizePtr = this.ctx.nextTemp();
    this.ctx.emit(`${ptrMapSizePtr} = getelementptr %StringMap, %StringMap* null, i32 1`);
    const ptrMapSizeI64 = this.ctx.nextTemp();
    this.ctx.emit(`${ptrMapSizeI64} = ptrtoint %StringMap* ${ptrMapSizePtr} to i64`);
    const ptrMapMem = this.ctx.nextTemp();
    this.ctx.emit(`${ptrMapMem} = call i8* @GC_malloc(i64 ${ptrMapSizeI64})`);
    this.ctx.emit(`${allocaReg} = bitcast i8* ${ptrMapMem} to %StringMap*`);

    const declaredMapType =
      stmt.declaredType || `Map<${mapTypeInfo.keyType}, ${mapTypeInfo.valueType}>`;
    this.ctx.setCurrentDeclaredMapType(declaredMapType);
    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.setCurrentDeclaredMapType(undefined);

    const loadedMap = this.ctx.nextTemp();
    this.ctx.emit(`${loadedMap} = load %StringMap, %StringMap* ${value}`);
    this.ctx.emit(`store %StringMap ${loadedMap}, %StringMap* ${allocaReg}`);
  }

  parseMapType(declaredType: string | undefined): MapTypeInfo | null {
    if (!declaredType) return null;

    const parsed = parseMapTypeString(declaredType);
    if (!parsed) return null;

    return {
      keyType: parsed.keyType,
      valueType: parsed.valueType,
    };
  }

  parseSetType(declaredType: string | undefined): SetTypeInfo | null {
    if (!declaredType) return null;

    const parsed = parseSetTypeString(declaredType);
    if (!parsed) return null;

    return {
      valueType: parsed.valueType,
    };
  }

  allocateSet(stmt: VariableDeclaration, params: string[]): void {
    let setTypeInfoResult = this.parseSetType(stmt.declaredType);

    if (!setTypeInfoResult && stmt.value) {
      const valueBase = stmt.value as { type: string };
      if (valueBase.type === "new") {
        const newExpr = stmt.value as {
          type: string;
          className: string;
          args: Expression[];
          typeArgs?: string[];
        };
        if (newExpr.className === "Set" && newExpr.typeArgs && newExpr.typeArgs.length > 0) {
          setTypeInfoResult = { valueType: newExpr.typeArgs[0] };
        }
      } else if (valueBase.type === "set") {
        const setExpr = stmt.value as SetNode;
        if (setExpr.valueType) {
          setTypeInfoResult = { valueType: setExpr.valueType };
        }
      }
    }

    if (
      !setTypeInfoResult &&
      stmt.value &&
      stmt.value.type !== "new" &&
      stmt.value.type !== "set"
    ) {
      const resolved = this.ctx.typeOf(stmt.value);
      if (resolved && resolved.base.startsWith("Set<")) {
        setTypeInfoResult = this.parseSetType(resolved.base);
      }
    }

    if (setTypeInfoResult) {
      const setTypeInfo = setTypeInfoResult as SetTypeInfo;
      if (setTypeInfo.valueType === "string") {
        this.allocateStringSet(stmt, params, setTypeInfo);
        return;
      }
    }
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariable(stmt.name, allocaReg, "%Set*", SymbolKind_Set, "local");
    const setSizePtr = this.ctx.nextTemp();
    this.ctx.emit(`${setSizePtr} = getelementptr %Set, %Set* null, i32 1`);
    const setSizeI64 = this.ctx.nextTemp();
    this.ctx.emit(`${setSizeI64} = ptrtoint %Set* ${setSizePtr} to i64`);
    const setMem = this.ctx.nextTemp();
    this.ctx.emit(`${setMem} = call i8* @GC_malloc(i64 ${setSizeI64})`);
    this.ctx.emit(`${allocaReg} = bitcast i8* ${setMem} to %Set*`);

    const value = this.ctx.generateExpression(stmt.value!, params);
    const loadedSet = this.ctx.nextTemp();
    this.ctx.emit(`${loadedSet} = load %Set, %Set* ${value}`);
    this.ctx.emit(`store %Set ${loadedSet}, %Set* ${allocaReg}`);
  }

  private allocateStringSet(
    stmt: VariableDeclaration,
    params: string[],
    setTypeInfo: SetTypeInfo,
  ): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const llvmValueType = this.interfaceAlloc.convertTsType(setTypeInfo.valueType);

    this.ctx.defineVariableWithMetadata(
      stmt.name,
      allocaReg,
      "%StringSet*",
      SymbolKind_Set,
      "local",
      createSetMetadataSymbol({
        valueType: "string",
        llvmValueType,
      }),
    );
    const strSetSizePtr = this.ctx.nextTemp();
    this.ctx.emit(`${strSetSizePtr} = getelementptr %StringSet, %StringSet* null, i32 1`);
    const strSetSizeI64 = this.ctx.nextTemp();
    this.ctx.emit(`${strSetSizeI64} = ptrtoint %StringSet* ${strSetSizePtr} to i64`);
    const strSetMem = this.ctx.nextTemp();
    this.ctx.emit(`${strSetMem} = call i8* @GC_malloc(i64 ${strSetSizeI64})`);
    this.ctx.emit(`${allocaReg} = bitcast i8* ${strSetMem} to %StringSet*`);

    this.ctx.setCurrentDeclaredSetType(stmt.declaredType);
    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.setCurrentDeclaredSetType(undefined);

    const loadedSet = this.ctx.nextTemp();
    this.ctx.emit(`${loadedSet} = load %StringSet, %StringSet* ${value}`);
    this.ctx.emit(`store %StringSet ${loadedSet}, %StringSet* ${allocaReg}`);
  }

  getMapGetInterfaceType(expr: Expression): string | null {
    if (!expr || expr.type !== "method_call") return null;
    const methodExpr = expr as MethodCallNode;
    if (methodExpr.method !== "get") return null;

    let valueType: string | null = null;

    if (methodExpr.object && methodExpr.object.type === "variable") {
      const varObj = methodExpr.object as VariableNode;
      const mapName = varObj.name;
      if (!this.ctx.symbolTable.isMap(mapName)) return null;

      const mapMeta = this.ctx.symbolTable.getMapMetadata(mapName);
      if (!mapMeta) return null;
      if (mapMeta.keyType !== "string") return null;

      valueType = mapMeta.valueType;
    } else if (methodExpr.object && methodExpr.object.type === "member_access") {
      const memberExpr = methodExpr.object as MemberAccessNode;
      const memberExprObjBase = memberExpr.object as ExprBase;
      if (memberExprObjBase.type !== "this") return null;
      if (!this.ctx.getCurrentClassName()) return null;

      const fieldInfoResult = this.ctx.classGenGetFieldInfo(
        this.ctx.getCurrentClassName()!,
        memberExpr.property,
      );
      if (!fieldInfoResult) return null;
      const fieldInfo = fieldInfoResult as FieldInfo;
      if (!fieldInfo.tsType) return null;

      const mapParsed = parseMapTypeString(fieldInfo.tsType);
      if (!mapParsed) return null;
      if (mapParsed.keyType !== "string") return null;

      valueType = mapParsed.valueType;
    }

    if (!valueType) return null;
    if (valueType === "string" || valueType === "number" || valueType === "boolean") return null;

    if (isAnyArrayTsType(valueType)) {
      return valueType;
    }

    const interfaceDefResult = this.interfaceAlloc.getInterface(valueType);
    if (!interfaceDefResult) return null;

    return valueType;
  }

  allocateMapGetInterface(
    stmt: VariableDeclaration,
    params: string[],
    interfaceName: string,
  ): void {
    if (isAnyArrayTsType(interfaceName)) {
      this.allocateMapGetArray(stmt, params, interfaceName);
      return;
    }
    const interfaceDefResult = this.interfaceAlloc.getInterface(interfaceName);
    if (!interfaceDefResult) {
      return this.ctx.emitError(
        `interface '${interfaceName}' not found when allocating Map.get() return variable '${stmt.name}'`,
      );
    }
    const interfaceDef = interfaceDefResult as InterfaceDeclaration;
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const keys: string[] = [];
    const types: string[] = [];
    const tsTypes: string[] = [];
    const allFields = this.interfaceAlloc.getAllInterfaceFields(interfaceDef);
    for (let i = 0; i < allFields.length; i++) {
      const field = allFields[i] as { name: string; type: string };
      keys.push(stripOptional(field.name));
      types.push(this.interfaceAlloc.convertTsType(field.type));
      tsTypes.push(field.type);
    }
    const llvmType = `%${interfaceName}*`;
    this.ctx.defineVariableWithMetadata(
      stmt.name,
      allocaReg,
      llvmType,
      SymbolKind_Object,
      "local",
      createObjectMetadataWithInterface({ keys, types, tsTypes }, interfaceName),
    );
    this.ctx.emit(`${allocaReg} = alloca ${llvmType}`);
    const objPtr = this.ctx.generateExpression(stmt.value!, params);
    const typedPtr = this.ctx.nextTemp();
    this.ctx.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${llvmType}`);
    this.ctx.emit(`store ${llvmType} ${typedPtr}, ${llvmType}* ${allocaReg}`);
  }

  private allocateMapGetArray(
    stmt: VariableDeclaration,
    params: string[],
    arrayType: string,
  ): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const elementType = arrayType.slice(0, -2);
    if (elementType === "string") {
      this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind_StringArray, "local");
    } else if (elementType === "number" || elementType === "boolean") {
      this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind_Array, "local");
    } else {
      const typeInfo = this.interfaceAlloc.getTypeInfoForElementType(elementType);
      if (typeInfo) {
        this.ctx.defineVariableWithMetadata(
          stmt.name,
          allocaReg,
          "i8*",
          SymbolKind_ObjectArray,
          "local",
          createObjectMetadataWithInterface(
            { keys: typeInfo.keys, types: typeInfo.types, tsTypes: typeInfo.tsTypes },
            elementType,
          ),
        );
      } else {
        this.ctx.defineVariableWithMetadata(
          stmt.name,
          allocaReg,
          "i8*",
          SymbolKind_ObjectArray,
          "local",
          createInterfacePointerAllocaMetadata(elementType),
        );
      }
    }
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    const objPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${objPtr}, i8** ${allocaReg}`);
  }

  getMapGetClassName(methodExpr: MethodCallNode): string | null {
    if (methodExpr.method !== "get") return null;
    const methodObjBase = methodExpr.object as ExprBase;
    if (methodObjBase.type === "variable") {
      const varName = (methodExpr.object as VariableNode).name;
      if (this.ctx.symbolTable.isMap(varName)) {
        const mapMeta = this.ctx.symbolTable.getMapMetadata(varName);
        if (mapMeta && mapMeta.valueType) {
          return mapMeta.valueType;
        }
      }
    } else if (methodObjBase.type === "member_access") {
      const memberExpr = methodExpr.object as MemberAccessNode;
      const memberExprObjBase = memberExpr.object as ExprBase;
      if (
        memberExprObjBase.type === "this" &&
        this.ctx.getCurrentClassName() &&
        this.ctx.hasClassGen()
      ) {
        const fieldInfoResult = this.ctx.classGenGetFieldInfo(
          this.ctx.getCurrentClassName()!,
          memberExpr.property,
        );
        const fieldInfo = fieldInfoResult as FieldInfo;
        if (fieldInfoResult && fieldInfo.tsType) {
          const mapParsed = parseMapTypeString(fieldInfo.tsType);
          if (mapParsed && mapParsed.valueType) {
            return mapParsed.valueType;
          }
        }
      }
    }
    return null;
  }
}
