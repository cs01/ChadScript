import { Expression, ObjectNode, ObjectProperty } from "../../../ast/types.js";
import { IGeneratorContext } from "../../infrastructure/generator-context.js";
import type { InterfaceStructGenerator } from "../interface-struct-generator.js";
import { tsTypeToLlvm, isObjectArrayTsType } from "../../infrastructure/type-system.js";
import { emitZext, emitSitofp, emitFcmp, emitInttoptr } from "../../infrastructure/ir-builders.js";

interface ObjectGeneratorContext extends IGeneratorContext {}

export class ObjectGenerator {
  constructor(private ctx: ObjectGeneratorContext) {}

  private nextTemp(): string {
    return this.ctx.nextTemp();
  }
  private emit(instruction: string): void {
    this.ctx.emit(instruction);
  }

  private allocateStruct(structType: string, structSizeBytes: number): string {
    const key = this.ctx.getCurrentVarDeclKey();
    if (key && this.ctx.isStackEligibleKey(key)) {
      const allocaReg = this.ctx.nextAllocaReg("_obj");
      this.emit(`${allocaReg} = alloca ${structType}`);
      return allocaReg;
    }
    const objMem = this.nextTemp();
    this.emit(`${objMem} = call i8* @GC_malloc(i64 ${structSizeBytes})`);
    const objPtr = this.nextTemp();
    this.emit(`${objPtr} = bitcast i8* ${objMem} to ${structType}*`);
    return objPtr;
  }

  generateObjectLiteral(expr: Expression, params: string[]): string {
    if (expr.type !== "object") {
      return this.ctx.emitError("Expected object literal");
    }
    const objExpr = expr as ObjectNode;

    const keys: string[] = [];
    for (let i = 0; i < objExpr.properties.length; i++) {
      const prop = objExpr.properties[i] as ObjectProperty;
      keys.push(prop.key);
    }
    const numFields = keys.length;

    if (numFields === 0) {
      return "null";
    }

    const declaredInterfaceType = this.ctx.getCurrentDeclaredInterfaceType();

    if (declaredInterfaceType && declaredInterfaceType.startsWith("{")) {
      return this.generateInlineInterfaceObject(objExpr, params, declaredInterfaceType);
    }

    if (declaredInterfaceType) {
      if (this.ctx.interfaceStructGen?.hasInterface(declaredInterfaceType)) {
        return this.generateInterfaceObject(objExpr, params, declaredInterfaceType);
      }
    }

    return this.generateInlineObject(objExpr, params);
  }

  private parseInlineInterfaceFields(typeStr: string): { name: string; type: string }[] {
    if (!typeStr.startsWith("{") || !typeStr.endsWith("}")) {
      return [];
    }
    const inner = typeStr.slice(1, typeStr.length - 1).trim();
    if (inner.length === 0) {
      return [];
    }
    const fields: { name: string; type: string }[] = [];
    const parts = inner.split(";");
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (!part) continue;
      const colonIdx = part.indexOf(":");
      if (colonIdx === -1) continue;
      let name = part.slice(0, colonIdx).trim();
      const fieldType = part.slice(colonIdx + 1).trim();
      if (name.endsWith("?")) {
        name = name.slice(0, name.length - 1);
      }
      fields.push({ name, type: fieldType });
    }
    return fields;
  }

  private tsTypeToLlvm(tsType: string): string {
    return tsTypeToLlvm(tsType);
  }

  private generateInlineInterfaceObject(
    objExpr: ObjectNode,
    params: string[],
    typeStr: string,
  ): string {
    const fields = this.parseInlineInterfaceFields(typeStr);
    if (fields.length === 0) {
      return this.generateInlineObject(objExpr, params);
    }

    const propMap = new Map<string, Expression>();
    for (let i = 0; i < objExpr.properties.length; i++) {
      const prop = objExpr.properties[i] as ObjectProperty;
      propMap.set(prop.key, prop.value);
    }

    const orderedFields: { key: string; llvmType: string; value: string }[] = [];

    for (let fieldIdx = 0; fieldIdx < fields.length; fieldIdx++) {
      const field = fields[fieldIdx] as { name: string; type: string };
      const llvmType = this.tsTypeToLlvm(field.type);
      const valueExpr = propMap.get(field.name);
      let finalValue: string;

      if (!valueExpr) {
        if (llvmType === "double") {
          finalValue = "0.0";
        } else {
          finalValue = "null";
        }
      } else {
        const savedExpectedType = this.ctx.getExpectedArrayElementType();
        const tsType = field.type;
        if (tsType && isObjectArrayTsType(tsType)) {
          this.ctx.setExpectedArrayElementType("pointer");
        } else if (tsType === "string[]") {
          this.ctx.setExpectedArrayElementType("string");
        }
        const savedDeclaredInterface = this.ctx.getCurrentDeclaredInterfaceType();
        if (tsType && valueExpr.type === "object") {
          let resolvedFieldType = tsType;
          if (resolvedFieldType.endsWith(" | null")) {
            resolvedFieldType = resolvedFieldType.slice(0, resolvedFieldType.length - 7);
          }
          if (resolvedFieldType.endsWith(" | undefined")) {
            resolvedFieldType = resolvedFieldType.slice(0, resolvedFieldType.length - 12);
          }
          if (this.ctx.interfaceStructGen?.hasInterface(resolvedFieldType)) {
            this.ctx.setCurrentDeclaredInterfaceType(resolvedFieldType);
          }
        }
        finalValue = this.ctx.generateExpression(valueExpr, params);
        this.ctx.setExpectedArrayElementType(savedExpectedType);
        this.ctx.setCurrentDeclaredInterfaceType(savedDeclaredInterface);
      }

      orderedFields.push({ key: field.name, llvmType, value: finalValue });
    }

    const llvmTypes: string[] = [];
    for (let i = 0; i < orderedFields.length; i++) {
      const ft = orderedFields[i] as { key: string; llvmType: string; value: string };
      llvmTypes.push(ft.llvmType);
    }
    const structFields = llvmTypes.join(", ");
    const structSizeBytes = orderedFields.length * 8;
    const structType = `{ ${structFields} }`;

    const objPtr = this.allocateStruct(structType, structSizeBytes);

    for (let i = 0; i < orderedFields.length; i++) {
      const field = orderedFields[i] as { key: string; llvmType: string; value: string };
      const fieldPtr = this.nextTemp();
      this.emit(
        `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${objPtr}, i32 0, i32 ${i}`,
      );
      const isTreeSitterType =
        field.llvmType === "%TSNode*" ||
        field.llvmType === "%TSTree*" ||
        field.llvmType === "%TSParser*" ||
        field.llvmType === "%TSLanguage*";
      if (isTreeSitterType) {
        const valI64 = this.nextTemp();
        this.emit(`${valI64} = bitcast double ${field.value} to i64`);
        const valPtr = emitInttoptr(this.ctx, valI64, "i64", field.llvmType);
        this.emit(`store ${field.llvmType} ${valPtr}, ${field.llvmType}* ${fieldPtr}`);
      } else if (field.llvmType === "double") {
        const dblValue = this.ctx.ensureDouble(field.value);
        this.emit(`store double ${dblValue}, double* ${fieldPtr}`);
      } else {
        this.emit(`store ${field.llvmType} ${field.value}, ${field.llvmType}* ${fieldPtr}`);
      }
    }

    const genericPtr = this.nextTemp();
    this.emit(`${genericPtr} = bitcast ${structType}* ${objPtr} to i8*`);

    this.ctx.setVariableType(genericPtr, "i8*");

    return genericPtr;
  }

  private generateInterfaceObject(
    objExpr: ObjectNode,
    params: string[],
    interfaceName: string,
  ): string {
    const fieldCount = this.ctx.interfaceStructGenGetFieldCount(interfaceName);
    if (fieldCount === 0) {
      return this.generateInlineObject(objExpr, params);
    }

    const propMap = new Map<string, Expression>();
    const objectLiteralKeys = new Map<string, ObjectNode>();
    for (let i = 0; i < objExpr.properties.length; i++) {
      const prop = objExpr.properties[i] as ObjectProperty;
      propMap.set(prop.key, prop.value);
      const valType = prop.value.type;
      if (valType && valType.length > 0 && valType.charCodeAt(0) === 111) {
        objectLiteralKeys.set(prop.key, prop.value as ObjectNode);
      }
    }

    const orderedFields: { key: string; llvmType: string; value: string }[] = [];

    for (let fieldIdx = 0; fieldIdx < fieldCount; fieldIdx++) {
      const fieldName = this.ctx.interfaceStructGenGetFieldName(interfaceName, fieldIdx);
      const fieldTsType = this.ctx.interfaceStructGenGetFieldTsType(interfaceName, fieldIdx);
      const fieldLlvmType = this.ctx.interfaceStructGenGetFieldLlvmType(interfaceName, fieldIdx);
      const valueExpr = propMap.get(fieldName);
      let finalValue: string;

      if (!valueExpr) {
        if (fieldLlvmType === "double") {
          finalValue = "0.0";
        } else if (fieldLlvmType === "i8*") {
          finalValue = "null";
        } else if (fieldLlvmType === "i1") {
          finalValue = "false";
        } else {
          finalValue = "null";
        }
      } else {
        const savedExpectedType = this.ctx.getExpectedArrayElementType();
        const savedDeclaredInterface = this.ctx.getCurrentDeclaredInterfaceType();
        const tsType = fieldTsType;
        if (tsType && isObjectArrayTsType(tsType)) {
          this.ctx.setExpectedArrayElementType("pointer");
        } else if (tsType === "string[]") {
          this.ctx.setExpectedArrayElementType("string");
        }
        let directNestedInterface = "";
        let directNestedObj: ObjectNode | null = null;
        if (tsType && objectLiteralKeys.has(fieldName)) {
          let resolvedFieldType = tsType;
          if (resolvedFieldType.endsWith(" | null")) {
            resolvedFieldType = resolvedFieldType.slice(0, resolvedFieldType.length - 7);
          }
          if (resolvedFieldType.endsWith(" | undefined")) {
            resolvedFieldType = resolvedFieldType.slice(0, resolvedFieldType.length - 12);
          }
          if (this.ctx.interfaceStructGen?.hasInterface(resolvedFieldType)) {
            directNestedInterface = resolvedFieldType;
            directNestedObj = objectLiteralKeys.get(fieldName) ?? null;
          }
        }
        let valueReg: string;
        if (directNestedInterface.length > 0 && directNestedObj) {
          valueReg = this.generateInterfaceObject(directNestedObj, params, directNestedInterface);
        } else {
          if (tsType && !objectLiteralKeys.has(fieldName)) {
            this.ctx.setCurrentDeclaredInterfaceType(tsType);
          }
          valueReg = this.ctx.generateExpression(valueExpr, params);
        }
        this.ctx.setExpectedArrayElementType(savedExpectedType);
        this.ctx.setCurrentDeclaredInterfaceType(savedDeclaredInterface);
        finalValue = valueReg;
        const valueType = this.ctx.getVariableType(valueReg) || "double";
        if (fieldLlvmType === "i1") {
          if (valueType === "i1") {
            finalValue = valueReg;
          } else if (valueType === "i64") {
            const i1Value = this.nextTemp();
            this.emit(`${i1Value} = icmp ne i64 ${valueReg}, 0`);
            finalValue = i1Value;
          } else {
            const dbl = this.ctx.ensureDouble(valueReg);
            const i1Value = emitFcmp(this.ctx, "one", dbl, "0.0");
            finalValue = i1Value;
          }
        } else if (fieldLlvmType === "double") {
          if (valueType.indexOf("*") !== -1) {
            const isTreeSitterType =
              valueType === "%TSNode*" ||
              valueType === "%TSTree*" ||
              valueType === "%TSParser*" ||
              valueType === "%TSLanguage*";
            if (!isTreeSitterType) {
              const cmpNull = this.nextTemp();
              this.emit(`${cmpNull} = icmp ne ${valueType} ${valueReg}, null`);
              const zext = emitZext(this.ctx, cmpNull, "i1", "i32");
              const asDouble = emitSitofp(this.ctx, zext, "i32");
              finalValue = asDouble;
            }
          } else {
            finalValue = this.ctx.ensureDouble(valueReg);
          }
        }
      }

      orderedFields.push({ key: fieldName, llvmType: fieldLlvmType, value: finalValue });
    }

    const structType = `%${interfaceName}`;
    const structSize = this.ctx.interfaceStructGen?.getStructSize(interfaceName) ?? 0;

    const objPtr = this.allocateStruct(structType, structSize);

    for (let i = 0; i < orderedFields.length; i++) {
      const field = orderedFields[i] as { key: string; llvmType: string; value: string };
      const fieldPtr = this.nextTemp();
      this.emit(
        `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${objPtr}, i32 0, i32 ${i}`,
      );
      const isTreeSitterType =
        field.llvmType === "%TSNode*" ||
        field.llvmType === "%TSTree*" ||
        field.llvmType === "%TSParser*" ||
        field.llvmType === "%TSLanguage*";
      if (isTreeSitterType) {
        const valI64 = this.nextTemp();
        this.emit(`${valI64} = bitcast double ${field.value} to i64`);
        const valPtr = emitInttoptr(this.ctx, valI64, "i64", field.llvmType);
        this.emit(`store ${field.llvmType} ${valPtr}, ${field.llvmType}* ${fieldPtr}`);
      } else if (field.llvmType === "double") {
        const dblValue = this.ctx.ensureDouble(field.value);
        this.emit(`store double ${dblValue}, double* ${fieldPtr}`);
      } else {
        this.emit(`store ${field.llvmType} ${field.value}, ${field.llvmType}* ${fieldPtr}`);
      }
    }

    const genericPtr = this.nextTemp();
    this.emit(`${genericPtr} = bitcast ${structType}* ${objPtr} to i8*`);

    this.ctx.setVariableType(genericPtr, "i8*");

    return genericPtr;
  }

  private generateInlineObject(objExpr: ObjectNode, params: string[]): string {
    const fieldTypes: { key: string; llvmType: string; value: string }[] = [];

    for (let i = 0; i < objExpr.properties.length; i++) {
      const prop = objExpr.properties[i] as ObjectProperty;
      const key = prop.key;

      const valueReg = this.ctx.generateExpression(prop.value, params);

      const generatedType = this.ctx.getVariableType(valueReg);
      let llvmType: string;

      if (generatedType === "%StringMap" || generatedType === "%StringMap*") {
        llvmType = "%StringMap*";
      } else if (generatedType === "%Map" || generatedType === "%Map*") {
        llvmType = "%Map*";
      } else if (generatedType === "%StringSet" || generatedType === "%StringSet*") {
        llvmType = "%StringSet*";
      } else if (generatedType === "%Set" || generatedType === "%Set*") {
        llvmType = "%Set*";
      } else if (generatedType && generatedType !== "double" && generatedType !== "i64") {
        llvmType = generatedType;
      } else if (prop.value.type === "string" || this.ctx.isStringExpression(prop.value)) {
        llvmType = "i8*";
      } else if (this.ctx.isStringArrayExpression(prop.value)) {
        llvmType = "%StringArray*";
      } else if (prop.value.type === "array" || this.ctx.isArrayExpression(prop.value)) {
        llvmType = "%Array*";
      } else if (prop.value.type === "map") {
        llvmType = "%Map*";
      } else if (prop.value.type === "set") {
        llvmType = "%Set*";
      } else if (prop.value.type === "object") {
        llvmType = "i8*";
      } else {
        llvmType = "double";
      }

      let finalValue = valueReg;
      if (llvmType === "i1") {
        if (generatedType === "i1") {
          finalValue = valueReg;
        } else if (generatedType === "i64") {
          const i1Value = this.nextTemp();
          this.emit(`${i1Value} = icmp ne i64 ${valueReg}, 0`);
          finalValue = i1Value;
        } else {
          const dbl = this.ctx.ensureDouble(valueReg);
          const i1Value = emitFcmp(this.ctx, "one", dbl, "0.0");
          finalValue = i1Value;
        }
      } else if (llvmType === "double") {
        finalValue = this.ctx.ensureDouble(valueReg);
      }

      fieldTypes.push({ key, llvmType, value: finalValue });
    }

    const llvmTypes: string[] = [];
    for (let i = 0; i < fieldTypes.length; i++) {
      const ft = fieldTypes[i] as { key: string; llvmType: string; value: string };
      llvmTypes.push(ft.llvmType);
    }
    const structFields = llvmTypes.join(", ");
    const structSizeBytes = fieldTypes.length * 8;
    const structType = `{ ${structFields} }`;

    const objPtr = this.allocateStruct(structType, structSizeBytes);

    for (let i = 0; i < fieldTypes.length; i++) {
      const field = fieldTypes[i] as { key: string; llvmType: string; value: string };
      const fieldPtr = this.nextTemp();
      this.emit(
        `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${objPtr}, i32 0, i32 ${i}`,
      );
      const valueType = this.ctx.getVariableType(field.value);
      let storeValue = field.value;
      const isTreeSitterType =
        field.llvmType === "%TSNode*" ||
        field.llvmType === "%TSTree*" ||
        field.llvmType === "%TSParser*" ||
        field.llvmType === "%TSLanguage*";
      if (isTreeSitterType) {
        const valI64 = this.nextTemp();
        this.emit(`${valI64} = bitcast double ${field.value} to i64`);
        storeValue = emitInttoptr(this.ctx, valI64, "i64", field.llvmType);
      } else if (valueType === "i32" && field.llvmType.indexOf("*") !== -1) {
        storeValue = emitInttoptr(this.ctx, field.value, "i32", field.llvmType);
      }
      this.emit(`store ${field.llvmType} ${storeValue}, ${field.llvmType}* ${fieldPtr}`);
    }

    const genericPtr = this.nextTemp();
    this.emit(`${genericPtr} = bitcast ${structType}* ${objPtr} to i8*`);

    this.ctx.setVariableType(genericPtr, "i8*");

    return genericPtr;
  }
}
