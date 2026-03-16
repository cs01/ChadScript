import { Expression, MethodCallNode, SetNode, NumberNode } from "../../../ast/types.js";
import { IGeneratorContext } from "../../infrastructure/generator-context.js";

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
  private nextTemp(): string {
    return this.ctx.nextTemp();
  }
  private nextLabel(prefix: string): string {
    return this.ctx.nextLabel(prefix);
  }
  private emit(instruction: string): void {
    this.ctx.emit(instruction);
  }
  private getDoubleSize() {
    return 8;
  } // sizeof(double) = 8 bytes

  generateSetLiteral(expr: Expression, params: string[]): string {
    const setExpr = expr as SetNode;
    if (setExpr.type !== "set") {
      return this.ctx.emitError("Expected set literal");
    }

    // Allocate Set struct on heap so it's safe to store in class fields
    const setMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 16`);
    const setPtr = this.ctx.emitBitcast(setMem, "i8*", "%Set*");

    // Initialize with empty array
    const initialCapacity = setExpr.values.length > 4 ? setExpr.values.length : 4;

    // Allocate values array - use double* for JavaScript semantics
    const doubleSize = this.getDoubleSize();
    const valuesCapI64 = this.nextTemp();
    this.emit(`${valuesCapI64} = zext i32 ${initialCapacity} to i64`);
    const valuesSize = this.nextTemp();
    this.emit(`${valuesSize} = mul i64 ${valuesCapI64}, ${doubleSize}`);
    const valuesMem = this.ctx.emitCall("i8*", "@cs_arena_alloc", `i64 ${valuesSize}`);
    const valuesPtr = this.ctx.emitBitcast(valuesMem, "i8*", "double*");

    // Store values pointer in Set struct
    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 0`);
    this.ctx.emitStore("double*", valuesPtr, valuesFieldPtr);

    // Store size
    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 1`);
    this.ctx.emitStore("i32", `${setExpr.values.length}`, sizeFieldPtr);

    // Store capacity
    const capacityFieldPtr = this.nextTemp();
    this.emit(`${capacityFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 2`);
    this.ctx.emitStore("i32", `${initialCapacity}`, capacityFieldPtr);

    // Populate initial values (with deduplication)
    const seen: Set<number> = new Set();
    let actualIndex = 0;
    for (let i = 0; i < setExpr.values.length; i++) {
      const valueExprTyped = setExpr.values[i] as NumberNode;

      // For literal numbers, we can dedupe at compile time
      if (valueExprTyped.type === "number") {
        const numVal = valueExprTyped.value;
        if (seen.has(numVal)) continue;
        seen.add(numVal);
      }

      const valueValue = this.ctx.generateExpression(setExpr.values[i] as Expression, params);

      // Store value
      const dblSetVal = this.ctx.ensureDouble(valueValue);
      const valueElemPtr = this.nextTemp();
      this.emit(
        `${valueElemPtr} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${actualIndex}`,
      );
      this.ctx.emitStore("double", dblSetVal, valueElemPtr);
      actualIndex++;
    }

    // Update actual size if we deduped
    if (actualIndex !== setExpr.values.length) {
      this.ctx.emitStore("i32", `${actualIndex}`, sizeFieldPtr);
    }

    this.ctx.setVariableType(setPtr, "%Set*");
    return setPtr;
  }

  generateSetAdd(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      return this.ctx.emitError("Set.add() requires exactly 1 argument", expr.loc);
    }

    const setPtr = this.ctx.generateExpression(expr.object, params);
    const valueToAdd = this.ctx.generateExpression(expr.args[0], params);
    const dblValue = this.ctx.ensureDouble(valueToAdd);

    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 0`);
    const valuesPtr = this.ctx.emitLoad("double*", valuesFieldPtr);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 1`);
    const currentSize = this.ctx.emitLoad("i32", sizeFieldPtr);

    const dedupLoop = this.nextLabel("set_add_dedup");
    const dedupBody = this.nextLabel("set_add_dedup_body");
    const dedupNext = this.nextLabel("set_add_dedup_next");
    const alreadyExists = this.nextLabel("set_add_exists");
    const dedupDone = this.nextLabel("set_add_dedup_done");
    const resizeLabel = this.nextLabel("set_add_resize");
    const doInsert = this.nextLabel("set_add_insert");
    const endLabel = this.nextLabel("set_add_end");

    const idxReg = this.nextTemp();
    this.emit(`${idxReg} = alloca i32`);
    this.ctx.emitStore("i32", "0", idxReg);
    this.ctx.emitBr(dedupLoop);

    this.ctx.emitLabel(dedupLoop);
    const curIdx = this.ctx.emitLoad("i32", idxReg);
    const idxCond = this.ctx.emitIcmp("slt", "i32", curIdx, currentSize);
    this.ctx.emitBrCond(idxCond, dedupBody, dedupDone);

    this.ctx.emitLabel(dedupBody);
    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${curIdx}`);
    const elemVal = this.ctx.emitLoad("double", elemPtr);
    const match = this.nextTemp();
    this.emit(`${match} = fcmp oeq double ${elemVal}, ${dblValue}`);
    this.ctx.emitBrCond(match, alreadyExists, dedupNext);

    this.ctx.emitLabel(dedupNext);
    const nextIdx = this.nextTemp();
    this.emit(`${nextIdx} = add i32 ${curIdx}, 1`);
    this.ctx.emitStore("i32", nextIdx, idxReg);
    this.ctx.emitBr(dedupLoop);

    this.ctx.emitLabel(alreadyExists);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(dedupDone);
    const capFieldPtr = this.nextTemp();
    this.emit(`${capFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 2`);
    const currentCap = this.ctx.emitLoad("i32", capFieldPtr);
    const needResize = this.ctx.emitIcmp("eq", "i32", currentSize, currentCap);
    this.ctx.emitBrCond(needResize, resizeLabel, doInsert);

    this.ctx.emitLabel(resizeLabel);
    const isZero = this.ctx.emitIcmp("eq", "i32", currentCap, "0");
    const doubled = this.nextTemp();
    this.emit(`${doubled} = mul i32 ${currentCap}, 2`);
    const newCap = this.nextTemp();
    this.emit(`${newCap} = select i1 ${isZero}, i32 4, i32 ${doubled}`);
    const newCapI64 = this.nextTemp();
    this.emit(`${newCapI64} = zext i32 ${newCap} to i64`);
    const newMemSize = this.nextTemp();
    this.emit(`${newMemSize} = mul i64 ${newCapI64}, ${this.getDoubleSize()}`);
    const newMem = this.ctx.emitCall("i8*", "@cs_arena_alloc", `i64 ${newMemSize}`);
    const newDataPtr = this.ctx.emitBitcast(newMem, "i8*", "double*");
    const oldDataI8 = this.ctx.emitBitcast(valuesPtr, "double*", "i8*");
    const newDataI8 = this.ctx.emitBitcast(newDataPtr, "double*", "i8*");
    const currentSizeI64 = this.nextTemp();
    this.emit(`${currentSizeI64} = zext i32 ${currentSize} to i64`);
    const copySize = this.nextTemp();
    this.emit(`${copySize} = mul i64 ${currentSizeI64}, ${this.getDoubleSize()}`);
    this.emit(
      `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newDataI8}, i8* ${oldDataI8}, i64 ${copySize}, i1 false)`,
    );
    this.ctx.emitStore("double*", newDataPtr, valuesFieldPtr);
    this.ctx.emitStore("i32", newCap, capFieldPtr);
    this.ctx.emitBr(doInsert);

    this.ctx.emitLabel(doInsert);
    const dataPtrField2 = this.nextTemp();
    this.emit(`${dataPtrField2} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 0`);
    const dataPtr2 = this.ctx.emitLoad("double*", dataPtrField2);
    const insertPtr = this.nextTemp();
    this.emit(
      `${insertPtr} = getelementptr inbounds double, double* ${dataPtr2}, i32 ${currentSize}`,
    );
    this.ctx.emitStore("double", dblValue, insertPtr);
    const newSize = this.nextTemp();
    this.emit(`${newSize} = add i32 ${currentSize}, 1`);
    this.ctx.emitStore("i32", newSize, sizeFieldPtr);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(endLabel);
    return setPtr;
  }

  generateSetHas(expr: MethodCallNode, params: string[]): string {
    // set.has(value) - returns 1 if value exists, 0 otherwise
    if (expr.args.length !== 1) {
      return this.ctx.emitError("Set.has() requires exactly 1 argument", expr.loc);
    }

    // Get set pointer
    const setPtr = this.ctx.generateExpression(expr.object, params);

    // Generate value
    const valueToFind = this.ctx.generateExpression(expr.args[0], params);

    // Load array and size
    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 0`);
    const valuesPtr = this.ctx.emitLoad("double*", valuesFieldPtr);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 1`);
    const setSize = this.ctx.emitLoad("i32", sizeFieldPtr);

    // Linear search for value
    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca double`);
    this.ctx.emitStore("double", "0.0", resultReg);

    const loopLabel = this.nextLabel("set_has_loop");
    const bodyLabel = this.nextLabel("set_has_body");
    const foundLabel = this.nextLabel("set_has_found");
    const endLabel = this.nextLabel("set_has_end");

    const indexReg = this.nextTemp();
    this.emit(`${indexReg} = alloca i32`);
    this.ctx.emitStore("i32", "0", indexReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(loopLabel);
    const currentIndex = this.ctx.emitLoad("i32", indexReg);
    const cond = this.ctx.emitIcmp("slt", "i32", currentIndex, setSize);
    this.ctx.emitBrCond(cond, bodyLabel, endLabel);

    this.ctx.emitLabel(bodyLabel);
    const valueElemPtr = this.nextTemp();
    this.emit(
      `${valueElemPtr} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${currentIndex}`,
    );
    const currentValue = this.ctx.emitLoad("double", valueElemPtr);
    const dblValueToFind = this.ctx.ensureDouble(valueToFind);
    const valueMatch = this.nextTemp();
    this.emit(`${valueMatch} = fcmp oeq double ${currentValue}, ${dblValueToFind}`);
    this.ctx.emitBrCond(valueMatch, foundLabel, `${loopLabel}_next`);

    this.ctx.emitLabel(foundLabel);
    this.ctx.emitStore("double", "1.0", resultReg);
    this.ctx.emitBr(endLabel);

    this.emit(`${loopLabel}_next:`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.ctx.emitStore("i32", nextIndex, indexReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(endLabel);
    const result = this.ctx.emitLoad("double", resultReg);
    this.ctx.setVariableType(result, "double");
    return result;
  }

  generateSetSize(setPtr: string): string {
    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 1`);
    const sizeI32 = this.ctx.emitLoad("i32", sizeFieldPtr);
    const size = this.nextTemp();
    this.emit(`${size} = sitofp i32 ${sizeI32} to double`);
    this.ctx.setVariableType(size, "double");
    return size;
  }

  generateSetDelete(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      return this.ctx.emitError("Set.delete() requires exactly 1 argument", expr.loc);
    }

    const setPtr = this.ctx.generateExpression(expr.object, params);
    const valueToDelete = this.ctx.generateExpression(expr.args[0], params);
    const dblValue = this.ctx.ensureDouble(valueToDelete);

    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 0`);
    const valuesPtr = this.ctx.emitLoad("double*", valuesFieldPtr);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Set, %Set* ${setPtr}, i32 0, i32 1`);
    const currentSize = this.ctx.emitLoad("i32", sizeFieldPtr);

    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca double`);
    this.ctx.emitStore("double", "0.0", resultReg);

    const searchLoop = this.nextLabel("set_del_loop");
    const searchBody = this.nextLabel("set_del_body");
    const searchNext = this.nextLabel("set_del_next");
    const foundLabel = this.nextLabel("set_del_found");
    const shiftLoop = this.nextLabel("set_del_shift");
    const shiftBody = this.nextLabel("set_del_shift_body");
    const shiftDone = this.nextLabel("set_del_shift_done");
    const endLabel = this.nextLabel("set_del_end");

    const idxReg = this.nextTemp();
    this.emit(`${idxReg} = alloca i32`);
    this.ctx.emitStore("i32", "0", idxReg);
    this.ctx.emitBr(searchLoop);

    this.ctx.emitLabel(searchLoop);
    const curIdx = this.ctx.emitLoad("i32", idxReg);
    const idxCond = this.ctx.emitIcmp("slt", "i32", curIdx, currentSize);
    this.ctx.emitBrCond(idxCond, searchBody, endLabel);

    this.ctx.emitLabel(searchBody);
    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${curIdx}`);
    const elemVal = this.ctx.emitLoad("double", elemPtr);
    const match = this.nextTemp();
    this.emit(`${match} = fcmp oeq double ${elemVal}, ${dblValue}`);
    this.ctx.emitBrCond(match, foundLabel, searchNext);

    this.ctx.emitLabel(searchNext);
    const nextIdx = this.nextTemp();
    this.emit(`${nextIdx} = add i32 ${curIdx}, 1`);
    this.ctx.emitStore("i32", nextIdx, idxReg);
    this.ctx.emitBr(searchLoop);

    this.ctx.emitLabel(foundLabel);
    this.ctx.emitStore("double", "1.0", resultReg);
    const foundIdx = this.ctx.emitLoad("i32", idxReg);
    const lastIdx = this.nextTemp();
    this.emit(`${lastIdx} = sub i32 ${currentSize}, 1`);
    const needShift = this.ctx.emitIcmp("slt", "i32", foundIdx, lastIdx);
    this.ctx.emitBrCond(needShift, shiftLoop, shiftDone);

    this.ctx.emitLabel(shiftLoop);
    const shiftI = this.ctx.emitLoad("i32", idxReg);
    const shiftSrc = this.nextTemp();
    this.emit(`${shiftSrc} = add i32 ${shiftI}, 1`);
    const srcPtr = this.nextTemp();
    this.emit(`${srcPtr} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${shiftSrc}`);
    const srcVal = this.ctx.emitLoad("double", srcPtr);
    const dstPtr = this.nextTemp();
    this.emit(`${dstPtr} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${shiftI}`);
    this.ctx.emitStore("double", srcVal, dstPtr);
    const nextShiftI = this.nextTemp();
    this.emit(`${nextShiftI} = add i32 ${shiftI}, 1`);
    this.ctx.emitStore("i32", nextShiftI, idxReg);
    const shiftCond = this.ctx.emitIcmp("slt", "i32", nextShiftI, lastIdx);
    this.ctx.emitBrCond(shiftCond, shiftBody, shiftDone);

    this.ctx.emitLabel(shiftBody);
    this.ctx.emitBr(shiftLoop);

    this.ctx.emitLabel(shiftDone);
    const newSize = this.nextTemp();
    this.emit(`${newSize} = sub i32 ${currentSize}, 1`);
    this.ctx.emitStore("i32", newSize, sizeFieldPtr);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(endLabel);
    const result = this.ctx.emitLoad("double", resultReg);
    this.ctx.setVariableType(result, "double");
    return result;
  }
}

export class StringSetGenerator {
  constructor(private ctx: IGeneratorContext) {}

  private nextTemp(): string {
    return this.ctx.nextTemp();
  }
  private nextLabel(prefix: string): string {
    return this.ctx.nextLabel(prefix);
  }
  private emit(instruction: string): void {
    this.ctx.emit(instruction);
  }
  private getPtrSize() {
    return 8;
  }

  generateEmptyStringSet(): string {
    // Allocate StringSet struct on heap so it's safe to store in class fields
    const setMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 16`);
    const setPtr = this.ctx.emitBitcast(setMem, "i8*", "%StringSet*");

    const initialCapacity = 4;
    const ptrSize = this.getPtrSize();

    const valuesCapI64 = this.nextTemp();
    this.emit(`${valuesCapI64} = zext i32 ${initialCapacity} to i64`);
    const valuesSize = this.nextTemp();
    this.emit(`${valuesSize} = mul i64 ${valuesCapI64}, ${ptrSize}`);
    const valuesMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${valuesSize}`);
    const valuesPtr = this.ctx.emitBitcast(valuesMem, "i8*", "i8**");

    const valuesFieldPtr = this.nextTemp();
    this.emit(
      `${valuesFieldPtr} = getelementptr inbounds %StringSet, %StringSet* ${setPtr}, i32 0, i32 0`,
    );
    this.ctx.emitStore("i8**", valuesPtr, valuesFieldPtr);

    const sizeFieldPtr = this.nextTemp();
    this.emit(
      `${sizeFieldPtr} = getelementptr inbounds %StringSet, %StringSet* ${setPtr}, i32 0, i32 1`,
    );
    this.ctx.emitStore("i32", "0", sizeFieldPtr);

    const capacityFieldPtr = this.nextTemp();
    this.emit(
      `${capacityFieldPtr} = getelementptr inbounds %StringSet, %StringSet* ${setPtr}, i32 0, i32 2`,
    );
    this.ctx.emitStore("i32", `${initialCapacity}`, capacityFieldPtr);

    this.ctx.setVariableType(setPtr, "%StringSet*");
    return setPtr;
  }

  generateStringSetAdd(setPtr: string, valueValue: string): string {
    const valuesFieldPtr = this.nextTemp();
    this.emit(
      `${valuesFieldPtr} = getelementptr inbounds %StringSet, %StringSet* ${setPtr}, i32 0, i32 0`,
    );
    const valuesPtr = this.ctx.emitLoad("i8**", valuesFieldPtr);

    const sizeFieldPtr = this.nextTemp();
    this.emit(
      `${sizeFieldPtr} = getelementptr inbounds %StringSet, %StringSet* ${setPtr}, i32 0, i32 1`,
    );
    const currentSize = this.ctx.emitLoad("i32", sizeFieldPtr);

    const dedupLoop = this.nextLabel("strset_add_dedup");
    const dedupBody = this.nextLabel("strset_add_dedup_body");
    const dedupNext = this.nextLabel("strset_add_dedup_next");
    const alreadyExists = this.nextLabel("strset_add_exists");
    const dedupDone = this.nextLabel("strset_add_dedup_done");
    const resizeLabel = this.nextLabel("strset_add_resize");
    const doInsert = this.nextLabel("strset_add_insert");
    const endLabel = this.nextLabel("strset_add_end");

    const idxReg = this.nextTemp();
    this.emit(`${idxReg} = alloca i32`);
    this.ctx.emitStore("i32", "0", idxReg);
    this.ctx.emitBr(dedupLoop);

    this.ctx.emitLabel(dedupLoop);
    const curIdx = this.ctx.emitLoad("i32", idxReg);
    const idxCond = this.ctx.emitIcmp("slt", "i32", curIdx, currentSize);
    this.ctx.emitBrCond(idxCond, dedupBody, dedupDone);

    this.ctx.emitLabel(dedupBody);
    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${curIdx}`);
    const elemVal = this.ctx.emitLoad("i8*", elemPtr);
    const cmpResult = this.ctx.emitCall("i32", "@strcmp", `i8* ${elemVal}, i8* ${valueValue}`);
    const match = this.ctx.emitIcmp("eq", "i32", cmpResult, "0");
    this.ctx.emitBrCond(match, alreadyExists, dedupNext);

    this.ctx.emitLabel(dedupNext);
    const nextIdx = this.nextTemp();
    this.emit(`${nextIdx} = add i32 ${curIdx}, 1`);
    this.ctx.emitStore("i32", nextIdx, idxReg);
    this.ctx.emitBr(dedupLoop);

    this.ctx.emitLabel(alreadyExists);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(dedupDone);
    const capFieldPtr = this.nextTemp();
    this.emit(
      `${capFieldPtr} = getelementptr inbounds %StringSet, %StringSet* ${setPtr}, i32 0, i32 2`,
    );
    const currentCap = this.ctx.emitLoad("i32", capFieldPtr);
    const needResize = this.ctx.emitIcmp("eq", "i32", currentSize, currentCap);
    this.ctx.emitBrCond(needResize, resizeLabel, doInsert);

    this.ctx.emitLabel(resizeLabel);
    const isZero = this.ctx.emitIcmp("eq", "i32", currentCap, "0");
    const doubled = this.nextTemp();
    this.emit(`${doubled} = mul i32 ${currentCap}, 2`);
    const newCap = this.nextTemp();
    this.emit(`${newCap} = select i1 ${isZero}, i32 4, i32 ${doubled}`);
    const newCapI64 = this.nextTemp();
    this.emit(`${newCapI64} = zext i32 ${newCap} to i64`);
    const newMemSize = this.nextTemp();
    this.emit(`${newMemSize} = mul i64 ${newCapI64}, ${this.getPtrSize()}`);
    const newMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${newMemSize}`);
    const newDataPtr = this.ctx.emitBitcast(newMem, "i8*", "i8**");
    const oldDataI8 = this.ctx.emitBitcast(valuesPtr, "i8**", "i8*");
    const newDataI8 = this.ctx.emitBitcast(newDataPtr, "i8**", "i8*");
    const currentSizeI64 = this.nextTemp();
    this.emit(`${currentSizeI64} = zext i32 ${currentSize} to i64`);
    const copySize = this.nextTemp();
    this.emit(`${copySize} = mul i64 ${currentSizeI64}, ${this.getPtrSize()}`);
    this.emit(
      `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newDataI8}, i8* ${oldDataI8}, i64 ${copySize}, i1 false)`,
    );
    this.ctx.emitStore("i8**", newDataPtr, valuesFieldPtr);
    this.ctx.emitStore("i32", newCap, capFieldPtr);
    this.ctx.emitBr(doInsert);

    this.ctx.emitLabel(doInsert);
    const dataPtrField2 = this.nextTemp();
    this.emit(
      `${dataPtrField2} = getelementptr inbounds %StringSet, %StringSet* ${setPtr}, i32 0, i32 0`,
    );
    const dataPtr2 = this.ctx.emitLoad("i8**", dataPtrField2);
    const insertPtr = this.nextTemp();
    this.emit(`${insertPtr} = getelementptr inbounds i8*, i8** ${dataPtr2}, i32 ${currentSize}`);
    this.ctx.emitStore("i8*", valueValue, insertPtr);
    const newSize = this.nextTemp();
    this.emit(`${newSize} = add i32 ${currentSize}, 1`);
    this.ctx.emitStore("i32", newSize, sizeFieldPtr);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(endLabel);
    return setPtr;
  }

  generateStringSetHas(setPtr: string, valueToFind: string): string {
    const valuesFieldPtr = this.nextTemp();
    this.emit(
      `${valuesFieldPtr} = getelementptr inbounds %StringSet, %StringSet* ${setPtr}, i32 0, i32 0`,
    );
    const valuesPtr = this.ctx.emitLoad("i8**", valuesFieldPtr);

    const sizeFieldPtr = this.nextTemp();
    this.emit(
      `${sizeFieldPtr} = getelementptr inbounds %StringSet, %StringSet* ${setPtr}, i32 0, i32 1`,
    );
    const setSize = this.ctx.emitLoad("i32", sizeFieldPtr);

    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca double`);
    this.ctx.emitStore("double", "0.0", resultReg);

    const loopLabel = this.nextLabel("strset_has_loop");
    const bodyLabel = this.nextLabel("strset_has_body");
    const foundLabel = this.nextLabel("strset_has_found");
    const endLabel = this.nextLabel("strset_has_end");

    const indexReg = this.nextTemp();
    this.emit(`${indexReg} = alloca i32`);
    this.ctx.emitStore("i32", "0", indexReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(loopLabel);
    const currentIndex = this.ctx.emitLoad("i32", indexReg);
    const cond = this.ctx.emitIcmp("slt", "i32", currentIndex, setSize);
    this.ctx.emitBrCond(cond, bodyLabel, endLabel);

    this.ctx.emitLabel(bodyLabel);
    const valueElemPtr = this.nextTemp();
    this.emit(
      `${valueElemPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${currentIndex}`,
    );
    const currentValue = this.ctx.emitLoad("i8*", valueElemPtr);
    const cmpResult = this.ctx.emitCall(
      "i32",
      "@strcmp",
      `i8* ${currentValue}, i8* ${valueToFind}`,
    );
    const valueMatch = this.ctx.emitIcmp("eq", "i32", cmpResult, "0");
    this.ctx.emitBrCond(valueMatch, foundLabel, `${loopLabel}_next`);

    this.ctx.emitLabel(foundLabel);
    this.ctx.emitStore("double", "1.0", resultReg);
    this.ctx.emitBr(endLabel);

    this.emit(`${loopLabel}_next:`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.ctx.emitStore("i32", nextIndex, indexReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(endLabel);
    const result = this.ctx.emitLoad("double", resultReg);
    this.ctx.setVariableType(result, "double");

    return result;
  }

  generateStringSetDelete(setPtr: string, valueToDelete: string): string {
    const valuesFieldPtr = this.nextTemp();
    this.emit(
      `${valuesFieldPtr} = getelementptr inbounds %StringSet, %StringSet* ${setPtr}, i32 0, i32 0`,
    );
    const valuesPtr = this.ctx.emitLoad("i8**", valuesFieldPtr);

    const sizeFieldPtr = this.nextTemp();
    this.emit(
      `${sizeFieldPtr} = getelementptr inbounds %StringSet, %StringSet* ${setPtr}, i32 0, i32 1`,
    );
    const currentSize = this.ctx.emitLoad("i32", sizeFieldPtr);

    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca double`);
    this.ctx.emitStore("double", "0.0", resultReg);

    const searchLoop = this.nextLabel("strset_del_loop");
    const searchBody = this.nextLabel("strset_del_body");
    const searchNext = this.nextLabel("strset_del_next");
    const foundLabel = this.nextLabel("strset_del_found");
    const shiftLoop = this.nextLabel("strset_del_shift");
    const shiftBody = this.nextLabel("strset_del_shift_body");
    const shiftDone = this.nextLabel("strset_del_shift_done");
    const endLabel = this.nextLabel("strset_del_end");

    const idxReg = this.nextTemp();
    this.emit(`${idxReg} = alloca i32`);
    this.ctx.emitStore("i32", "0", idxReg);
    this.ctx.emitBr(searchLoop);

    this.ctx.emitLabel(searchLoop);
    const curIdx = this.ctx.emitLoad("i32", idxReg);
    const idxCond = this.ctx.emitIcmp("slt", "i32", curIdx, currentSize);
    this.ctx.emitBrCond(idxCond, searchBody, endLabel);

    this.ctx.emitLabel(searchBody);
    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${curIdx}`);
    const elemVal = this.ctx.emitLoad("i8*", elemPtr);
    const cmpResult = this.ctx.emitCall("i32", "@strcmp", `i8* ${elemVal}, i8* ${valueToDelete}`);
    const match = this.ctx.emitIcmp("eq", "i32", cmpResult, "0");
    this.ctx.emitBrCond(match, foundLabel, searchNext);

    this.ctx.emitLabel(searchNext);
    const nextIdx = this.nextTemp();
    this.emit(`${nextIdx} = add i32 ${curIdx}, 1`);
    this.ctx.emitStore("i32", nextIdx, idxReg);
    this.ctx.emitBr(searchLoop);

    this.ctx.emitLabel(foundLabel);
    this.ctx.emitStore("double", "1.0", resultReg);
    const foundIdx = this.ctx.emitLoad("i32", idxReg);
    const lastIdx = this.nextTemp();
    this.emit(`${lastIdx} = sub i32 ${currentSize}, 1`);
    const needShift = this.ctx.emitIcmp("slt", "i32", foundIdx, lastIdx);
    this.ctx.emitBrCond(needShift, shiftLoop, shiftDone);

    this.ctx.emitLabel(shiftLoop);
    const shiftI = this.ctx.emitLoad("i32", idxReg);
    const shiftSrc = this.nextTemp();
    this.emit(`${shiftSrc} = add i32 ${shiftI}, 1`);
    const srcPtr = this.nextTemp();
    this.emit(`${srcPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${shiftSrc}`);
    const srcVal = this.ctx.emitLoad("i8*", srcPtr);
    const dstPtr = this.nextTemp();
    this.emit(`${dstPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${shiftI}`);
    this.ctx.emitStore("i8*", srcVal, dstPtr);
    const nextShiftI = this.nextTemp();
    this.emit(`${nextShiftI} = add i32 ${shiftI}, 1`);
    this.ctx.emitStore("i32", nextShiftI, idxReg);
    const shiftCond = this.ctx.emitIcmp("slt", "i32", nextShiftI, lastIdx);
    this.ctx.emitBrCond(shiftCond, shiftBody, shiftDone);

    this.ctx.emitLabel(shiftBody);
    this.ctx.emitBr(shiftLoop);

    this.ctx.emitLabel(shiftDone);
    const newSize = this.nextTemp();
    this.emit(`${newSize} = sub i32 ${currentSize}, 1`);
    this.ctx.emitStore("i32", newSize, sizeFieldPtr);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(endLabel);
    const result = this.ctx.emitLoad("double", resultReg);
    this.ctx.setVariableType(result, "double");
    return result;
  }

  generateStringSetSize(setPtr: string): string {
    const sizeFieldPtr = this.nextTemp();
    this.emit(
      `${sizeFieldPtr} = getelementptr inbounds %StringSet, %StringSet* ${setPtr}, i32 0, i32 1`,
    );
    const sizeI32 = this.ctx.emitLoad("i32", sizeFieldPtr);
    const size = this.nextTemp();
    this.emit(`${size} = sitofp i32 ${sizeI32} to double`);
    this.ctx.setVariableType(size, "double");
    return size;
  }
}
