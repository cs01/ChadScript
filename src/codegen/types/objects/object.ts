import { Expression, ObjectNode, ObjectProperty } from '../../../ast/types.js';
import { IGeneratorContext } from '../../infrastructure/generator-context.js';
import type { InterfaceStructGenerator } from '../interface-struct-generator.js';
import { tsTypeToLlvm as tsTypeToLlvmUtil } from '../../infrastructure/type-system.js';

interface ObjectGeneratorContext extends IGeneratorContext {
  currentDeclaredInterfaceType?: string;
  interfaceStructGen?: InterfaceStructGenerator;
}

export class ObjectGenerator {
  constructor(private ctx: ObjectGeneratorContext) {}

  private nextTemp() { return this.ctx.nextTemp(); }
  private emit(instruction: string) { this.ctx.emit(instruction); }

  generateObjectLiteral(expr: Expression, params: string[]): string {
    if (expr.type !== 'object') {
      throw new Error('Expected object literal');
    }
    const objExpr = expr as ObjectNode;

    const keys: string[] = [];
    for (let i = 0; i < objExpr.properties.length; i++) {
      const prop = objExpr.properties[i] as ObjectProperty;
      keys.push(prop.key);
    }
    const numFields = keys.length;

    if (numFields === 0) {
      return 'null';
    }

    const declaredInterfaceType = this.ctx.currentDeclaredInterfaceType;

    if (declaredInterfaceType && declaredInterfaceType.startsWith('{')) {
      return this.generateInlineInterfaceObject(objExpr, params, declaredInterfaceType);
    }

    if (declaredInterfaceType && this.ctx.interfaceStructGen && this.ctx.interfaceStructGen.hasInterface(declaredInterfaceType)) {
      return this.generateInterfaceObject(objExpr, params, declaredInterfaceType);
    }

    return this.generateInlineObject(objExpr, params);
  }

  private parseInlineInterfaceFields(typeStr: string): { name: string; type: string }[] {
    if (!typeStr.startsWith('{') || !typeStr.endsWith('}')) {
      return [];
    }
    const inner = typeStr.slice(1, typeStr.length - 1).trim();
    if (inner.length === 0) {
      return [];
    }
    const fields: { name: string; type: string }[] = [];
    const parts = inner.split(';');
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (!part) continue;
      const colonIdx = part.indexOf(':');
      if (colonIdx === -1) continue;
      let name = part.slice(0, colonIdx).trim();
      const fieldType = part.slice(colonIdx + 1).trim();
      if (name.endsWith('?')) {
        name = name.slice(0, -1);
      }
      fields.push({ name, type: fieldType });
    }
    return fields;
  }

  private tsTypeToLlvm(tsType: string): string {
    return tsTypeToLlvmUtil(tsType);
  }

  private generateInlineInterfaceObject(objExpr: ObjectNode, params: string[], typeStr: string): string {
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
        if (llvmType === 'double') {
          finalValue = '0.0';
        } else {
          finalValue = 'null';
        }
      } else {
        finalValue = this.ctx.generateExpression(valueExpr, params);
      }

      orderedFields.push({ key: field.name, llvmType, value: finalValue });
    }

    const llvmTypes: string[] = [];
    for (let i = 0; i < orderedFields.length; i++) {
      const ft = orderedFields[i] as { key: string; llvmType: string; value: string };
      llvmTypes.push(ft.llvmType);
    }
    const structFields = llvmTypes.join(', ');
    const structSizeBytes = orderedFields.length * 8;

    const objMem = this.nextTemp();
    this.emit(`${objMem} = call i8* @GC_malloc(i64 ${structSizeBytes})`);

    const structType = `{ ${structFields} }`;
    const objPtr = this.nextTemp();
    this.emit(`${objPtr} = bitcast i8* ${objMem} to ${structType}*`);

    for (let i = 0; i < orderedFields.length; i++) {
      const field = orderedFields[i] as { key: string; llvmType: string; value: string };
      const fieldPtr = this.nextTemp();
      this.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${objPtr}, i32 0, i32 ${i}`);
      this.emit(`store ${field.llvmType} ${field.value}, ${field.llvmType}* ${fieldPtr}`);
    }

    const genericPtr = this.nextTemp();
    this.emit(`${genericPtr} = bitcast ${structType}* ${objPtr} to i8*`);

    this.ctx.setVariableType(genericPtr, 'i8*');

    return genericPtr;
  }

  private generateInterfaceObject(objExpr: ObjectNode, params: string[], interfaceName: string): string {
    const ifaceInfo = this.ctx.interfaceStructGen!.getInterfaceStruct(interfaceName);
    if (!ifaceInfo) {
      return this.generateInlineObject(objExpr, params);
    }

    const propMap = new Map<string, Expression>();
    for (let i = 0; i < objExpr.properties.length; i++) {
      const prop = objExpr.properties[i] as ObjectProperty;
      propMap.set(prop.key, prop.value);
    }

    const orderedFields: { key: string; llvmType: string; value: string }[] = [];

    for (let fieldIdx = 0; fieldIdx < ifaceInfo.fields.length; fieldIdx++) {
      const field = ifaceInfo.fields[fieldIdx] as { name: string; tsType: string; llvmType: string };
      const valueExpr = propMap.get(field.name);
      let finalValue: string;

      if (!valueExpr) {
        if (field.llvmType === 'double') {
          finalValue = '0.0';
        } else if (field.llvmType === 'i8*') {
          finalValue = 'null';
        } else if (field.llvmType === 'i1') {
          finalValue = 'false';
        } else {
          finalValue = 'null';
        }
      } else {
        const valueReg = this.ctx.generateExpression(valueExpr, params);
        finalValue = valueReg;
        if (field.llvmType === 'i1') {
          const i1Value = this.nextTemp();
          this.emit(`${i1Value} = fcmp one double ${valueReg}, 0.0`);
          finalValue = i1Value;
        }
      }

      orderedFields.push({ key: field.name, llvmType: field.llvmType, value: finalValue });
    }

    const structType = `%${interfaceName}`;
    const structSize = this.ctx.interfaceStructGen!.getStructSize(interfaceName);

    const objMem = this.nextTemp();
    this.emit(`${objMem} = call i8* @GC_malloc(i64 ${structSize})`);

    const objPtr = this.nextTemp();
    this.emit(`${objPtr} = bitcast i8* ${objMem} to ${structType}*`);

    for (let i = 0; i < orderedFields.length; i++) {
      const field = orderedFields[i] as { key: string; llvmType: string; value: string };
      const fieldPtr = this.nextTemp();
      this.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${objPtr}, i32 0, i32 ${i}`);
      this.emit(`store ${field.llvmType} ${field.value}, ${field.llvmType}* ${fieldPtr}`);
    }

    const genericPtr = this.nextTemp();
    this.emit(`${genericPtr} = bitcast ${structType}* ${objPtr} to i8*`);

    this.ctx.setVariableType(genericPtr, 'i8*');

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

      if (generatedType && generatedType !== 'double') {
        llvmType = generatedType;
      } else if (prop.value.type === 'string' || this.ctx.isStringExpression(prop.value)) {
        llvmType = 'i8*';
      } else if (this.ctx.isStringArrayExpression(prop.value)) {
        llvmType = '%StringArray*';
      } else if (prop.value.type === 'array' || this.ctx.isArrayExpression(prop.value)) {
        llvmType = '%Array*';
      } else if (prop.value.type === 'map') {
        llvmType = '%Map*';
      } else if (prop.value.type === 'set') {
        llvmType = '%Set*';
      } else if (prop.value.type === 'object') {
        llvmType = 'i8*';
      } else {
        llvmType = 'double';
      }

      let finalValue = valueReg;
      if (llvmType === 'i1') {
        const i1Value = this.nextTemp();
        this.emit(`${i1Value} = fcmp one double ${valueReg}, 0.0`);
        finalValue = i1Value;
      }

      fieldTypes.push({ key, llvmType, value: finalValue });
    }

    const llvmTypes: string[] = [];
    for (let i = 0; i < fieldTypes.length; i++) {
      const ft = fieldTypes[i] as { key: string; llvmType: string; value: string };
      llvmTypes.push(ft.llvmType);
    }
    const structFields = llvmTypes.join(', ');
    const structSizeBytes = fieldTypes.length * 8;

    const objMem = this.nextTemp();
    this.emit(`${objMem} = call i8* @GC_malloc(i64 ${structSizeBytes})`);

    const structType = `{ ${structFields} }`;
    const objPtr = this.nextTemp();
    this.emit(`${objPtr} = bitcast i8* ${objMem} to ${structType}*`);

    for (let i = 0; i < fieldTypes.length; i++) {
      const field = fieldTypes[i] as { key: string; llvmType: string; value: string };
      const fieldPtr = this.nextTemp();
      this.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${objPtr}, i32 0, i32 ${i}`);
      const valueType = this.ctx.getVariableType(field.value);
      let storeValue = field.value;
      if (valueType === 'i32' && field.llvmType.indexOf('*') !== -1) {
        const ptrValue = this.nextTemp();
        this.emit(`${ptrValue} = inttoptr i32 ${field.value} to ${field.llvmType}`);
        storeValue = ptrValue;
      }
      this.emit(`store ${field.llvmType} ${storeValue}, ${field.llvmType}* ${fieldPtr}`);
    }

    const genericPtr = this.nextTemp();
    this.emit(`${genericPtr} = bitcast ${structType}* ${objPtr} to i8*`);

    this.ctx.setVariableType(genericPtr, 'i8*');

    return genericPtr;
  }

}
