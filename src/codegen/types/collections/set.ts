import { Expression, MethodCallNode } from '../../../ast/types.js';
import { IGeneratorContext } from '../../infrastructure/generator-context.js';

// ============================================
// SET GENERATOR - Set operations
// ============================================

// Set structure in LLVM:
// %Set = type { double*, i32, i32 }
// - double* values  - pointer to value array (JavaScript semantics)
// - i32 size     - number of elements
// - i32 capacity - allocated capacity

export class SetGenerator {
  constructor(private ctx: IGeneratorContext) {}

  // Helper methods delegate to context
  private nextTemp() { return this.ctx.nextTemp(); }
  private nextLabel(prefix: string) { return this.ctx.nextLabel(prefix); }
  private emit(instruction: string) { this.ctx.emit(instruction); }
  private getDoubleSize() { return 8; } // sizeof(double) = 8 bytes

  generateSetLiteral(expr: Expression, params: string[]): string {
    const setExpr = expr as { type: string; values: Expression[] };
    if (setExpr.type !== 'set') {
      throw new Error('Expected set literal');
    }

    // Allocate Set struct on stack
    const setPtr = this.nextTemp();
    this.emit(`${setPtr} = alloca %Set`);

    // Initialize with empty array
    const initialCapacity = setExpr.values.length > 4 ? setExpr.values.length : 4;

    // Allocate values array - use double* for JavaScript semantics
    const doubleSize = this.getDoubleSize();
    const valuesCapI64 = this.nextTemp();
    this.emit(`${valuesCapI64} = zext i32 ${initialCapacity} to i64`);
    const valuesSize = this.nextTemp();
    this.emit(`${valuesSize} = mul i64 ${valuesCapI64}, ${doubleSize}`);
    const valuesMem = this.nextTemp();
    this.emit(`${valuesMem} = call i8* @GC_malloc_atomic(i64 ${valuesSize})`);
    const valuesPtr = this.nextTemp();
    this.emit(`${valuesPtr} = bitcast i8* ${valuesMem} to double*`);

    // Store values pointer in Set struct
    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 0`);
    this.emit(`store double* ${valuesPtr}, double** ${valuesFieldPtr}`);

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
      const valueExprTyped = setExpr.values[i] as { type: string; value: number };

      // For literal numbers, we can dedupe at compile time
      if (valueExprTyped.type === 'number') {
        const numVal = valueExprTyped.value;
        if (seen.has(numVal)) continue;
        seen.add(numVal);
      }

      const valueValue = this.ctx.generateExpression(setExpr.values[i] as Expression, params);

      // Store value
      const valueElemPtr = this.nextTemp();
      this.emit(`${valueElemPtr} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${actualIndex}`);
      this.emit(`store double ${valueValue}, double* ${valueElemPtr}`);
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
    const setPtr = this.ctx.generateExpression(expr.object, params);

    // Generate value
    const valueToAdd = this.ctx.generateExpression(expr.args[0], params);

    // Check if value already exists (simple linear search)
    // Load current array and size
    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 0`);
    const valuesPtr = this.nextTemp();
    this.emit(`${valuesPtr} = load double*, double** ${valuesFieldPtr}`);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 1`);
    const currentSize = this.nextTemp();
    this.emit(`${currentSize} = load i32, i32* ${sizeFieldPtr}`);

    // For simplicity, assume value doesn't exist and just add it
    // (In production, we'd check for duplicates)

    // Store value at index = currentSize
    const valueElemPtr = this.nextTemp();
    this.emit(`${valueElemPtr} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${currentSize}`);
    this.emit(`store double ${valueToAdd}, double* ${valueElemPtr}`);

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
    const setPtr = this.ctx.generateExpression(expr.object, params);

    // Generate value
    const valueToFind = this.ctx.generateExpression(expr.args[0], params);

    // Load array and size
    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 0`);
    const valuesPtr = this.nextTemp();
    this.emit(`${valuesPtr} = load double*, double** ${valuesFieldPtr}`);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 1`);
    const setSize = this.nextTemp();
    this.emit(`${setSize} = load i32, i32* ${sizeFieldPtr}`);

    // Linear search for value
    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca double`);
    this.emit(`store double 0.0, double* ${resultReg}`);

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
    this.emit(`${valueElemPtr} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${currentIndex}`);
    const currentValue = this.nextTemp();
    this.emit(`${currentValue} = load double, double* ${valueElemPtr}`);
    const valueMatch = this.nextTemp();
    this.emit(`${valueMatch} = fcmp oeq double ${currentValue}, ${valueToFind}`);
    this.emit(`br i1 ${valueMatch}, label %${foundLabel}, label %${loopLabel}_next`);

    this.emit(`${foundLabel}:`);
    this.emit(`store double 1.0, double* ${resultReg}`);
    this.emit(`br label %${endLabel}`);

    this.emit(`${loopLabel}_next:`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.emit(`store i32 ${nextIndex}, i32* ${indexReg}`);
    this.emit(`br label %${loopLabel}`);

    this.emit(`${endLabel}:`);
    const result = this.nextTemp();
    this.emit(`${result} = load double, double* ${resultReg}`);

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
    const setPtr = this.ctx.generateExpression(expr.object, params);

    // Generate value
    const valueToDelete = this.ctx.generateExpression(expr.args[0], params);

    // Load array and size
    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 0`);
    const valuesPtr = this.nextTemp();
    this.emit(`${valuesPtr} = load double*, double** ${valuesFieldPtr}`);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 1`);
    const currentSize = this.nextTemp();
    this.emit(`${currentSize} = load i32, i32* ${sizeFieldPtr}`);

    // Linear search and delete (shift elements)
    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca double`);
    this.emit(`store double 0.0, double* ${resultReg}`);

    // For simplicity, we'll just mark as deleted by returning 0 (not found)
    // A full implementation would shift elements and update size
    // TODO: Implement actual deletion with element shifting

    const result = this.nextTemp();
    this.emit(`${result} = load double, double* ${resultReg}`);
    return result;
  }
}

export class StringSetGenerator {
  constructor(private ctx: IGeneratorContext) {}

  private nextTemp() { return this.ctx.nextTemp(); }
  private nextLabel(prefix: string) { return this.ctx.nextLabel(prefix); }
  private emit(instruction: string) { this.ctx.emit(instruction); }
  private getPtrSize() { return 8; }

  generateEmptyStringSet(): string {
    const setPtr = this.nextTemp();
    this.emit(`${setPtr} = alloca %StringSet`);

    const initialCapacity = 4;
    const ptrSize = this.getPtrSize();

    const valuesCapI64 = this.nextTemp();
    this.emit(`${valuesCapI64} = zext i32 ${initialCapacity} to i64`);
    const valuesSize = this.nextTemp();
    this.emit(`${valuesSize} = mul i64 ${valuesCapI64}, ${ptrSize}`);
    const valuesMem = this.nextTemp();
    this.emit(`${valuesMem} = call i8* @GC_malloc(i64 ${valuesSize})`);
    const valuesPtr = this.nextTemp();
    this.emit(`${valuesPtr} = bitcast i8* ${valuesMem} to i8**`);

    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %StringSet, %StringSet* ${setPtr}, i32 0, i32 0`);
    this.emit(`store i8** ${valuesPtr}, i8*** ${valuesFieldPtr}`);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %StringSet, %StringSet* ${setPtr}, i32 0, i32 1`);
    this.emit(`store i32 0, i32* ${sizeFieldPtr}`);

    const capacityFieldPtr = this.nextTemp();
    this.emit(`${capacityFieldPtr} = getelementptr inbounds %StringSet, %StringSet* ${setPtr}, i32 0, i32 2`);
    this.emit(`store i32 ${initialCapacity}, i32* ${capacityFieldPtr}`);

    return setPtr;
  }

  generateStringSetAdd(setPtr: string, valueValue: string): string {
    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %StringSet, %StringSet* ${setPtr}, i32 0, i32 0`);
    const valuesPtr = this.nextTemp();
    this.emit(`${valuesPtr} = load i8**, i8*** ${valuesFieldPtr}`);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %StringSet, %StringSet* ${setPtr}, i32 0, i32 1`);
    const currentSize = this.nextTemp();
    this.emit(`${currentSize} = load i32, i32* ${sizeFieldPtr}`);

    const valueElemPtr = this.nextTemp();
    this.emit(`${valueElemPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${currentSize}`);
    this.emit(`store i8* ${valueValue}, i8** ${valueElemPtr}`);

    const newSize = this.nextTemp();
    this.emit(`${newSize} = add i32 ${currentSize}, 1`);
    this.emit(`store i32 ${newSize}, i32* ${sizeFieldPtr}`);

    return setPtr;
  }

  generateStringSetHas(setPtr: string, valueToFind: string): string {
    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %StringSet, %StringSet* ${setPtr}, i32 0, i32 0`);
    const valuesPtr = this.nextTemp();
    this.emit(`${valuesPtr} = load i8**, i8*** ${valuesFieldPtr}`);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %StringSet, %StringSet* ${setPtr}, i32 0, i32 1`);
    const setSize = this.nextTemp();
    this.emit(`${setSize} = load i32, i32* ${sizeFieldPtr}`);

    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca double`);
    this.emit(`store double 0.0, double* ${resultReg}`);

    const loopLabel = this.nextLabel('strset_has_loop');
    const bodyLabel = this.nextLabel('strset_has_body');
    const foundLabel = this.nextLabel('strset_has_found');
    const endLabel = this.nextLabel('strset_has_end');

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
    this.emit(`${valueElemPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${currentIndex}`);
    const currentValue = this.nextTemp();
    this.emit(`${currentValue} = load i8*, i8** ${valueElemPtr}`);
    const cmpResult = this.nextTemp();
    this.emit(`${cmpResult} = call i32 @strcmp(i8* ${currentValue}, i8* ${valueToFind})`);
    const valueMatch = this.nextTemp();
    this.emit(`${valueMatch} = icmp eq i32 ${cmpResult}, 0`);
    this.emit(`br i1 ${valueMatch}, label %${foundLabel}, label %${loopLabel}_next`);

    this.emit(`${foundLabel}:`);
    this.emit(`store double 1.0, double* ${resultReg}`);
    this.emit(`br label %${endLabel}`);

    this.emit(`${loopLabel}_next:`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.emit(`store i32 ${nextIndex}, i32* ${indexReg}`);
    this.emit(`br label %${loopLabel}`);

    this.emit(`${endLabel}:`);
    const result = this.nextTemp();
    this.emit(`${result} = load double, double* ${resultReg}`);
    this.ctx.variableTypes.set(result, 'double');

    return result;
  }

  generateStringSetSize(setPtr: string): string {
    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %StringSet, %StringSet* ${setPtr}, i32 0, i32 1`);
    const size = this.nextTemp();
    this.emit(`${size} = load i32, i32* ${sizeFieldPtr}`);
    return size;
  }
}
