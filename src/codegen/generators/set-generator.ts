import { Expression, MethodCallNode } from '../../ast/types.js';
import { BaseGenerator } from './base-generator.js';

// ============================================
// SET GENERATOR - Set operations
// ============================================

// Set structure in LLVM:
// %Set = type { i32*, i32, i32 }
// - i32* values  - pointer to value array
// - i32 size     - number of elements
// - i32 capacity - allocated capacity

export class SetGenerator extends BaseGenerator {
  // Generate delegate for expressions (set by LLVMGenerator)
  generateExpression!: (expr: Expression, params: string[]) => string;

  constructor() {
    super();
  }

  generateSetLiteral(expr: Expression, params: string[]): string {
    const setExpr = expr as any;
    if (setExpr.type !== 'set') {
      throw new Error('Expected set literal');
    }

    // Allocate Set struct on stack
    const setPtr = this.nextTemp();
    this.emit(`${setPtr} = alloca %Set`);

    // Initialize with empty array
    const initialCapacity = setExpr.values.length > 4 ? setExpr.values.length : 4;

    // Allocate values array
    const valuesSize = this.nextTemp();
    this.emit(`${valuesSize} = mul i64 ${initialCapacity}, 4`);
    const valuesMem = this.nextTemp();
    this.emit(`${valuesMem} = call i8* @malloc(i64 ${valuesSize})`);
    const valuesPtr = this.nextTemp();
    this.emit(`${valuesPtr} = bitcast i8* ${valuesMem} to i32*`);

    // Store values pointer in Set struct
    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 0`);
    this.emit(`store i32* ${valuesPtr}, i32** ${valuesFieldPtr}`);

    // Store size
    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 1`);
    this.emit(`store i32 ${setExpr.values.length}, i32* ${sizeFieldPtr}`);

    // Store capacity
    const capacityFieldPtr = this.nextTemp();
    this.emit(`${capacityFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 2`);
    this.emit(`store i32 ${initialCapacity}, i32* ${capacityFieldPtr}`);

    // Populate initial values (with deduplication)
    const seen = new Set();
    let actualIndex = 0;
    for (let i = 0; i < setExpr.values.length; i++) {
      const valueExpr = setExpr.values[i];

      // For literal numbers, we can dedupe at compile time
      if ((valueExpr as any).type === 'number') {
        const numVal = (valueExpr as any).value;
        if (seen.has(numVal)) continue;
        seen.add(numVal);
      }

      const valueValue = this.generateExpression(valueExpr, params);

      // Store value
      const valueElemPtr = this.nextTemp();
      this.emit(`${valueElemPtr} = getelementptr inbounds i32, i32* ${valuesPtr}, i32 ${actualIndex}`);
      this.emit(`store i32 ${valueValue}, i32* ${valueElemPtr}`);
      actualIndex++;
    }

    // Update actual size if we deduped
    if (actualIndex !== setExpr.values.length) {
      this.emit(`store i32 ${actualIndex}, i32* ${sizeFieldPtr}`);
    }

    return setPtr;
  }

  generateSetAdd(expr: MethodCallNode, params: string[]): string {
    // set.add(value)
    if (expr.args.length !== 1) {
      throw new Error('Set.add() requires exactly 1 argument');
    }

    // Get set pointer
    const setPtr = this.generateExpression(expr.object, params);

    // Generate value
    const valueToAdd = this.generateExpression(expr.args[0], params);

    // Check if value already exists (simple linear search)
    // Load current array and size
    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 0`);
    const valuesPtr = this.nextTemp();
    this.emit(`${valuesPtr} = load i32*, i32** ${valuesFieldPtr}`);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 1`);
    const currentSize = this.nextTemp();
    this.emit(`${currentSize} = load i32, i32* ${sizeFieldPtr}`);

    // For simplicity, assume value doesn't exist and just add it
    // (In production, we'd check for duplicates)

    // Store value at index = currentSize
    const valueElemPtr = this.nextTemp();
    this.emit(`${valueElemPtr} = getelementptr inbounds i32, i32* ${valuesPtr}, i32 ${currentSize}`);
    this.emit(`store i32 ${valueToAdd}, i32* ${valueElemPtr}`);

    // Increment size
    const newSize = this.nextTemp();
    this.emit(`${newSize} = add i32 ${currentSize}, 1`);
    this.emit(`store i32 ${newSize}, i32* ${sizeFieldPtr}`);

    // Return the set (for chaining)
    return setPtr;
  }

  generateSetHas(expr: MethodCallNode, params: string[]): string {
    // set.has(value) - returns 1 if value exists, 0 otherwise
    if (expr.args.length !== 1) {
      throw new Error('Set.has() requires exactly 1 argument');
    }

    // Get set pointer
    const setPtr = this.generateExpression(expr.object, params);

    // Generate value
    const valueToFind = this.generateExpression(expr.args[0], params);

    // Load array and size
    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 0`);
    const valuesPtr = this.nextTemp();
    this.emit(`${valuesPtr} = load i32*, i32** ${valuesFieldPtr}`);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 1`);
    const setSize = this.nextTemp();
    this.emit(`${setSize} = load i32, i32* ${sizeFieldPtr}`);

    // Linear search for value
    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca i32`);
    this.emit(`store i32 0, i32* ${resultReg}`);

    const loopLabel = this.nextLabel('set_has_loop');
    const bodyLabel = this.nextLabel('set_has_body');
    const foundLabel = this.nextLabel('set_has_found');
    const endLabel = this.nextLabel('set_has_end');

    const indexReg = this.nextTemp();
    this.emit(`${indexReg} = alloca i32`);
    this.emit(`store i32 0, i32* ${indexReg}`);
    this.emit(`br label %${loopLabel}`);

    this.emit(`${loopLabel}:`);
    const currentIndex = this.nextTemp();
    this.emit(`${currentIndex} = load i32, i32* ${indexReg}`);
    const cond = this.nextTemp();
    this.emit(`${cond} = icmp slt i32 ${currentIndex}, ${setSize}`);
    this.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

    this.emit(`${bodyLabel}:`);
    const valueElemPtr = this.nextTemp();
    this.emit(`${valueElemPtr} = getelementptr inbounds i32, i32* ${valuesPtr}, i32 ${currentIndex}`);
    const currentValue = this.nextTemp();
    this.emit(`${currentValue} = load i32, i32* ${valueElemPtr}`);
    const valueMatch = this.nextTemp();
    this.emit(`${valueMatch} = icmp eq i32 ${currentValue}, ${valueToFind}`);
    this.emit(`br i1 ${valueMatch}, label %${foundLabel}, label %${loopLabel}_next`);

    this.emit(`${foundLabel}:`);
    this.emit(`store i32 1, i32* ${resultReg}`);
    this.emit(`br label %${endLabel}`);

    this.emit(`${loopLabel}_next:`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.emit(`store i32 ${nextIndex}, i32* ${indexReg}`);
    this.emit(`br label %${loopLabel}`);

    this.emit(`${endLabel}:`);
    const result = this.nextTemp();
    this.emit(`${result} = load i32, i32* ${resultReg}`);

    return result;
  }

  generateSetSize(setPtr: string): string {
    // Get size field
    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 1`);
    const size = this.nextTemp();
    this.emit(`${size} = load i32, i32* ${sizeFieldPtr}`);
    return size;
  }

  generateSetDelete(expr: MethodCallNode, params: string[]): string {
    // set.delete(value) - returns 1 if deleted, 0 if not found
    if (expr.args.length !== 1) {
      throw new Error('Set.delete() requires exactly 1 argument');
    }

    // Get set pointer
    const setPtr = this.generateExpression(expr.object, params);

    // Generate value
    const valueToDelete = this.generateExpression(expr.args[0], params);

    // Load array and size
    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 0`);
    const valuesPtr = this.nextTemp();
    this.emit(`${valuesPtr} = load i32*, i32** ${valuesFieldPtr}`);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 1`);
    const currentSize = this.nextTemp();
    this.emit(`${currentSize} = load i32, i32* ${sizeFieldPtr}`);

    // Linear search and delete (shift elements)
    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca i32`);
    this.emit(`store i32 0, i32* ${resultReg}`);

    // For simplicity, we'll just mark as deleted by returning 0 (not found)
    // A full implementation would shift elements and update size
    // TODO: Implement actual deletion with element shifting

    const result = this.nextTemp();
    this.emit(`${result} = load i32, i32* ${resultReg}`);
    return result;
  }
}
