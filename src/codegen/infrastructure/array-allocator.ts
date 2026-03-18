import {
  Expression,
  AST,
  VariableDeclaration,
  InterfaceDeclaration,
  InterfaceField,
  ObjectNode,
  ArrayNode,
  IndexAccessNode,
  MemberAccessNode,
  VariableNode,
  MethodCallNode,
  SourceLocation,
} from "../../ast/types.js";
import {
  SymbolKind_Array,
  SymbolKind_StringArray,
  SymbolKind_ObjectArray,
  SymbolKind_Object,
  SymbolKind_Uint8Array,
  SymbolTable,
  SymbolMetadata,
  createPointerAllocaMetadata,
  createObjectMetadata,
  createObjectMetadataWithInterface,
} from "./symbol-table.js";
import { stripOptional, parseArrayTypeString } from "./type-system.js";
import type { FieldInfo } from "./type-resolver/types.js";
import type { UnionCommonFields } from "./type-resolver/index.js";

interface ExprBase {
  type: string;
}

export interface ArrayAllocatorContext {
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
  getVariableType(name: string): string | undefined;
  getObjectArrayElementType(expr: Expression): string | null;
  setWantsBinaryReturn(value: boolean): void;
  getCurrentClassName(): string | null;
  getParameterTypeFromAST(paramName: string): string | null;
  classGenGetFieldInfo(className: string | null, fieldName: string | null): FieldInfo | null;
  typeResolverResolveArrayMethodReturnType(
    expr: Expression,
  ): { keys: string[]; types: string[]; tsTypes?: string[] } | null;
  readonly symbolTable: SymbolTable;
  emitError(message: string, loc?: SourceLocation, suggestion?: string): never;
  getAst(): AST | undefined;
}

export interface ArrayAllocatorDelegate {
  isKnownClass(name: string): boolean;
  convertTsType(tsType: string): string;
  getInterface(name: string): InterfaceDeclaration | null;
  getAllInterfaceFields(iface: InterfaceDeclaration): InterfaceField[];
  getTypeInfoForElementType(
    elementType: string,
  ): { keys: string[]; types: string[]; tsTypes: string[] } | null;
  getInterfaceFieldTypeByName(interfaceName: string, fieldName: string): string | null;
  parseInlineObjectType(typeStr: string): InterfaceField[] | null;
}

export class ArrayAllocator {
  private ctx: ArrayAllocatorContext;
  private delegate: ArrayAllocatorDelegate;

  constructor(ctx: ArrayAllocatorContext, delegate: ArrayAllocatorDelegate) {
    this.ctx = ctx;
    this.delegate = delegate;
  }

  allocateStringArray(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariableWithMetadata(
      stmt.name,
      allocaReg,
      "%StringArray*",
      SymbolKind_StringArray,
      "local",
      createPointerAllocaMetadata(),
    );
    this.ctx.emit(`${allocaReg} = alloca %StringArray*`);

    const value = this.ctx.generateExpression(stmt.value!, params);
    const valueType = this.ctx.getVariableType(value);
    let pointerValue = value;
    if (valueType === "i32") {
      const ptrValue = this.ctx.nextTemp();
      this.ctx.emit(`${ptrValue} = inttoptr i32 ${value} to %StringArray*`);
      pointerValue = ptrValue;
    } else if (valueType !== "%StringArray*") {
      const typedPtr = this.ctx.nextTemp();
      this.ctx.emit(`${typedPtr} = bitcast i8* ${pointerValue} to %StringArray*`);
      pointerValue = typedPtr;
    }
    this.ctx.emit(`store %StringArray* ${pointerValue}, %StringArray** ${allocaReg}`);
  }

  allocateArray(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariableWithMetadata(
      stmt.name,
      allocaReg,
      "%Array*",
      SymbolKind_Array,
      "local",
      createPointerAllocaMetadata(),
    );
    this.ctx.emit(`${allocaReg} = alloca %Array*`);

    const value = this.ctx.generateExpression(stmt.value!, params);
    const valueType = this.ctx.getVariableType(value);
    let pointerValue = value;
    if (valueType !== "%Array*") {
      const typedPtr = this.ctx.nextTemp();
      this.ctx.emit(`${typedPtr} = bitcast i8* ${pointerValue} to %Array*`);
      pointerValue = typedPtr;
    }
    this.ctx.emit(`store %Array* ${pointerValue}, %Array** ${allocaReg}`);
  }

  allocateUint8Array(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariable(stmt.name, allocaReg, "%Uint8Array*", SymbolKind_Uint8Array, "local");
    this.ctx.emit(`${allocaReg} = alloca %Uint8Array*`);

    this.ctx.setWantsBinaryReturn(true);
    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.setWantsBinaryReturn(false);
    this.ctx.emit(`store %Uint8Array* ${value}, %Uint8Array** ${allocaReg}`);
  }

  allocateObjectArray(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);

    let elementType = this.ctx.getObjectArrayElementType(stmt.value!);
    if (!elementType && stmt.declaredType && stmt.declaredType.endsWith("[]")) {
      elementType = stmt.declaredType.slice(0, -2);
    }

    if (elementType) {
      const typeInfo = this.delegate.getTypeInfoForElementType(elementType);
      if (typeInfo) {
        this.ctx.defineVariableWithMetadata(
          stmt.name,
          allocaReg,
          "%ObjectArray*",
          SymbolKind_ObjectArray,
          "local",
          createObjectMetadataWithInterface(
            {
              keys: typeInfo.keys,
              types: typeInfo.types,
              tsTypes: typeInfo.tsTypes,
            },
            elementType,
          ),
        );
        this.ctx.symbolTable.setRawInterfaceType(stmt.name, elementType);
        this.ctx.symbolTable.setObjectArrayMetadata(stmt.name, {
          elementInterfaceName: elementType,
          elementKeys: typeInfo.keys,
          elementTypes: typeInfo.types,
          elementTsTypes: typeInfo.tsTypes,
        });
        this.ctx.emit(`${allocaReg} = alloca %ObjectArray*`);
        const value = this.ctx.generateExpression(stmt.value!, params);
        this.ctx.emit(`store %ObjectArray* ${value}, %ObjectArray** ${allocaReg}`);
        return;
      }
      if (this.delegate.isKnownClass(elementType)) {
        this.ctx.defineVariable(
          stmt.name,
          allocaReg,
          "%ObjectArray*",
          SymbolKind_ObjectArray,
          "local",
        );
        this.ctx.symbolTable.setRawInterfaceType(stmt.name, elementType);
        this.ctx.emit(`${allocaReg} = alloca %ObjectArray*`);
        const value = this.ctx.generateExpression(stmt.value!, params);
        this.ctx.emit(`store %ObjectArray* ${value}, %ObjectArray** ${allocaReg}`);
        return;
      }
    }

    const inlineMeta = this.extractInlineObjectArrayMeta(stmt.value!);
    if (inlineMeta) {
      this.ctx.defineVariable(
        stmt.name,
        allocaReg,
        "%ObjectArray*",
        SymbolKind_ObjectArray,
        "local",
      );
      this.ctx.symbolTable.setRawInterfaceType(stmt.name, "object");
      this.ctx.symbolTable.setObjectArrayMetadata(stmt.name, {
        elementInterfaceName: "object",
        elementKeys: inlineMeta.keys,
        elementTypes: inlineMeta.types,
        elementTsTypes: inlineMeta.tsTypes,
      });
      this.ctx.emit(`${allocaReg} = alloca %ObjectArray*`);
      const value = this.ctx.generateExpression(stmt.value!, params);
      this.ctx.emit(`store %ObjectArray* ${value}, %ObjectArray** ${allocaReg}`);
      return;
    }

    this.ctx.defineVariable(stmt.name, allocaReg, "%ObjectArray*", SymbolKind_ObjectArray, "local");
    this.ctx.emit(`${allocaReg} = alloca %ObjectArray*`);
    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store %ObjectArray* ${value}, %ObjectArray** ${allocaReg}`);
  }

  extractInlineObjectArrayMeta(
    expr: Expression,
  ): { keys: string[]; types: string[]; tsTypes: string[] } | null {
    const e = expr as ExprBase;
    if (e.type !== "array") return null;
    const arrayExpr = expr as ArrayNode;
    const elements = arrayExpr.elements || [];
    if (elements.length === 0) return null;
    const firstElem = elements[0] as ExprBase;
    if (firstElem.type !== "object") return null;

    const objNode = elements[0] as ObjectNode;
    const keys: string[] = [];
    const types: string[] = [];
    const tsTypes: string[] = [];

    for (let i = 0; i < objNode.properties.length; i++) {
      const prop = objNode.properties[i];
      keys.push(prop.key);
      const valType = (prop.value as ExprBase).type;
      let tsType = "string";
      if (valType === "number") tsType = "number";
      else if (valType === "boolean") tsType = "boolean";
      types.push(this.delegate.convertTsType(tsType));
      tsTypes.push(tsType);
    }

    return { keys, types, tsTypes };
  }

  allocateMethodArrayReturn(
    stmt: VariableDeclaration,
    params: string[],
    elementType: string,
  ): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const elementKeys: string[] = [];
    const elementTypes: string[] = [];
    const elementTsTypes: string[] = [];

    if (elementType.startsWith("{") && elementType.endsWith("}")) {
      const inlineFields = this.delegate.parseInlineObjectType(elementType);
      if (inlineFields) {
        for (let i = 0; i < inlineFields.length; i++) {
          const field = inlineFields[i] as { name: string; type: string };
          elementKeys.push(stripOptional(field.name));
          elementTypes.push(this.delegate.convertTsType(field.type));
          elementTsTypes.push(field.type);
        }
      }
    } else {
      const interfaceDefResult = this.delegate.getInterface(elementType);
      if (interfaceDefResult) {
        const interfaceDef = interfaceDefResult as InterfaceDeclaration;
        const allFields = this.delegate.getAllInterfaceFields(interfaceDef);
        for (let i = 0; i < allFields.length; i++) {
          const field = allFields[i] as { name: string; type: string };
          elementKeys.push(stripOptional(field.name));
          elementTypes.push(this.delegate.convertTsType(field.type));
          elementTsTypes.push(field.type);
        }
      }
    }

    this.ctx.defineVariable(stmt.name, allocaReg, "%ObjectArray*", SymbolKind_ObjectArray, "local");
    this.ctx.symbolTable.setRawInterfaceType(
      stmt.name,
      elementType.startsWith("{") ? "inline" : elementType,
    );
    this.ctx.symbolTable.setObjectArrayMetadata(stmt.name, {
      elementInterfaceName: elementType.startsWith("{") ? "inline" : elementType,
      elementKeys,
      elementTypes,
      elementTsTypes,
    });
    this.ctx.emit(`${allocaReg} = alloca %ObjectArray*`);
    const arrPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store %ObjectArray* ${arrPtr}, %ObjectArray** ${allocaReg}`);
  }

  allocateIndexedObjectArray(
    stmt: VariableDeclaration,
    params: string[],
    typeInfo: UnionCommonFields,
  ): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariableWithMetadata(
      stmt.name,
      allocaReg,
      "i8*",
      SymbolKind_Object,
      "local",
      createObjectMetadata({
        keys: typeInfo.keys,
        types: typeInfo.types,
        tsTypes: typeInfo.tsTypes,
      }),
    );
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    const objPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${objPtr}, i8** ${allocaReg}`);
  }

  allocateArrayMethodReturn(
    stmt: VariableDeclaration,
    params: string[],
    typeInfo: UnionCommonFields,
  ): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariableWithMetadata(
      stmt.name,
      allocaReg,
      "i8*",
      SymbolKind_Object,
      "local",
      createObjectMetadata({
        keys: typeInfo.keys,
        types: typeInfo.types,
        tsTypes: typeInfo.tsTypes,
      }),
    );
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    const objPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${objPtr}, i8** ${allocaReg}`);
  }

  getArrayMethodReturnType(
    expr: Expression | null,
  ): { keys: string[]; types: string[]; tsTypes: string[] } | null {
    if (!expr) return null;
    const result = this.ctx.typeResolverResolveArrayMethodReturnType(expr);
    if (result) {
      return { keys: result.keys, types: result.types, tsTypes: result.tsTypes || result.types };
    }
    return null;
  }

  getIndexedObjectArrayType(
    expr: Expression | null,
  ): { keys: string[]; types: string[]; tsTypes: string[] } | null {
    if (!expr) return null;
    const e = expr as ExprBase;
    if (e.type !== "index_access") return null;

    const indexExpr = expr as IndexAccessNode;
    if (!indexExpr.object) return null;
    const idxObjBase = indexExpr.object as ExprBase;
    if (!idxObjBase || !idxObjBase.type) return null;

    if (idxObjBase.type === "variable") {
      const varName = (indexExpr.object as VariableNode).name;
      if (!varName) return null;
      const ifaceType = this.ctx.symbolTable.getInterfaceType(varName);
      if (ifaceType) {
        return this.delegate.getTypeInfoForElementType(ifaceType);
      }
      const objArrayMeta = this.ctx.symbolTable.getObjectArrayMetadata(varName);
      if (objArrayMeta) {
        return {
          keys: objArrayMeta.elementKeys,
          types: objArrayMeta.elementTypes,
          tsTypes: objArrayMeta.elementTsTypes || [],
        };
      }
      const objArrElemType = this.ctx.symbolTable.getRawInterfaceType(varName);
      if (objArrElemType) {
        return this.delegate.getTypeInfoForElementType(objArrElemType);
      }
      const objMeta = this.ctx.symbolTable.getObjectMetadata(varName);
      if (objMeta && objMeta.tsTypes) {
        const tsTypes = objMeta.tsTypes as string[];
        if (tsTypes.length > 0) {
          const firstType = tsTypes[0];
          if (firstType && firstType.endsWith("[]")) {
            const elementType = firstType.slice(0, -2);
            return this.delegate.getTypeInfoForElementType(elementType);
          }
          return {
            keys: objMeta.keys as string[],
            types: objMeta.types as string[],
            tsTypes: tsTypes,
          };
        }
      }
      const objectMeta2 = this.ctx.symbolTable.getObjectMetadata(varName);
      if (objectMeta2 && objectMeta2.keys && objectMeta2.types && objectMeta2.tsTypes) {
        return {
          keys: objectMeta2.keys as string[],
          types: objectMeta2.types as string[],
          tsTypes: objectMeta2.tsTypes as string[],
        };
      }
      return null;
    }

    if (idxObjBase.type === "method_call") {
      const methodCall = indexExpr.object as MethodCallNode;
      const returnType = this.getMethodCallReturnType(methodCall);
      if (returnType && returnType.endsWith("[]")) {
        const elementType = returnType.slice(0, -2).trim();
        return this.delegate.getTypeInfoForElementType(elementType);
      }
      return null;
    }

    if (idxObjBase.type !== "member_access") return null;

    const memberAccess = indexExpr.object as MemberAccessNode;
    if (!memberAccess || !memberAccess.object || !memberAccess.property) return null;
    const propertyName = memberAccess.property;

    const memberObjBase = memberAccess.object as ExprBase;
    if (!memberObjBase || !memberObjBase.type) return null;
    if (memberObjBase.type === "variable") {
      const varName = (memberAccess.object as VariableNode).name;
      if (!varName) return null;
      const objMeta = this.ctx.symbolTable.getObjectMetadata(varName);
      if (objMeta && objMeta.keys) {
        const propIndex = objMeta.keys.indexOf(propertyName);
        if (propIndex !== -1) {
          const objMetaTsTypes = objMeta.tsTypes as string[];
          if (objMetaTsTypes) {
            const propTsType = objMetaTsTypes[propIndex];
            if (propTsType) {
              const arrayParsed = parseArrayTypeString(propTsType);
              if (arrayParsed) {
                return this.delegate.getTypeInfoForElementType(arrayParsed.elementType);
              }
            }
          }
        }
      }

      const paramType = this.ctx.getParameterTypeFromAST(varName);
      if (paramType) {
        const fieldType = this.delegate.getInterfaceFieldTypeByName(paramType, propertyName);
        if (fieldType) {
          const arrayParsed = parseArrayTypeString(fieldType);
          if (arrayParsed) {
            return this.delegate.getTypeInfoForElementType(arrayParsed.elementType);
          }
        }
      }

      return null;
    }

    if (memberObjBase.type === "member_access" || memberObjBase.type === "this") {
      const memberAccessTyped = memberAccess as {
        type: string;
        object: Expression;
        property: string;
      };
      const elementType = this.resolveNestedMemberArrayType(memberAccessTyped as MemberAccessNode);
      if (elementType) {
        return this.delegate.getTypeInfoForElementType(elementType);
      }
    }

    return null;
  }

  private resolveNestedMemberArrayType(memberAccess: MemberAccessNode): string | null {
    const objectType = this.resolveMemberAccessObjectType(memberAccess.object);
    if (!objectType) return null;

    const classFieldInfo = this.ctx.classGenGetFieldInfo(objectType, memberAccess.property);
    const classFieldTsType = classFieldInfo ? (classFieldInfo as FieldInfo).tsType : null;
    const fieldType =
      this.delegate.getInterfaceFieldTypeByName(objectType, memberAccess.property) ||
      classFieldTsType;
    if (!fieldType) return null;

    const arrayParsed = parseArrayTypeString(fieldType);
    if (!arrayParsed) return null;

    return arrayParsed.elementType;
  }

  resolveMemberAccessObjectType(expr: Expression): string | null {
    if (!expr) return null;
    const e = expr as ExprBase;
    if (!e.type) return null;
    if (e.type === "this") {
      return this.ctx.getCurrentClassName() || null;
    }
    if (e.type === "variable") {
      const varName = (expr as VariableNode).name;
      const objMeta = this.ctx.symbolTable.getObjectMetadata(varName);
      if (objMeta && objMeta.tsTypes) {
        return this.ctx.symbolTable.getType(varName) || null;
      }
      const paramType = this.ctx.getParameterTypeFromAST(varName);
      if (paramType) {
        return paramType;
      }
      return null;
    }
    if (e.type === "member_access") {
      const member = expr as MemberAccessNode;
      if (!member || !member.object || !member.property) return null;
      const memberObjBase = member.object as ExprBase;
      if (!memberObjBase || !memberObjBase.type) return null;
      if (memberObjBase.type === "this") {
        const fieldInfoResult = this.getThisFieldInfo(member.property);
        const fieldInfo = fieldInfoResult as FieldInfo;
        if (fieldInfoResult && fieldInfo.tsType) {
          return fieldInfo.tsType;
        }
        return null;
      }
      const objectType = this.resolveMemberAccessObjectType(member.object);
      if (objectType) {
        const fieldType = this.delegate.getInterfaceFieldTypeByName(objectType, member.property);
        return fieldType;
      }
    }
    return null;
  }

  private getMethodCallReturnType(methodCall: MethodCallNode): string | null {
    const objectType = this.resolveMemberAccessObjectType(methodCall.object);
    if (!objectType) return null;

    const ast = this.ctx.getAst();
    const classes = ast ? ast.classes || [] : [];
    for (let i = 0; i < classes.length; i++) {
      const cls = classes[i];
      if (cls.name === objectType) {
        for (let j = 0; j < cls.methods.length; j++) {
          const method = cls.methods[j];
          if (method.name === methodCall.method && method.returnType) {
            return method.returnType;
          }
        }
      }
    }

    return null;
  }

  private getThisFieldInfo(fieldName: string): { tsType?: string } | null {
    if (!this.ctx.getCurrentClassName()) return null;
    return this.ctx.classGenGetFieldInfo(this.ctx.getCurrentClassName()!, fieldName);
  }
}
