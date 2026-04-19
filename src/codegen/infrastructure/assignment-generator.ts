import {
  Expression,
  NewNode,
  VariableNode,
  MemberAccessAssignmentNode,
  MemberAccessNode,
  IndexAccessNode,
  AST,
  ClassNode,
  ClassField,
  AssignmentStatement,
  SourceLocation,
} from "../../ast/types.js";
import type { SymbolTable, ClassInfo, ObjectArrayMetadata } from "./symbol-table.js";
import type { InterfaceStructGenerator } from "../types/interface-struct-generator.js";

import type { FieldInfo } from "./type-resolver/types.js";
import { stripNullable } from "./type-system.js";

interface ObjectInfo {
  ptr: string;
  keys: string[];
  types: string[];
  tsTypes?: string[];
}

export interface AssignmentGeneratorContext {
  nextTemp(): string;
  emit(instruction: string): void;
  emitStore(type: string, value: string, ptr: string): void;
  emitLoad(type: string, ptr: string): string;
  emitBitcast(value: string, fromType: string, toType: string): string;
  generateExpression(expr: Expression, params: string[]): string;
  getVariableAlloca(name: string): string | null;
  getVariableType(name: string): string | null;
  classGenGetFieldInfo(className: string | null, fieldName: string | null): FieldInfo | null;
  classGenGetClassFields(className: string): { name: string; fieldType: string }[];
  getAst(): AST | undefined;
  expectedArrayElementType: "string" | "number" | "boolean" | "pointer" | null;
  setExpectedArrayElementType(type: "string" | "number" | "boolean" | "pointer" | null): void;
  currentDeclaredMapType: string | undefined;
  setCurrentDeclaredMapType(type: string | undefined): void;
  currentDeclaredSetType: string | undefined;
  setCurrentDeclaredSetType(type: string | undefined): void;
  getCurrentDeclaredInterfaceType(): string | undefined;
  setCurrentDeclaredInterfaceType(type: string | undefined): void;
  interfaceStructGenHasInterface(name: string): boolean;
  getThisPointer(): string | null;
  getCurrentClassName(): string | null;
  readonly symbolTable: SymbolTable;
  getInterfaceProperties(
    name: string,
  ): { keys: string[]; types: string[]; tsTypes: string[] } | null;
  ensureDouble(value: string): string;
  emitError(message: string, loc?: SourceLocation, suggestion?: string): never;
  classGenIsStaticField(className: string, fieldName: string): boolean;
  classGenGetStaticFieldType(className: string, fieldName: string): string;
  mangleUserName(name: string): string;
}

export class AssignmentGenerator {
  constructor(private ctx: AssignmentGeneratorContext) {}

  private isEnumType(typeName: string): boolean {
    const ast = this.ctx.getAst();
    if (!ast || !ast.enums) return false;
    for (let i = 0; i < ast.enums.length; i++) {
      if (ast.enums[i].name === typeName) return true;
    }
    return false;
  }

  generateMemberAccessAssignment(stmt: AssignmentStatement, params: string[]): void {
    const stmtValue = stmt.value;
    const stmtValueTyped = stmtValue as { type: string };
    const valueType = stmtValueTyped.type;
    if (valueType === null || valueType === undefined) {
      return this.ctx.emitError("malformed assignment — value expression has no type", stmt.loc);
    }
    if (valueType !== "member_access_assignment") {
      return this.ctx.emitError("Invalid member access assignment format");
    }
    const memberAccessValue = stmtValue as MemberAccessAssignmentNode;

    const object = memberAccessValue.object;
    const objectTyped = object as { type: string };
    const objType = objectTyped.type;
    if (objType === null || objType === undefined) {
      return this.ctx.emitError("malformed assignment — target object has no type", stmt.loc);
    }
    const property = memberAccessValue.property;

    let className: string | null = null;

    if (objType === "variable") {
      const varName = (object as VariableNode).name;
      // Static field assignment: ClassName.staticField = value
      if (this.ctx.classGenIsStaticField(varName, property)) {
        const llvmType = this.ctx.classGenGetStaticFieldType(varName, property);
        const globalName = `@${this.ctx.mangleUserName(varName)}_${property}`;
        const value = this.ctx.generateExpression(memberAccessValue.value, params);
        const coerced = llvmType === "double" ? this.ctx.ensureDouble(value) : value;
        this.ctx.emit(`store ${llvmType} ${coerced}, ${llvmType}* ${globalName}`);
        return;
      }
      if (this.ctx.symbolTable.isClass(varName)) {
        const classMeta = this.ctx.symbolTable.getClassInfo(varName)!;
        className = classMeta.className;
      } else if (this.ctx.symbolTable.isObject(varName)) {
        this.handleObjectPropertyAssignment(
          object as VariableNode,
          property,
          memberAccessValue,
          params,
        );
        return;
      }
    } else if (objType === "new") {
      const newExpr = object as NewNode;
      className = newExpr.className;
    } else if (objType === "this") {
      const thisPtr = this.ctx.getThisPointer();
      if (!thisPtr) {
        return this.ctx.emitError("this.field = value used outside of class method or constructor");
      }
      className = this.ctx.getCurrentClassName();
      if (!className) {
        const ast = this.ctx.getAst();
        const classes = ast ? ast.classes || [] : [];
        let classWithFieldResult: ClassNode | null = null;
        for (let ci = 0; ci < classes.length; ci++) {
          const c = classes[ci] as ClassNode;
          let hasField = false;
          for (let fi = 0; fi < c.fields.length; fi++) {
            const f = c.fields[fi] as ClassField;
            if (f.name === property) {
              hasField = true;
              break;
            }
          }
          if (hasField) {
            classWithFieldResult = c;
            break;
          }
        }
        const classWithField = classWithFieldResult as ClassNode;
        if (classWithFieldResult) {
          className = classWithField.name;
        }
      }
    } else if (objType === "member_access") {
      if (property === "length") {
        this.handleArrayLengthAssignment(object as MemberAccessNode, memberAccessValue, params);
        return;
      }
      const resolvedClass = this.resolveClassFromMemberAccess(object as MemberAccessNode);
      if (resolvedClass) {
        this.handleChainedMemberAccessAssignment(
          object as MemberAccessNode,
          resolvedClass,
          property,
          memberAccessValue,
          params,
        );
        return;
      }
    } else if (objType === "index_access") {
      this.handleIndexAccessPropertyAssignment(
        object as IndexAccessNode,
        property,
        memberAccessValue,
        params,
      );
      return;
    }

    if (className) {
      this.handleClassFieldAssignment(object, className, property, memberAccessValue, params);
    } else {
      const objTypeName = (object as { type: string }).type || "unknown";
      this.ctx.emitError(
        `cannot assign to '${property}' — unable to determine class for object of type '${objTypeName}'`,
      );
    }
  }

  private handleObjectPropertyAssignment(
    object: VariableNode,
    property: string,
    memberAccessValue: MemberAccessAssignmentNode,
    params: string[],
  ): void {
    const objMetaResult = this.ctx.symbolTable.getObjectInfo(object.name);
    if (!objMetaResult) return;
    const objMeta = objMetaResult as {
      ptr: string;
      keys: string[];
      types: string[];
      tsTypes: string[];
    };

    const value = this.ctx.generateExpression(memberAccessValue.value, params);
    const propIndex = objMeta.keys.indexOf(property);
    if (propIndex === -1) {
      return this.ctx.emitError(
        "Unknown property: " +
          property +
          " on object " +
          object.name +
          ". Available properties: " +
          objMeta.keys.join(", "),
      );
    }
    const propType = objMeta.types[propIndex];
    const structType = `{ ${objMeta.types.join(", ")} }`;

    const objPtrPtr = this.ctx.getVariableAlloca(object.name)!;
    const objPtr = this.ctx.nextTemp();
    this.ctx.emit(`${objPtr} = load i8*, i8** ${objPtrPtr}`);

    const typedPtr = this.ctx.emitBitcast(objPtr, "i8*", `${structType}*`);

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${propIndex}`,
    );

    if (propType === "i1") {
      this.ctx.emit(`store double ${this.ctx.ensureDouble(value)}, double* ${fieldPtr}`);
    } else if (propType === "double") {
      this.ctx.emit(`store double ${this.ctx.ensureDouble(value)}, double* ${fieldPtr}`);
    } else {
      this.ctx.emit(`store ${propType} ${value}, ${propType}* ${fieldPtr}`);
    }
  }

  private handleClassFieldAssignment(
    object: Expression,
    className: string,
    property: string,
    memberAccessValue: MemberAccessAssignmentNode,
    params: string[],
  ): void {
    const fieldInfoResult = this.ctx.classGenGetFieldInfo(className, property);

    let fieldIndex: number = -1;
    let fieldType = "";
    let fieldTsType: string | null = null;
    if (fieldInfoResult) {
      const fi = fieldInfoResult as FieldInfo;
      fieldIndex = fi.index;
      fieldType = fi.type;
      if (fi.tsType !== null && fi.tsType !== undefined) {
        fieldTsType = fi.tsType;
      }
    }

    if (fieldInfoResult && fieldType === "string[]") {
      this.ctx.setExpectedArrayElementType("string");
    } else if (fieldInfoResult && fieldType === "number[]") {
      this.ctx.setExpectedArrayElementType("number");
    } else if (fieldInfoResult && fieldType === "boolean[]") {
      this.ctx.setExpectedArrayElementType("boolean");
    }

    if (fieldTsType && fieldTsType.startsWith("Map<string,")) {
      this.ctx.setCurrentDeclaredMapType(fieldTsType);
    }

    if (fieldTsType && fieldTsType.startsWith("Set<")) {
      this.ctx.setCurrentDeclaredSetType(fieldTsType);
    }

    let savedDeclaredIface: string | undefined = undefined;
    let wrappedDeclaredIface = false;
    const rhsTyped = memberAccessValue.value as { type: string };
    if (rhsTyped.type === "object" && fieldTsType) {
      const strippedTs = stripNullable(fieldTsType);
      if (this.ctx.interfaceStructGenHasInterface(strippedTs)) {
        savedDeclaredIface = this.ctx.getCurrentDeclaredInterfaceType();
        this.ctx.setCurrentDeclaredInterfaceType(strippedTs);
        wrappedDeclaredIface = true;
      }
    }

    const value = this.ctx.generateExpression(memberAccessValue.value, params);
    if (wrappedDeclaredIface) {
      this.ctx.setCurrentDeclaredInterfaceType(savedDeclaredIface);
    }
    this.ctx.setExpectedArrayElementType(null);
    this.ctx.setCurrentDeclaredMapType(undefined);
    this.ctx.setCurrentDeclaredSetType(undefined);

    let instancePtr: string | null = null;
    const objectTyped = object as { type: string };
    const objType = objectTyped.type;
    if (objType === "variable") {
      const varName = (object as VariableNode).name;
      if (this.ctx.symbolTable.isClass(varName)) {
        instancePtr = this.ctx.generateExpression(object, params);
      }
    } else if (objType === "new") {
      instancePtr = this.ctx.generateExpression(object, params);
    } else if (objType === "this") {
      instancePtr = this.ctx.getThisPointer();
    }

    if (!instancePtr) {
      return this.ctx.emitError(
        "Cannot determine class instance for field assignment on " + objType,
      );
    }

    const fields = this.ctx.classGenGetClassFields(className);

    if (fieldInfoResult) {
      const fieldPtr = this.ctx.nextTemp();
      if (fields.length > 0) {
        this.ctx.emit(
          `${fieldPtr} = getelementptr inbounds %${className}_struct, %${className}_struct* ${instancePtr}, i32 0, i32 ${fieldIndex}`,
        );
        this.storeFieldValueDirect(fieldType, fieldTsType, fieldPtr, value, memberAccessValue);
      } else {
        this.ctx.emit(
          `${fieldPtr} = getelementptr inbounds double, double* ${instancePtr}, i32 ${fieldIndex}`,
        );
        this.ctx.emit(`store double ${this.ctx.ensureDouble(value)}, double* ${fieldPtr}`);
      }
    } else if (fields.length === 0) {
      const fieldPtr = this.ctx.nextTemp();
      this.ctx.emit(`${fieldPtr} = getelementptr inbounds double, double* ${instancePtr}, i32 0`);
      this.ctx.emit(`store double ${this.ctx.ensureDouble(value)}, double* ${fieldPtr}`);
    } else {
      return this.ctx.emitError(
        "Field '" +
          property +
          "' not found in class " +
          className +
          ". Did you forget to declare it with a type annotation?",
      );
    }
  }

  private resolveClassFromMemberAccess(expr: MemberAccessNode): string | null {
    const innerObj = expr.object as { type: string };
    let ownerClass: string | null = null;

    if (innerObj.type === "variable") {
      const varName = (expr.object as VariableNode).name;
      if (this.ctx.symbolTable.isClass(varName)) {
        const classMeta = this.ctx.symbolTable.getClassInfo(varName)!;
        ownerClass = classMeta.className;
      }
    } else if (innerObj.type === "this") {
      ownerClass = this.ctx.getCurrentClassName();
    } else if (innerObj.type === "member_access") {
      ownerClass = this.resolveClassFromMemberAccess(expr.object as MemberAccessNode);
    }

    if (!ownerClass) return null;

    const fieldInfo = this.ctx.classGenGetFieldInfo(ownerClass, expr.property);
    if (!fieldInfo) return null;
    const fi = fieldInfo as FieldInfo;
    if (!fi.tsType) return null;

    const strippedType = stripNullable(fi.tsType);
    const classFields = this.ctx.classGenGetClassFields(strippedType);
    if (classFields.length > 0) return strippedType;

    return null;
  }

  private handleChainedMemberAccessAssignment(
    object: MemberAccessNode,
    targetClassName: string,
    property: string,
    memberAccessValue: MemberAccessAssignmentNode,
    params: string[],
  ): void {
    const fieldInfoResult = this.ctx.classGenGetFieldInfo(targetClassName, property);
    if (!fieldInfoResult) {
      return this.ctx.emitError(`Field '${property}' not found in class ${targetClassName}`);
    }
    const fi = fieldInfoResult as FieldInfo;

    if (fi.tsType && fi.tsType.startsWith("Map<string,")) {
      this.ctx.setCurrentDeclaredMapType(fi.tsType);
    }
    if (fi.tsType && fi.tsType.startsWith("Set<")) {
      this.ctx.setCurrentDeclaredSetType(fi.tsType);
    }

    const value = this.ctx.generateExpression(memberAccessValue.value, params);
    this.ctx.setCurrentDeclaredMapType(undefined);
    this.ctx.setCurrentDeclaredSetType(undefined);

    const objPtr = this.ctx.generateExpression(object, params);
    const structType = `%${targetClassName}_struct`;
    const varType = this.ctx.getVariableType(objPtr);
    let typedPtr: string;
    if (varType === `${structType}*`) {
      typedPtr = objPtr;
    } else {
      typedPtr = this.ctx.emitBitcast(objPtr, "i8*", `${structType}*`);
    }

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${fi.index}`,
    );
    this.storeFieldValueDirect(fi.type, fi.tsType || null, fieldPtr, value, memberAccessValue);
  }

  private storeFieldValueDirect(
    fiType: string,
    fiTsType: string | null,
    fieldPtr: string,
    value: string,
    memberAccessValue: MemberAccessAssignmentNode,
  ): void {
    if (fiTsType) {
      const enumResult = this.isEnumType(fiTsType);
      if (enumResult) {
        this.ctx.emit(`store double ${this.ctx.ensureDouble(value)}, double* ${fieldPtr}`);
        return;
      }
    }
    if (fiType === null || fiType === undefined) {
      this.ctx.emit(`store double ${this.ctx.ensureDouble(value)}, double* ${fieldPtr}`);
      return;
    }

    const hasTsType = fiTsType !== null;

    if (fiType === "string") {
      let isAlreadyPointer = false;
      const valueNodeType = memberAccessValue.value.type;
      if (valueNodeType === "variable") {
        const varType = this.ctx.getVariableType((memberAccessValue.value as VariableNode).name);
        if (varType === "i8*" || (varType && varType.indexOf("*") !== -1)) {
          isAlreadyPointer = true;
        }
      } else if (valueNodeType === "string") {
        isAlreadyPointer = true;
      }

      const valueType = this.ctx.getVariableType(value);
      if (valueType === "i8*" || (valueType && valueType.indexOf("*") !== -1)) {
        isAlreadyPointer = true;
      }

      if (isAlreadyPointer) {
        this.ctx.emit(`store i8* ${value}, i8** ${fieldPtr}`);
      } else {
        const strPtr = this.ctx.nextTemp();
        this.ctx.emit(`${strPtr} = inttoptr i32 ${value} to i8*`);
        this.ctx.emit(`store i8* ${strPtr}, i8** ${fieldPtr}`);
      }
    } else if (fiType === "string[]") {
      this.ctx.emit(`store %StringArray* ${value}, %StringArray** ${fieldPtr}`);
    } else if (fiType.endsWith("[]")) {
      this.ctx.emit(`store %Array* ${value}, %Array** ${fieldPtr}`);
    } else if (fiType === "boolean") {
      this.ctx.emit(`store double ${this.ctx.ensureDouble(value)}, double* ${fieldPtr}`);
    } else if (hasTsType && fiTsType && fiTsType.startsWith("Map<string,")) {
      this.ctx.emit(`store %StringMap* ${value}, %StringMap** ${fieldPtr}`);
    } else if (hasTsType && fiTsType && fiTsType.startsWith("Map<")) {
      this.ctx.emit(`store %Map* ${value}, %Map** ${fieldPtr}`);
    } else if (hasTsType && fiTsType === "Set<string>") {
      this.ctx.emit(`store %StringSet* ${value}, %StringSet** ${fieldPtr}`);
    } else if (hasTsType && fiTsType && fiTsType.startsWith("Set<")) {
      this.ctx.emit(`store %Set* ${value}, %Set** ${fieldPtr}`);
    } else if (hasTsType && fiTsType) {
      const strippedTsType = stripNullable(fiTsType);
      const classFields = this.ctx.classGenGetClassFields(strippedTsType);
      if (classFields.length > 0) {
        const structType = `%${strippedTsType}_struct*`;
        const valueType = this.ctx.getVariableType(value);
        if (valueType === structType) {
          this.ctx.emit(`store ${structType} ${value}, ${structType}* ${fieldPtr}`);
        } else {
          const cast = this.ctx.nextTemp();
          this.ctx.emit(`${cast} = bitcast i8* ${value} to ${structType}`);
          this.ctx.emit(`store ${structType} ${cast}, ${structType}* ${fieldPtr}`);
        }
      } else if (fiTsType !== "number" && fiTsType !== "boolean" && !this.isEnumType(fiTsType)) {
        this.ctx.emit(`store i8* ${value}, i8** ${fieldPtr}`);
      } else {
        this.ctx.emit(`store double ${this.ctx.ensureDouble(value)}, double* ${fieldPtr}`);
      }
    } else {
      this.ctx.emit(`store double ${this.ctx.ensureDouble(value)}, double* ${fieldPtr}`);
    }
  }

  private storeFieldValue(
    fieldInfo: FieldInfo,
    fieldPtr: string,
    value: string,
    memberAccessValue: MemberAccessAssignmentNode,
  ): void {
    const fi = fieldInfo as FieldInfo;
    const fiType = fi.type;

    if (fiType === null || fiType === undefined) {
      this.ctx.emit(`store double ${this.ctx.ensureDouble(value)}, double* ${fieldPtr}`);
      return;
    }

    const fiTsType = fi.tsType;
    const hasTsType = fiTsType !== null && fiTsType !== undefined;

    if (fiType === "string") {
      let isAlreadyPointer = false;
      const valueNodeType = memberAccessValue.value.type;
      if (valueNodeType === "variable") {
        const varType = this.ctx.getVariableType((memberAccessValue.value as VariableNode).name);
        if (varType === "i8*" || (varType && varType.indexOf("*") !== -1)) {
          isAlreadyPointer = true;
        }
      } else if (valueNodeType === "string") {
        isAlreadyPointer = true;
      }

      const valueType = this.ctx.getVariableType(value);
      if (valueType === "i8*" || (valueType && valueType.indexOf("*") !== -1)) {
        isAlreadyPointer = true;
      }

      if (isAlreadyPointer) {
        this.ctx.emit(`store i8* ${value}, i8** ${fieldPtr}`);
      } else {
        const strPtr = this.ctx.nextTemp();
        this.ctx.emit(`${strPtr} = inttoptr i32 ${value} to i8*`);
        this.ctx.emit(`store i8* ${strPtr}, i8** ${fieldPtr}`);
      }
    } else if (fiType === "string[]") {
      this.ctx.emit(`store %StringArray* ${value}, %StringArray** ${fieldPtr}`);
    } else if (fiType.endsWith("[]")) {
      this.ctx.emit(`store %Array* ${value}, %Array** ${fieldPtr}`);
    } else if (fiType === "boolean") {
      this.ctx.emit(`store double ${this.ctx.ensureDouble(value)}, double* ${fieldPtr}`);
    } else if (hasTsType && fiTsType && fiTsType.startsWith("Map<string,")) {
      this.ctx.emit(`store %StringMap* ${value}, %StringMap** ${fieldPtr}`);
    } else if (hasTsType && fiTsType && fiTsType.startsWith("Map<")) {
      this.ctx.emit(`store %Map* ${value}, %Map** ${fieldPtr}`);
    } else if (hasTsType && fiTsType === "Set<string>") {
      this.ctx.emit(`store %StringSet* ${value}, %StringSet** ${fieldPtr}`);
    } else if (hasTsType && fiTsType && fiTsType.startsWith("Set<")) {
      this.ctx.emit(`store %Set* ${value}, %Set** ${fieldPtr}`);
    } else if (
      hasTsType &&
      fiTsType &&
      fiTsType !== "number" &&
      fiTsType !== "boolean" &&
      !this.isEnumType(fiTsType)
    ) {
      this.ctx.emit(`store i8* ${value}, i8** ${fieldPtr}`);
    } else {
      this.ctx.emit(`store double ${this.ctx.ensureDouble(value)}, double* ${fieldPtr}`);
    }
  }

  private handleIndexAccessPropertyAssignment(
    indexAccess: IndexAccessNode,
    property: string,
    memberAccessValue: MemberAccessAssignmentNode,
    params: string[],
  ): void {
    const elementInfo = this.getObjectArrayElementInfoForAssignment(indexAccess.object);
    if (!elementInfo) {
      return this.ctx.emitError(
        `cannot assign to '${property}' — unable to determine element type for index access`,
      );
    }

    const propIndex = elementInfo.keys.indexOf(property);
    if (propIndex === -1) {
      return this.ctx.emitError(
        `unknown property '${property}' on array element — available properties: ${elementInfo.keys.join(", ")}`,
      );
    }

    const arrayPtr = this.ctx.generateExpression(indexAccess.object, params);
    const indexDouble = this.ctx.generateExpression(indexAccess.index, params);

    const indexType = this.ctx.getVariableType(indexDouble);
    let index = indexDouble;
    if (indexType === "double" || indexType === undefined) {
      index = this.ctx.nextTemp();
      this.ctx.emit(`${index} = fptosi double ${indexDouble} to i32`);
    } else if (indexType === "i64") {
      index = this.ctx.nextTemp();
      this.ctx.emit(`${index} = trunc i64 ${indexDouble} to i32`);
    }

    const structTypeFields = elementInfo.types.join(", ");
    const structType = `{ ${structTypeFields} }`;

    let contiguousStride = 0;
    const idxObj = indexAccess.object as { type: string };
    if (idxObj.type === "variable") {
      const arrVarName = (indexAccess.object as VariableNode).name;
      const numFields = this.ctx.symbolTable.getContiguousFieldCount(arrVarName);
      if (numFields > 0) contiguousStride = numFields * 8;
    }

    const dataPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${dataPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`,
    );

    const data = this.ctx.nextTemp();
    this.ctx.emit(`${data} = load i8*, i8** ${dataPtr}`);

    let elemTyped: string;
    if (contiguousStride > 0) {
      const indexI64 = this.ctx.nextTemp();
      this.ctx.emit(`${indexI64} = sext i32 ${index} to i64`);
      const offset = this.ctx.nextTemp();
      this.ctx.emit(`${offset} = mul i64 ${indexI64}, ${contiguousStride}`);
      const elemRaw = this.ctx.nextTemp();
      this.ctx.emit(`${elemRaw} = getelementptr inbounds i8, i8* ${data}, i64 ${offset}`);
      elemTyped = this.ctx.emitBitcast(elemRaw, "i8*", `${structType}*`);
    } else {
      const dataAsPtrs = this.ctx.emitBitcast(data, "i8*", "i8**");
      const elemPtrPtr = this.ctx.nextTemp();
      this.ctx.emit(`${elemPtrPtr} = getelementptr inbounds i8*, i8** ${dataAsPtrs}, i32 ${index}`);
      const elemPtr = this.ctx.nextTemp();
      this.ctx.emit(`${elemPtr} = load i8*, i8** ${elemPtrPtr}`);
      elemTyped = this.ctx.emitBitcast(elemPtr, "i8*", `${structType}*`);
    }

    const propType = elementInfo.types[propIndex];
    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${elemTyped}, i32 0, i32 ${propIndex}`,
    );

    const value = this.ctx.generateExpression(memberAccessValue.value, params);
    if (propType === "double") {
      this.ctx.emit(`store double ${this.ctx.ensureDouble(value)}, double* ${fieldPtr}`);
    } else {
      this.ctx.emit(`store ${propType} ${value}, ${propType}* ${fieldPtr}`);
    }
  }

  private getObjectArrayElementInfoForAssignment(
    arrayExpr: Expression,
  ): { keys: string[]; types: string[]; tsTypes: string[] } | null {
    if (arrayExpr.type === "variable") {
      const varName = (arrayExpr as VariableNode).name;
      const objArrayMeta = this.ctx.symbolTable.getObjectArrayMetadata(varName);
      if (objArrayMeta) {
        return {
          keys: objArrayMeta.elementKeys,
          types: objArrayMeta.elementTypes,
          tsTypes: objArrayMeta.elementTsTypes || [],
        };
      }
      const elementType = this.ctx.symbolTable.getObjectArrayElementType(varName);
      if (elementType) {
        const ifaceProps = this.ctx.getInterfaceProperties(elementType);
        if (ifaceProps) {
          return {
            keys: ifaceProps.keys,
            types: ifaceProps.types,
            tsTypes: ifaceProps.tsTypes,
          };
        }
      }
    }
    if (arrayExpr.type === "member_access") {
      const memberAccess = arrayExpr as MemberAccessNode;
      const memberObj = memberAccess.object as { type: string };
      if (memberObj.type === "this") {
        const className = this.ctx.getCurrentClassName();
        if (className) {
          const fieldInfo = this.ctx.classGenGetFieldInfo(className, memberAccess.property);
          if (fieldInfo && fieldInfo.tsType && fieldInfo.tsType.endsWith("[]")) {
            const elementType = fieldInfo.tsType.slice(0, -2);
            const ifaceProps = this.ctx.getInterfaceProperties(elementType);
            if (ifaceProps) {
              return {
                keys: ifaceProps.keys,
                types: ifaceProps.types,
                tsTypes: ifaceProps.tsTypes,
              };
            }
          }
        }
      }
    }
    return null;
  }

  private handleArrayLengthAssignment(
    arrayExpr: MemberAccessNode,
    memberAccessValue: MemberAccessAssignmentNode,
    params: string[],
  ): void {
    const arrayPtr = this.ctx.generateExpression(arrayExpr, params);
    const value = this.ctx.generateExpression(memberAccessValue.value, params);

    const dblVal = this.ctx.ensureDouble(value);
    const valueI32 = this.ctx.nextTemp();
    this.ctx.emit(`${valueI32} = fptosi double ${dblVal} to i32`);

    let arrayType = "%StringArray";
    const currentClass = this.ctx.getCurrentClassName();
    const arrayExprObj = arrayExpr.object;
    if (arrayExprObj.type === "this" && currentClass) {
      const fieldInfo = this.ctx.classGenGetFieldInfo(currentClass, arrayExpr.property);
      if (fieldInfo) {
        const fi = fieldInfo as FieldInfo;
        if (fi.type === "string[]") {
          arrayType = "%StringArray";
        } else if (fi.type.endsWith("[]")) {
          arrayType = "%Array";
        }
      }
    }

    const lengthPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${lengthPtr} = getelementptr inbounds ${arrayType}, ${arrayType}* ${arrayPtr}, i32 0, i32 1`,
    );
    this.ctx.emitStore("i32", valueI32, lengthPtr);
  }
}
