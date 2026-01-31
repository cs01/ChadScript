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

    // Check if we have an interface type for this object
    let interfaceTypes: Map<string, string> | undefined;
    const declaredInterfaceType = (this.ctx as any).currentDeclaredInterfaceType;
    if (declaredInterfaceType) {
      const iface = (this.ctx as any).ast?.interfaces?.find((i: any) => i.name === declaredInterfaceType);
      if (iface) {
        interfaceTypes = new Map();
        for (const field of iface.fields) {
          let llvmType: string;
          if (field.type === 'string') llvmType = 'i8*';
          else if (field.type === 'number') llvmType = 'double';
          else if (field.type === 'boolean') llvmType = 'i1';
          else if (field.type === 'string[]') llvmType = '%StringArray*';
          else if (field.type === 'number[]' || field.type === 'boolean[]') llvmType = '%Array*';
          else llvmType = 'i8*';
          interfaceTypes.set(field.name, llvmType);
        }
      }
    }

    // NEW: Analyze property types to determine struct layout
    const fieldTypes: { key: string; llvmType: string; value: string }[] = [];

    for (let i = 0; i < objExpr.properties.length; i++) {
      const prop = objExpr.properties[i];
      const key = prop.key;

      // Determine LLVM type - from interface if available, otherwise infer
      let llvmType: string;
      if (interfaceTypes?.has(key)) {
        llvmType = interfaceTypes.get(key)!;
      } else {
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
      }

      // Generate the value expression using context
      const valueReg = this.ctx.generateExpression(prop.value, params);

      // Convert value if needed (e.g., double to i1 for booleans)
      let finalValue = valueReg;
      if (llvmType === 'i1') {
        // Convert double (boolean represented as 0.0/1.0) to i1
        const i1Value = this.nextTemp();
        this.emit(`${i1Value} = fcmp one double ${valueReg}, 0.0`);
        finalValue = i1Value;
      }

      fieldTypes.push({ key, llvmType, value: finalValue });
    }

    // Generate struct type signature (using inline struct, no need for name)
    const structFields = fieldTypes.map(f => f.llvmType).join(', ');

    // Calculate struct size (rough estimate - actual size computed by LLVM)
    const structSizeBytes = fieldTypes.length * 8;  // Conservative: 8 bytes per field

    // Allocate struct on heap
    const objMem = this.nextTemp();
    this.emit(`${objMem} = call i8* @GC_malloc(i64 ${structSizeBytes})`);

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
