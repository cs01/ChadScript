import { Expression, ObjectNode } from '../../../ast/types.js';
import { IGeneratorContext } from '../../infrastructure/generator-context.js';
import type { InterfaceStructGenerator } from '../interface-struct-generator.js';

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
      keys.push(objExpr.properties[i].key);
    }
    const numFields = keys.length;

    if (numFields === 0) {
      return '0';
    }

    const declaredInterfaceType = this.ctx.currentDeclaredInterfaceType;
    const interfaceStructGen = this.ctx.interfaceStructGen;

    if (declaredInterfaceType && interfaceStructGen?.hasInterface(declaredInterfaceType)) {
      return this.generateInterfaceObject(objExpr, params, declaredInterfaceType, interfaceStructGen);
    }

    return this.generateInlineObject(objExpr, params);
  }

  private generateInterfaceObject(objExpr: ObjectNode, params: string[], interfaceName: string, interfaceStructGen: InterfaceStructGenerator): string {
    const ifaceInfo = interfaceStructGen.getInterfaceStruct(interfaceName);
    if (!ifaceInfo) {
      return this.generateInlineObject(objExpr, params);
    }

    const propMap = new Map<string, Expression>();
    for (let i = 0; i < objExpr.properties.length; i++) {
      propMap.set(objExpr.properties[i].key, objExpr.properties[i].value);
    }

    const orderedFields: { key: string; llvmType: string; value: string }[] = [];

    for (const field of ifaceInfo.fields) {
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
    const structSize = interfaceStructGen.getStructSize(interfaceName);

    const objMem = this.nextTemp();
    this.emit(`${objMem} = call i8* @GC_malloc(i64 ${structSize})`);

    const objPtr = this.nextTemp();
    this.emit(`${objPtr} = bitcast i8* ${objMem} to ${structType}*`);

    for (let i = 0; i < orderedFields.length; i++) {
      const field = orderedFields[i];
      const fieldPtr = this.nextTemp();
      this.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${objPtr}, i32 0, i32 ${i}`);
      this.emit(`store ${field.llvmType} ${field.value}, ${field.llvmType}* ${fieldPtr}`);
    }

    const genericPtr = this.nextTemp();
    this.emit(`${genericPtr} = bitcast ${structType}* ${objPtr} to i8*`);

    return genericPtr;
  }

  private generateInlineObject(objExpr: ObjectNode, params: string[]): string {
    const fieldTypes: { key: string; llvmType: string; value: string }[] = [];

    for (let i = 0; i < objExpr.properties.length; i++) {
      const key = objExpr.properties[i].key;

      let llvmType: string;
      if (objExpr.properties[i].value.type === 'string' || this.ctx.isStringExpression(objExpr.properties[i].value)) {
        llvmType = 'i8*';
      } else if (objExpr.properties[i].value.type === 'array') {
        llvmType = '%Array*';
      } else if (objExpr.properties[i].value.type === 'map') {
        llvmType = '%Map*';
      } else if (objExpr.properties[i].value.type === 'set') {
        llvmType = '%Set*';
      } else {
        llvmType = 'double';
      }

      const valueReg = this.ctx.generateExpression(objExpr.properties[i].value, params);

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
      llvmTypes.push(fieldTypes[i].llvmType);
    }
    const structFields = llvmTypes.join(', ');
    const structSizeBytes = fieldTypes.length * 8;

    const objMem = this.nextTemp();
    this.emit(`${objMem} = call i8* @GC_malloc(i64 ${structSizeBytes})`);

    const structType = `{ ${structFields} }`;
    const objPtr = this.nextTemp();
    this.emit(`${objPtr} = bitcast i8* ${objMem} to ${structType}*`);

    for (let i = 0; i < fieldTypes.length; i++) {
      const field = fieldTypes[i];
      const fieldPtr = this.nextTemp();
      this.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${objPtr}, i32 0, i32 ${i}`);
      this.emit(`store ${field.llvmType} ${field.value}, ${field.llvmType}* ${fieldPtr}`);
    }

    const genericPtr = this.nextTemp();
    this.emit(`${genericPtr} = bitcast ${structType}* ${objPtr} to i8*`);

    return genericPtr;
  }

}
