import { Expression } from '../../ast/types.js';
import { BaseGenerator } from './base-generator.js';

// ============================================
// OBJECT GENERATOR - Object operations
// ============================================

export class ObjectGenerator extends BaseGenerator {
  // Generate delegate for expressions (set by LLVMGenerator)
  generateExpression!: (expr: Expression, params: string[]) => string;

  generateObjectLiteral(expr: Expression, params: string[]): string {
    const objExpr = expr as any;
    if (objExpr.type !== 'object') {
      throw new Error('Expected object literal');
    }

    const keys = objExpr.properties.map((p: any) => p.key);
    const numFields = keys.length;

    // For simplicity, we'll represent objects as an array of i32 values
    // In a real implementation, we'd want typed structs or a more sophisticated representation
    // For now: { x: 5, y: 10 } becomes [5, 10] with keys tracked separately

    // Allocate array on heap
    const objSize = this.nextTemp();
    this.emit(`${objSize} = mul i64 ${numFields}, 4`); // 4 bytes per i32
    const objMem = this.nextTemp();
    this.emit(`${objMem} = call i8* @malloc(i64 ${objSize})`);
    const objPtr = this.nextTemp();
    this.emit(`${objPtr} = bitcast i8* ${objMem} to i32*`);

    // Store each property value
    for (let i = 0; i < objExpr.properties.length; i++) {
      const propValue = this.generateExpression(objExpr.properties[i].value, params);
      const fieldPtr = this.nextTemp();
      this.emit(`${fieldPtr} = getelementptr inbounds i32, i32* ${objPtr}, i32 ${i}`);
      this.emit(`store i32 ${propValue}, i32* ${fieldPtr}`);
    }

    return objPtr;
  }
}
