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
  private nextTemp(): string { return this.ctx.nextTemp(); }
  private nextLabel(prefix: string): string { return this.ctx.nextLabel(prefix); }
  private emit(instruction: string): void { this.ctx.emit(instruction); }
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
    const seen: Set<number> = new Set();
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
      const dblSetVal = this.ctx.ensureDouble(valueValue);
      const valueElemPtr = this.nextTemp();
      this.emit(`${valueElemPtr} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${actualIndex}`);
      this.emit(`store double ${dblSetVal}, double* ${valueElemPtr}`);
      actualIndex++;
    }

    // Update actual size if we deduped
    if (actualIndex !== setExpr.values.length) {
      this.emit(`store i32 ${actualIndex}, i32* ${sizeFieldPtr}`);
    }

    this.ctx.setVariableType(setPtr, '%Set*');
    return setPtr;
  }

  generateSetAdd(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      throw new Error('Set.add() requires exactly 1 argument');
    }

    const setPtr = this.ctx.generateExpression(expr.object, params);
    const valueToAdd = this.ctx.generateExpression(expr.args[0], params);
    const dblValue = this.ctx.ensureDouble(valueToAdd);

    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 0`);
    const valuesPtr = this.nextTemp();
    this.emit(`${valuesPtr} = load double*, double** ${valuesFieldPtr}`);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 1`);
    const currentSize = this.nextTemp();
    this.emit(`${currentSize} = load i32, i32* ${sizeFieldPtr}`);

    const dedupLoop = this.nextLabel('set_add_dedup');
    const dedupBody = this.nextLabel('set_add_dedup_body');
    const dedupNext = this.nextLabel('set_add_dedup_next');
    const alreadyExists = this.nextLabel('set_add_exists');
    const dedupDone = this.nextLabel('set_add_dedup_done');
    const resizeLabel = this.nextLabel('set_add_resize');
    const doInsert = this.nextLabel('set_add_insert');
    const endLabel = this.nextLabel('set_add_end');

    const idxReg = this.nextTemp();
    this.emit(`${idxReg} = alloca i32`);
    this.emit(`store i32 0, i32* ${idxReg}`);
    this.emit(`br label %${dedupLoop}`);

    this.emit(`${dedupLoop}:`);
    const curIdx = this.nextTemp();
    this.emit(`${curIdx} = load i32, i32* ${idxReg}`);
    const idxCond = this.nextTemp();
    this.emit(`${idxCond} = icmp slt i32 ${curIdx}, ${currentSize}`);
    this.emit(`br i1 ${idxCond}, label %${dedupBody}, label %${dedupDone}`);

    this.emit(`${dedupBody}:`);
    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${curIdx}`);
    const elemVal = this.nextTemp();
    this.emit(`${elemVal} = load double, double* ${elemPtr}`);
    const match = this.nextTemp();
    this.emit(`${match} = fcmp oeq double ${elemVal}, ${dblValue}`);
    this.emit(`br i1 ${match}, label %${alreadyExists}, label %${dedupNext}`);

    this.emit(`${dedupNext}:`);
    const nextIdx = this.nextTemp();
    this.emit(`${nextIdx} = add i32 ${curIdx}, 1`);
    this.emit(`store i32 ${nextIdx}, i32* ${idxReg}`);
    this.emit(`br label %${dedupLoop}`);

    this.emit(`${alreadyExists}:`);
    this.emit(`br label %${endLabel}`);

    this.emit(`${dedupDone}:`);
    const capFieldPtr = this.nextTemp();
    this.emit(`${capFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 2`);
    const currentCap = this.nextTemp();
    this.emit(`${currentCap} = load i32, i32* ${capFieldPtr}`);
    const needResize = this.nextTemp();
    this.emit(`${needResize} = icmp eq i32 ${currentSize}, ${currentCap}`);
    this.emit(`br i1 ${needResize}, label %${resizeLabel}, label %${doInsert}`);

    this.emit(`${resizeLabel}:`);
    const isZero = this.nextTemp();
    this.emit(`${isZero} = icmp eq i32 ${currentCap}, 0`);
    const doubled = this.nextTemp();
    this.emit(`${doubled} = mul i32 ${currentCap}, 2`);
    const newCap = this.nextTemp();
    this.emit(`${newCap} = select i1 ${isZero}, i32 4, i32 ${doubled}`);
    const newCapI64 = this.nextTemp();
    this.emit(`${newCapI64} = zext i32 ${newCap} to i64`);
    const newMemSize = this.nextTemp();
    this.emit(`${newMemSize} = mul i64 ${newCapI64}, ${this.getDoubleSize()}`);
    const newMem = this.nextTemp();
    this.emit(`${newMem} = call i8* @GC_malloc_atomic(i64 ${newMemSize})`);
    const newDataPtr = this.nextTemp();
    this.emit(`${newDataPtr} = bitcast i8* ${newMem} to double*`);
    const oldDataI8 = this.nextTemp();
    this.emit(`${oldDataI8} = bitcast double* ${valuesPtr} to i8*`);
    const newDataI8 = this.nextTemp();
    this.emit(`${newDataI8} = bitcast double* ${newDataPtr} to i8*`);
    const currentSizeI64 = this.nextTemp();
    this.emit(`${currentSizeI64} = zext i32 ${currentSize} to i64`);
    const copySize = this.nextTemp();
    this.emit(`${copySize} = mul i64 ${currentSizeI64}, ${this.getDoubleSize()}`);
    this.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newDataI8}, i8* ${oldDataI8}, i64 ${copySize}, i1 false)`);
    this.emit(`store double* ${newDataPtr}, double** ${valuesFieldPtr}`);
    this.emit(`store i32 ${newCap}, i32* ${capFieldPtr}`);
    this.emit(`br label %${doInsert}`);

    this.emit(`${doInsert}:`);
    const dataPtrField2 = this.nextTemp();
    this.emit(`${dataPtrField2} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 0`);
    const dataPtr2 = this.nextTemp();
    this.emit(`${dataPtr2} = load double*, double** ${dataPtrField2}`);
    const insertPtr = this.nextTemp();
    this.emit(`${insertPtr} = getelementptr inbounds double, double* ${dataPtr2}, i32 ${currentSize}`);
    this.emit(`store double ${dblValue}, double* ${insertPtr}`);
    const newSize = this.nextTemp();
    this.emit(`${newSize} = add i32 ${currentSize}, 1`);
    this.emit(`store i32 ${newSize}, i32* ${sizeFieldPtr}`);
    this.emit(`br label %${endLabel}`);

    this.emit(`${endLabel}:`);
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
    const dblValueToFind = this.ctx.ensureDouble(valueToFind);
    const valueMatch = this.nextTemp();
    this.emit(`${valueMatch} = fcmp oeq double ${currentValue}, ${dblValueToFind}`);
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
    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 1`);
    const sizeI32 = this.nextTemp();
    this.emit(`${sizeI32} = load i32, i32* ${sizeFieldPtr}`);
    const size = this.nextTemp();
    this.emit(`${size} = sitofp i32 ${sizeI32} to double`);
    this.ctx.setVariableType(size, 'double');
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
    this.ctx.generateExpression(expr.args[0], params);

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

  private nextTemp(): string { return this.ctx.nextTemp(); }
  private nextLabel(prefix: string): string { return this.ctx.nextLabel(prefix); }
  private emit(instruction: string): void { this.ctx.emit(instruction); }
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

    this.ctx.setVariableType(setPtr, '%StringSet*');
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

    const dedupLoop = this.nextLabel('strset_add_dedup');
    const dedupBody = this.nextLabel('strset_add_dedup_body');
    const dedupNext = this.nextLabel('strset_add_dedup_next');
    const alreadyExists = this.nextLabel('strset_add_exists');
    const dedupDone = this.nextLabel('strset_add_dedup_done');
    const resizeLabel = this.nextLabel('strset_add_resize');
    const doInsert = this.nextLabel('strset_add_insert');
    const endLabel = this.nextLabel('strset_add_end');

    const idxReg = this.nextTemp();
    this.emit(`${idxReg} = alloca i32`);
    this.emit(`store i32 0, i32* ${idxReg}`);
    this.emit(`br label %${dedupLoop}`);

    this.emit(`${dedupLoop}:`);
    const curIdx = this.nextTemp();
    this.emit(`${curIdx} = load i32, i32* ${idxReg}`);
    const idxCond = this.nextTemp();
    this.emit(`${idxCond} = icmp slt i32 ${curIdx}, ${currentSize}`);
    this.emit(`br i1 ${idxCond}, label %${dedupBody}, label %${dedupDone}`);

    this.emit(`${dedupBody}:`);
    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${curIdx}`);
    const elemVal = this.nextTemp();
    this.emit(`${elemVal} = load i8*, i8** ${elemPtr}`);
    const cmpResult = this.nextTemp();
    this.emit(`${cmpResult} = call i32 @strcmp(i8* ${elemVal}, i8* ${valueValue})`);
    const match = this.nextTemp();
    this.emit(`${match} = icmp eq i32 ${cmpResult}, 0`);
    this.emit(`br i1 ${match}, label %${alreadyExists}, label %${dedupNext}`);

    this.emit(`${dedupNext}:`);
    const nextIdx = this.nextTemp();
    this.emit(`${nextIdx} = add i32 ${curIdx}, 1`);
    this.emit(`store i32 ${nextIdx}, i32* ${idxReg}`);
    this.emit(`br label %${dedupLoop}`);

    this.emit(`${alreadyExists}:`);
    this.emit(`br label %${endLabel}`);

    this.emit(`${dedupDone}:`);
    const capFieldPtr = this.nextTemp();
    this.emit(`${capFieldPtr} = getelementptr inbounds %StringSet, %StringSet* ${setPtr}, i32 0, i32 2`);
    const currentCap = this.nextTemp();
    this.emit(`${currentCap} = load i32, i32* ${capFieldPtr}`);
    const needResize = this.nextTemp();
    this.emit(`${needResize} = icmp eq i32 ${currentSize}, ${currentCap}`);
    this.emit(`br i1 ${needResize}, label %${resizeLabel}, label %${doInsert}`);

    this.emit(`${resizeLabel}:`);
    const isZero = this.nextTemp();
    this.emit(`${isZero} = icmp eq i32 ${currentCap}, 0`);
    const doubled = this.nextTemp();
    this.emit(`${doubled} = mul i32 ${currentCap}, 2`);
    const newCap = this.nextTemp();
    this.emit(`${newCap} = select i1 ${isZero}, i32 4, i32 ${doubled}`);
    const newCapI64 = this.nextTemp();
    this.emit(`${newCapI64} = zext i32 ${newCap} to i64`);
    const newMemSize = this.nextTemp();
    this.emit(`${newMemSize} = mul i64 ${newCapI64}, ${this.getPtrSize()}`);
    const newMem = this.nextTemp();
    this.emit(`${newMem} = call i8* @GC_malloc(i64 ${newMemSize})`);
    const newDataPtr = this.nextTemp();
    this.emit(`${newDataPtr} = bitcast i8* ${newMem} to i8**`);
    const oldDataI8 = this.nextTemp();
    this.emit(`${oldDataI8} = bitcast i8** ${valuesPtr} to i8*`);
    const newDataI8 = this.nextTemp();
    this.emit(`${newDataI8} = bitcast i8** ${newDataPtr} to i8*`);
    const currentSizeI64 = this.nextTemp();
    this.emit(`${currentSizeI64} = zext i32 ${currentSize} to i64`);
    const copySize = this.nextTemp();
    this.emit(`${copySize} = mul i64 ${currentSizeI64}, ${this.getPtrSize()}`);
    this.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newDataI8}, i8* ${oldDataI8}, i64 ${copySize}, i1 false)`);
    this.emit(`store i8** ${newDataPtr}, i8*** ${valuesFieldPtr}`);
    this.emit(`store i32 ${newCap}, i32* ${capFieldPtr}`);
    this.emit(`br label %${doInsert}`);

    this.emit(`${doInsert}:`);
    const dataPtrField2 = this.nextTemp();
    this.emit(`${dataPtrField2} = getelementptr inbounds %StringSet, %StringSet* ${setPtr}, i32 0, i32 0`);
    const dataPtr2 = this.nextTemp();
    this.emit(`${dataPtr2} = load i8**, i8*** ${dataPtrField2}`);
    const insertPtr = this.nextTemp();
    this.emit(`${insertPtr} = getelementptr inbounds i8*, i8** ${dataPtr2}, i32 ${currentSize}`);
    this.emit(`store i8* ${valueValue}, i8** ${insertPtr}`);
    const newSize = this.nextTemp();
    this.emit(`${newSize} = add i32 ${currentSize}, 1`);
    this.emit(`store i32 ${newSize}, i32* ${sizeFieldPtr}`);
    this.emit(`br label %${endLabel}`);

    this.emit(`${endLabel}:`);
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
    this.ctx.setVariableType(result, 'double');

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
