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

  generateSubstr(strPtr: string, startIndex: string, length: string | null): string {
    // Get the original string length
    const strLen = this.nextTemp();
    this.emit(`${strLen} = call i64 @strlen(i8* ${strPtr})`);
    const strLenI32 = this.nextTemp();
    this.emit(`${strLenI32} = trunc i64 ${strLen} to i32`);

    // Calculate the actual start position (handle negative indices)
    const startI32 = startIndex;

    // If length is not provided, calculate length as (strLen - start)
    let substrLen: string;
    if (length === null) {
      substrLen = this.nextTemp();
      this.emit(`${substrLen} = sub i32 ${strLenI32}, ${startI32}`);
    } else {
      substrLen = length;
    }

    // Clamp substrLen to ensure it doesn't exceed remaining string length
    const remainingLen = this.nextTemp();
    this.emit(`${remainingLen} = sub i32 ${strLenI32}, ${startI32}`);

    const isLenTooLarge = this.nextTemp();
    this.emit(`${isLenTooLarge} = icmp sgt i32 ${substrLen}, ${remainingLen}`);

    const clampedLen = this.nextTemp();
    this.emit(`${clampedLen} = select i1 ${isLenTooLarge}, i32 ${remainingLen}, i32 ${substrLen}`);

    // Ensure length is non-negative
    const isNegative = this.nextTemp();
    this.emit(`${isNegative} = icmp slt i32 ${clampedLen}, 0`);

    const finalLen = this.nextTemp();
    this.emit(`${finalLen} = select i1 ${isNegative}, i32 0, i32 ${clampedLen}`);

    // Convert finalLen to i64 for allocation
    const finalLenI64 = this.nextTemp();
    this.emit(`${finalLenI64} = sext i32 ${finalLen} to i64`);

    // Allocate memory for the substring (+1 for null terminator)
    const allocLen = this.nextTemp();
    this.emit(`${allocLen} = add i64 ${finalLenI64}, 1`);

    const resultPtr = this.nextTemp();
    this.emit(`${resultPtr} = call i8* @malloc(i64 ${allocLen})`);

    // Calculate source pointer (strPtr + start)
    const startI64 = this.nextTemp();
    this.emit(`${startI64} = sext i32 ${startI32} to i64`);

    const srcPtr = this.nextTemp();
    this.emit(`${srcPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${startI64}`);

    // Copy the substring using memcpy
    this.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${resultPtr}, i8* ${srcPtr}, i64 ${finalLenI64}, i1 false)`);

    // Add null terminator
    const nullPtr = this.nextTemp();
    this.emit(`${nullPtr} = getelementptr inbounds i8, i8* ${resultPtr}, i64 ${finalLenI64}`);
    this.emit(`store i8 0, i8* ${nullPtr}`);

    return resultPtr;
  }
}
