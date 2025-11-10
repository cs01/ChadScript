import { Expression, MethodCallNode } from '../../ast/types.js';
import { BaseGenerator } from './base-generator.js';

// ============================================
// ARRAY GENERATOR - Array operations
// ============================================

export class ArrayGenerator extends BaseGenerator {
  // Generate delegate for expressions (set by LLVMGenerator)
  generateExpression!: (expr: Expression, params: string[]) => string;

  generateArrayLiteral(expr: Expression, params: string[]): string {
    if (expr.type !== 'array') {
      throw new Error('Expected array literal');
    }

    const length = expr.elements.length;

    // Allocate array struct on stack
    const arrayPtr = this.nextTemp();
    this.emit(`${arrayPtr} = alloca %Array`);

    // Allocate data array on heap (i32* with length elements)
    const dataSize = this.nextTemp();
    this.emit(`${dataSize} = mul i64 ${length}, 4`); // 4 bytes per i32
    const dataMem = this.nextTemp();
    this.emit(`${dataMem} = call i8* @malloc(i64 ${dataSize})`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = bitcast i8* ${dataMem} to i32*`);

    // Store each element
    for (let i = 0; i < expr.elements.length; i++) {
      const elemValue = this.generateExpression(expr.elements[i], params);
      const elemPtr = this.nextTemp();
      this.emit(`${elemPtr} = getelementptr inbounds i32, i32* ${dataPtr}, i32 ${i}`);
      this.emit(`store i32 ${elemValue}, i32* ${elemPtr}`);
    }

    // Store data pointer in array struct (field 0)
    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    this.emit(`store i32* ${dataPtr}, i32** ${dataPtrField}`);

    // Store length in array struct (field 1)
    const lenField = this.nextTemp();
    this.emit(`${lenField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    this.emit(`store i32 ${length}, i32* ${lenField}`);

    // Store capacity in array struct (field 2)
    const capField = this.nextTemp();
    this.emit(`${capField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
    this.emit(`store i32 ${length}, i32* ${capField}`);

    return arrayPtr;
  }

  generateArrayPush(expr: MethodCallNode, params: string[]): string {
    // arr.push(value) - adds value to array and returns new length
    if (expr.args.length !== 1) {
      throw new Error('push() requires exactly 1 argument');
    }

    const arrayPtr = this.generateExpression(expr.object, params);
    const value = this.generateExpression(expr.args[0], params);

    // Load current length
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    const currentLen = this.nextTemp();
    this.emit(`${currentLen} = load i32, i32* ${lenPtr}`);

    // Load current capacity
    const capPtr = this.nextTemp();
    this.emit(`${capPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
    const currentCap = this.nextTemp();
    this.emit(`${currentCap} = load i32, i32* ${capPtr}`);

    // Check if we need to resize (length == capacity)
    const needResize = this.nextTemp();
    this.emit(`${needResize} = icmp eq i32 ${currentLen}, ${currentCap}`);

    // Create labels for resize and continue paths
    const resizeLabel = this.nextLabel('resize');
    const continueLabel = this.nextLabel('continue');

    this.emit(`br i1 ${needResize}, label %${resizeLabel}, label %${continueLabel}`);

    // Resize block
    this.emit(`${resizeLabel}:`);
    const newCap = this.nextTemp();
    this.emit(`${newCap} = mul i32 ${currentCap}, 2`);

    // Allocate new data array
    const newSize = this.nextTemp();
    this.emit(`${newSize} = mul i32 ${newCap}, 4`);
    const newSizeI64 = this.nextTemp();
    this.emit(`${newSizeI64} = zext i32 ${newSize} to i64`);
    const newMem = this.nextTemp();
    this.emit(`${newMem} = call i8* @malloc(i64 ${newSizeI64})`);
    const newDataPtr = this.nextTemp();
    this.emit(`${newDataPtr} = bitcast i8* ${newMem} to i32*`);

    // Copy old data to new array
    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const oldDataPtr = this.nextTemp();
    this.emit(`${oldDataPtr} = load i32*, i32** ${dataPtrField}`);

    const oldDataI8 = this.nextTemp();
    this.emit(`${oldDataI8} = bitcast i32* ${oldDataPtr} to i8*`);
    const newDataI8 = this.nextTemp();
    this.emit(`${newDataI8} = bitcast i32* ${newDataPtr} to i8*`);
    const copySize = this.nextTemp();
    this.emit(`${copySize} = mul i32 ${currentLen}, 4`);
    const copySizeI64 = this.nextTemp();
    this.emit(`${copySizeI64} = zext i32 ${copySize} to i64`);
    this.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newDataI8}, i8* ${oldDataI8}, i64 ${copySizeI64}, i1 false)`);

    // Free old data and update pointer
    this.emit(`call void @free(i8* ${oldDataI8})`);
    this.emit(`store i32* ${newDataPtr}, i32** ${dataPtrField}`);

    // Update capacity
    this.emit(`store i32 ${newCap}, i32* ${capPtr}`);

    this.emit(`br label %${continueLabel}`);

    // Continue block
    this.emit(`${continueLabel}:`);

    // Get current data pointer (may have been updated)
    const dataPtrField2 = this.nextTemp();
    this.emit(`${dataPtrField2} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load i32*, i32** ${dataPtrField2}`);

    // Store value at current length index
    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds i32, i32* ${dataPtr}, i32 ${currentLen}`);
    this.emit(`store i32 ${value}, i32* ${elemPtr}`);

    // Increment length
    const newLen = this.nextTemp();
    this.emit(`${newLen} = add i32 ${currentLen}, 1`);
    this.emit(`store i32 ${newLen}, i32* ${lenPtr}`);

    // Return new length
    return newLen;
  }

  generateArrayMap(expr: MethodCallNode, params: string[]): string {
    // For now, we'll implement a simple version that doesn't support callback functions
    // This is a placeholder that will need proper function pointer support
    throw new Error('map() method requires function pointer support (not yet implemented)');
  }

  generateArrayJoin(expr: MethodCallNode, params: string[]): string {
    // arr.join(separator) - returns a string (i8*)
    // For simplicity, we'll implement join with a string separator
    if (expr.args.length !== 1) {
      throw new Error('join() requires exactly 1 argument (separator)');
    }

    const arrayPtr = this.generateExpression(expr.object, params);
    const separator = this.generateExpression(expr.args[0], params);

    // Get array length
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    const length = this.nextTemp();
    this.emit(`${length} = load i32, i32* ${lenPtr}`);

    // Get data pointer
    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load i32*, i32** ${dataPtrField}`);

    // For simplicity, we'll allocate a fixed-size buffer for the result
    // In a real implementation, we'd calculate the exact size needed
    const bufferSize = 1024; // Fixed size for demo
    const resultBuffer = this.nextTemp();
    this.emit(`${resultBuffer} = call i8* @malloc(i64 ${bufferSize})`);

    // Initialize buffer with empty string
    const nullByte = this.nextTemp();
    this.emit(`${nullByte} = getelementptr inbounds i8, i8* ${resultBuffer}, i64 0`);
    this.emit(`store i8 0, i8* ${nullByte}`);

    // For now, return a simple implementation that concatenates numbers
    // A complete implementation would need sprintf or similar to convert i32 to string
    // This is a simplified placeholder
    return resultBuffer;
  }
}
