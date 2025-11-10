import { Expression } from '../../ast/types.js';
import { BaseGenerator } from './base-generator.js';

// ============================================
// STRING GENERATOR - String operations
// ============================================

export class StringGenerator extends BaseGenerator {
  // Generate delegate for expressions (set by LLVMGenerator)
  generateExpression!: (expr: Expression, params: string[]) => string;

  createStringConstant(value: string): string {
    // Escape special characters for LLVM
    const escaped = value
      .replace(/\\/g, '\\5C')
      .replace(/\n/g, '\\0A')
      .replace(/\t/g, '\\09')
      .replace(/\r/g, '\\0D')
      .replace(/"/g, '\\"');

    const length = value.length + 1; // +1 for null terminator
    const globalName = this.nextString();

    // Create global constant string
    this.globalStrings.push(
      `${globalName} = private unnamed_addr constant [${length} x i8] c"${escaped}\\00", align 1`
    );

    // Return a pointer to the string
    const ptrReg = this.nextTemp();
    this.emit(
      `${ptrReg} = getelementptr inbounds [${length} x i8], [${length} x i8]* ${globalName}, i64 0, i64 0`
    );
    return ptrReg;
  }

  generateStringConcat(left: Expression, right: Expression, params: string[]): string {
    // Generate both operands as strings
    const leftStr = this.generateExpression(left, params);
    const rightStr = this.generateExpression(right, params);

    // Get lengths of both strings
    const leftLen = this.nextTemp();
    this.emit(`${leftLen} = call i64 @strlen(i8* ${leftStr})`);
    const rightLen = this.nextTemp();
    this.emit(`${rightLen} = call i64 @strlen(i8* ${rightStr})`);

    // Calculate total length (left + right + 1 for null terminator)
    const totalLen = this.nextTemp();
    this.emit(`${totalLen} = add i64 ${leftLen}, ${rightLen}`);
    const totalLenPlus1 = this.nextTemp();
    this.emit(`${totalLenPlus1} = add i64 ${totalLen}, 1`);

    // Allocate memory for result
    const resultPtr = this.nextTemp();
    this.emit(`${resultPtr} = call i8* @malloc(i64 ${totalLenPlus1})`);

    // Copy left string to result
    const copyResult1 = this.nextTemp();
    this.emit(`${copyResult1} = call i8* @strcpy(i8* ${resultPtr}, i8* ${leftStr})`);

    // Concatenate right string to result
    const concatResult = this.nextTemp();
    this.emit(`${concatResult} = call i8* @strcat(i8* ${resultPtr}, i8* ${rightStr})`);

    return resultPtr;
  }
}
