import { Expression } from '../../../ast/types.js';
import { IGeneratorContext } from '../../infrastructure/generator-context.js';

// ============================================
// OBJECT GENERATOR - Object operations
// ============================================

/**
 * 🎯 Object generator using clean context pattern!
 * No more callback binding - just pure dependency injection!
 */
export class ObjectGenerator {
  constructor(private ctx: IGeneratorContext) {}

  // Helper methods that delegate to context - beautiful and explicit!
  private nextTemp() { return this.ctx.nextTemp(); }
  private emit(instruction: string) { this.ctx.emit(instruction); }
  private get stringVariables() { return (this.ctx as any).stringVariables; } // Legacy map

  generateObjectLiteral(expr: Expression, params: string[]): string {
    const objExpr = expr as any;
    if (objExpr.type !== 'object') {
      throw new Error('Expected object literal');
    }

    const keys = objExpr.properties.map((p: any) => p.key);
    const numFields = keys.length;

    if (numFields === 0) {
      // Empty object - just return null pointer
      return '0';
    }

    // NEW: Analyze property types to determine struct layout
    const fieldTypes: { key: string; llvmType: string; value: string }[] = [];

    for (let i = 0; i < objExpr.properties.length; i++) {
      const prop = objExpr.properties[i];
      const key = prop.key;

      // Generate the value expression using context
      const valueReg = this.ctx.generateExpression(prop.value, params);

      // Determine LLVM type based on expression type
      let llvmType: string;
      const valueExpr = prop.value;

      if (valueExpr.type === 'string' || this.ctx.isStringExpression(valueExpr)) {
        llvmType = 'i8*';  // String pointer
      } else if (valueExpr.type === 'array') {
        llvmType = '%Array*';  // Array struct pointer
      } else if ((valueExpr as any).type === 'map') {
        llvmType = '%Map*';
      } else if ((valueExpr as any).type === 'set') {
        llvmType = '%Set*';
      } else {
        llvmType = 'double';  // Default to double (numbers, booleans)
      }

      fieldTypes.push({ key, llvmType, value: valueReg });
    }

    // Generate struct type signature (using inline struct, no need for name)
    const structFields = fieldTypes.map(f => f.llvmType).join(', ');

    // Calculate struct size (rough estimate - actual size computed by LLVM)
    const structSizeBytes = fieldTypes.length * 8;  // Conservative: 8 bytes per field

    // Allocate struct on heap
    const objMem = this.nextTemp();
    this.emit(`${objMem} = call i8* @malloc(i64 ${structSizeBytes})`);

    // Cast to struct pointer (we'll use inline struct type)
    const structType = `{ ${structFields} }`;
    const objPtr = this.nextTemp();
    this.emit(`${objPtr} = bitcast i8* ${objMem} to ${structType}*`);

    // Store each field value
    for (let i = 0; i < fieldTypes.length; i++) {
      const field = fieldTypes[i];
      const fieldPtr = this.nextTemp();
      this.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${objPtr}, i32 0, i32 ${i}`);
      this.emit(`store ${field.llvmType} ${field.value}, ${field.llvmType}* ${fieldPtr}`);
    }

    // Return as i8* generic pointer (we'll track the actual type separately)
    const genericPtr = this.nextTemp();
    this.emit(`${genericPtr} = bitcast ${structType}* ${objPtr} to i8*`);

    return genericPtr;
  }

}
