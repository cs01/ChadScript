// Map codegen: numeric Map, StringMap, and PointerMap generators.
// Uses structured IR builders where possible; raw emit() for inbounds GEP,
// alloca, arithmetic, fcmp, ptrtoint, sext, zext, shl, and, memcpy.

import { Expression, MethodCallNode, MapEntry, MapNode } from "../../../ast/types.js";
import { IGeneratorContext } from "../../infrastructure/generator-context.js";

// ============================================
// MAP GENERATOR - Map operations
// ============================================

// Map structure in LLVM:
// %Map = type { double*, double*, i32, i32 }
// - double* keys   - pointer to key array (JavaScript semantics)
// - double* values - pointer to value array (JavaScript semantics)
// - i32 size    - number of entries
// - i32 capacity - allocated capacity

export class MapGenerator {
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

  generateMapLiteral(expr: Expression, params: string[]): string {
    const mapExpr = expr as MapNode;
    if (mapExpr.type !== "map") {
      return this.ctx.emitError("Expected map literal");
    }

    const entries = mapExpr.entries || [];

    // Allocate Map struct on heap (not stack!)
    const sizeofPtr = this.nextTemp();
    this.emit(`${sizeofPtr} = getelementptr %Map, %Map* null, i32 1`);
    const structSize = this.nextTemp();
    this.emit(`${structSize} = ptrtoint %Map* ${sizeofPtr} to i64`);
    const mapMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${structSize}`);
    const mapPtr = this.ctx.emitBitcast(mapMem, "i8*", "%Map*");

    // Initialize with empty arrays
    const initialCapacity = entries.length > 4 ? entries.length : 4;

    // Allocate keys array - use double* for JavaScript semantics
    const doubleSize = this.getDoubleSize();
    const keysCapI64 = this.nextTemp();
    this.emit(`${keysCapI64} = zext i32 ${initialCapacity} to i64`);
    const keysSize = this.nextTemp();
    this.emit(`${keysSize} = mul i64 ${keysCapI64}, ${doubleSize}`);
    const keysMem = this.ctx.emitCall("i8*", "@GC_malloc_atomic", `i64 ${keysSize}`);
    const keysPtr = this.ctx.emitBitcast(keysMem, "i8*", "double*");

    // Allocate values array - use double* for JavaScript semantics
    const valuesCapI64 = this.nextTemp();
    this.emit(`${valuesCapI64} = zext i32 ${initialCapacity} to i64`);
    const valuesSize = this.nextTemp();
    this.emit(`${valuesSize} = mul i64 ${valuesCapI64}, ${doubleSize}`);
    const valuesMem = this.ctx.emitCall("i8*", "@GC_malloc_atomic", `i64 ${valuesSize}`);
    const valuesPtr = this.ctx.emitBitcast(valuesMem, "i8*", "double*");

    // Store keys pointer in Map struct
    const keysFieldPtr = this.nextTemp();
    this.emit(`${keysFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 0`);
    this.ctx.emitStore("double*", keysPtr, keysFieldPtr);

    // Store values pointer in Map struct
    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 1`);
    this.ctx.emitStore("double*", valuesPtr, valuesFieldPtr);

    // Store size
    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 2`);
    this.ctx.emitStore("i32", `${entries.length}`, sizeFieldPtr);

    // Store capacity
    const capacityFieldPtr = this.nextTemp();
    this.emit(`${capacityFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 3`);
    this.ctx.emitStore("i32", `${initialCapacity}`, capacityFieldPtr);

    // Populate initial entries
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i] as MapEntry;
      const keyValue = this.ctx.generateExpression(entry.key, params);
      const valueValue = this.ctx.generateExpression(entry.value, params);

      // Store key
      const keyElemPtr = this.nextTemp();
      this.emit(`${keyElemPtr} = getelementptr inbounds double, double* ${keysPtr}, i32 ${i}`);
      this.ctx.emitStore("double", this.ctx.ensureDouble(keyValue), keyElemPtr);

      // Store value
      const valueElemPtr = this.nextTemp();
      this.emit(`${valueElemPtr} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${i}`);
      this.ctx.emitStore("double", this.ctx.ensureDouble(valueValue), valueElemPtr);
    }

    // emitBitcast already set mapPtr type to %Map*
    return mapPtr;
  }

  generateMapSet(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 2) {
      return this.ctx.emitError("Map.set() requires exactly 2 arguments", expr.loc);
    }

    const mapPtr = this.ctx.generateExpression(expr.object, params);
    const keyValue = this.ctx.generateExpression(expr.args[0], params);
    const valueValue = this.ctx.generateExpression(expr.args[1], params);

    const keysFieldPtr = this.nextTemp();
    this.emit(`${keysFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 0`);
    const keysPtr = this.ctx.emitLoad("double*", keysFieldPtr);

    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 1`);
    const valuesPtr = this.ctx.emitLoad("double*", valuesFieldPtr);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 2`);
    const currentSize = this.ctx.emitLoad("i32", sizeFieldPtr);

    const searchLoopLabel = this.nextLabel("map_set_search");
    const searchBodyLabel = this.nextLabel("map_set_body");
    const foundLabel = this.nextLabel("map_set_found");
    const notFoundLabel = this.nextLabel("map_set_notfound");
    const insertLabel = this.nextLabel("map_set_insert");
    const endLabel = this.nextLabel("map_set_end");

    const indexReg = this.nextTemp();
    this.emit(`${indexReg} = alloca i32`);
    this.ctx.emitStore("i32", "0", indexReg);
    this.ctx.emitBr(searchLoopLabel);

    this.ctx.emitLabel(searchLoopLabel);
    const currentIndex = this.ctx.emitLoad("i32", indexReg);
    const searchCond = this.ctx.emitIcmp("slt", "i32", currentIndex, currentSize);
    this.ctx.emitBrCond(searchCond, searchBodyLabel, notFoundLabel);

    this.ctx.emitLabel(searchBodyLabel);
    const keyElemPtrSearch = this.nextTemp();
    this.emit(
      `${keyElemPtrSearch} = getelementptr inbounds double, double* ${keysPtr}, i32 ${currentIndex}`,
    );
    const keyAtIndex = this.ctx.emitLoad("double", keyElemPtrSearch);
    const dblKeyValue = this.ctx.ensureDouble(keyValue);
    const keyMatch = this.nextTemp();
    this.emit(`${keyMatch} = fcmp oeq double ${keyAtIndex}, ${dblKeyValue}`);
    this.ctx.emitBrCond(keyMatch, foundLabel, `${searchLoopLabel}_next`);

    this.ctx.emitLabel(`${searchLoopLabel}_next`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.ctx.emitStore("i32", nextIndex, indexReg);
    this.ctx.emitBr(searchLoopLabel);

    this.ctx.emitLabel(foundLabel);
    const foundIdx = this.ctx.emitLoad("i32", indexReg);
    const valueElemPtrFound = this.nextTemp();
    this.emit(
      `${valueElemPtrFound} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${foundIdx}`,
    );
    this.ctx.emitStore("double", this.ctx.ensureDouble(valueValue), valueElemPtrFound);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(notFoundLabel);
    this.ctx.emitBr(insertLabel);

    this.ctx.emitLabel(insertLabel);
    const capacityFieldPtr = this.nextTemp();
    this.emit(`${capacityFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 3`);
    const currentCapacity = this.ctx.emitLoad("i32", capacityFieldPtr);
    const needsResize = this.ctx.emitIcmp("sge", "i32", currentSize, currentCapacity);
    const resizeLabel = this.nextLabel("map_set_resize");
    const doInsertLabel = this.nextLabel("map_set_doinsert");
    this.ctx.emitBrCond(needsResize, resizeLabel, doInsertLabel);

    this.ctx.emitLabel(resizeLabel);
    const newCapacity = this.nextTemp();
    this.emit(`${newCapacity} = mul i32 ${currentCapacity}, 2`);
    const newCapI64 = this.nextTemp();
    this.emit(`${newCapI64} = zext i32 ${newCapacity} to i64`);
    const doubleSize = this.getDoubleSize();
    const newKeysSize = this.nextTemp();
    this.emit(`${newKeysSize} = mul i64 ${newCapI64}, ${doubleSize}`);
    const newKeysMem = this.ctx.emitCall("i8*", "@GC_malloc_atomic", `i64 ${newKeysSize}`);
    const newKeysPtr = this.ctx.emitBitcast(newKeysMem, "i8*", "double*");
    const oldKeysI8 = this.ctx.emitBitcast(keysPtr, "double*", "i8*");
    const oldCapI64 = this.nextTemp();
    this.emit(`${oldCapI64} = zext i32 ${currentCapacity} to i64`);
    const oldKeysSize = this.nextTemp();
    this.emit(`${oldKeysSize} = mul i64 ${oldCapI64}, ${doubleSize}`);
    this.emit(
      `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newKeysMem}, i8* ${oldKeysI8}, i64 ${oldKeysSize}, i1 false)`,
    );
    this.ctx.emitStore("double*", newKeysPtr, keysFieldPtr);
    const newValuesSize = this.nextTemp();
    this.emit(`${newValuesSize} = mul i64 ${newCapI64}, ${doubleSize}`);
    const newValuesMem = this.ctx.emitCall("i8*", "@GC_malloc_atomic", `i64 ${newValuesSize}`);
    const newValuesPtr = this.ctx.emitBitcast(newValuesMem, "i8*", "double*");
    const oldValuesI8 = this.ctx.emitBitcast(valuesPtr, "double*", "i8*");
    this.emit(
      `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newValuesMem}, i8* ${oldValuesI8}, i64 ${oldKeysSize}, i1 false)`,
    );
    this.ctx.emitStore("double*", newValuesPtr, valuesFieldPtr);
    this.ctx.emitStore("i32", newCapacity, capacityFieldPtr);
    this.ctx.emitBr(doInsertLabel);

    this.ctx.emitLabel(doInsertLabel);
    const insertKeysPtr = this.ctx.emitLoad("double*", keysFieldPtr);
    const insertValuesPtr = this.ctx.emitLoad("double*", valuesFieldPtr);
    const keyElemPtr = this.nextTemp();
    this.emit(
      `${keyElemPtr} = getelementptr inbounds double, double* ${insertKeysPtr}, i32 ${currentSize}`,
    );
    this.ctx.emitStore("double", this.ctx.ensureDouble(keyValue), keyElemPtr);

    const valueElemPtr = this.nextTemp();
    this.emit(
      `${valueElemPtr} = getelementptr inbounds double, double* ${insertValuesPtr}, i32 ${currentSize}`,
    );
    this.ctx.emitStore("double", this.ctx.ensureDouble(valueValue), valueElemPtr);

    const newSize = this.nextTemp();
    this.emit(`${newSize} = add i32 ${currentSize}, 1`);
    this.ctx.emitStore("i32", newSize, sizeFieldPtr);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(endLabel);

    return mapPtr;
  }

  generateMapGet(expr: MethodCallNode, params: string[]): string {
    // map.get(key)
    if (expr.args.length !== 1) {
      return this.ctx.emitError("Map.get() requires exactly 1 argument", expr.loc);
    }

    // Get map pointer
    const mapPtr = this.ctx.generateExpression(expr.object, params);

    // Generate key
    const keyToFind = this.ctx.generateExpression(expr.args[0], params);

    // Load arrays and size
    const keysFieldPtr = this.nextTemp();
    this.emit(`${keysFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 0`);
    const keysPtr = this.ctx.emitLoad("double*", keysFieldPtr);

    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 1`);
    const valuesPtr = this.ctx.emitLoad("double*", valuesFieldPtr);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 2`);
    const mapSize = this.ctx.emitLoad("i32", sizeFieldPtr);

    // For simplicity, linear search (in production, use hash table)
    // We'll just return the first matching key's value, or 0 if not found
    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca double`);
    this.ctx.emitStore("double", "0.0", resultReg); // Default to 0

    // Generate loop to search for key
    const loopLabel = this.nextLabel("map_has_loop");
    const bodyLabel = this.nextLabel("map_has_body");
    const foundLabel = this.nextLabel("map_has_found");
    const endLabel = this.nextLabel("map_has_end");

    const indexReg = this.nextTemp();
    this.emit(`${indexReg} = alloca i32`);
    this.ctx.emitStore("i32", "0", indexReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(loopLabel);
    const currentIndex = this.ctx.emitLoad("i32", indexReg);
    const cond = this.ctx.emitIcmp("slt", "i32", currentIndex, mapSize);
    this.ctx.emitBrCond(cond, bodyLabel, endLabel);

    this.ctx.emitLabel(bodyLabel);
    const keyElemPtr = this.nextTemp();
    this.emit(
      `${keyElemPtr} = getelementptr inbounds double, double* ${keysPtr}, i32 ${currentIndex}`,
    );
    const keyValue = this.ctx.emitLoad("double", keyElemPtr);
    const dblKeyToFind = this.ctx.ensureDouble(keyToFind);
    const keyMatch = this.nextTemp();
    this.emit(`${keyMatch} = fcmp oeq double ${keyValue}, ${dblKeyToFind}`);
    this.ctx.emitBrCond(keyMatch, foundLabel, `${loopLabel}_next`);

    this.ctx.emitLabel(foundLabel);
    const valueElemPtr = this.nextTemp();
    this.emit(
      `${valueElemPtr} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${currentIndex}`,
    );
    const foundValue = this.ctx.emitLoad("double", valueElemPtr);
    this.ctx.emitStore("double", foundValue, resultReg);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(`${loopLabel}_next`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.ctx.emitStore("i32", nextIndex, indexReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(endLabel);
    const result = this.ctx.emitLoad("double", resultReg);
    this.ctx.setVariableType(result, "double");
    return result;
  }

  generateMapHas(expr: MethodCallNode, params: string[]): string {
    // map.has(key) - returns 1 if key exists, 0 otherwise
    if (expr.args.length !== 1) {
      return this.ctx.emitError("Map.has() requires exactly 1 argument", expr.loc);
    }

    // Get map pointer
    const mapPtr = this.ctx.generateExpression(expr.object, params);

    // Generate key
    const keyToFind = this.ctx.generateExpression(expr.args[0], params);

    // Load arrays and size
    const keysFieldPtr = this.nextTemp();
    this.emit(`${keysFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 0`);
    const keysPtr = this.ctx.emitLoad("double*", keysFieldPtr);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 2`);
    const mapSize = this.ctx.emitLoad("i32", sizeFieldPtr);

    // Linear search for key
    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca double`);
    this.ctx.emitStore("double", "0.0", resultReg);

    const loopLabel = this.nextLabel("map_get_loop");
    const bodyLabel = this.nextLabel("map_get_body");
    const foundLabel = this.nextLabel("map_get_found");
    const endLabel = this.nextLabel("map_get_end");

    const indexReg = this.nextTemp();
    this.emit(`${indexReg} = alloca i32`);
    this.ctx.emitStore("i32", "0", indexReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(loopLabel);
    const currentIndex = this.ctx.emitLoad("i32", indexReg);
    const cond = this.ctx.emitIcmp("slt", "i32", currentIndex, mapSize);
    this.ctx.emitBrCond(cond, bodyLabel, endLabel);

    this.ctx.emitLabel(bodyLabel);
    const keyElemPtr = this.nextTemp();
    this.emit(
      `${keyElemPtr} = getelementptr inbounds double, double* ${keysPtr}, i32 ${currentIndex}`,
    );
    const keyValue = this.ctx.emitLoad("double", keyElemPtr);
    const dblKeyToFind = this.ctx.ensureDouble(keyToFind);
    const keyMatch = this.nextTemp();
    this.emit(`${keyMatch} = fcmp oeq double ${keyValue}, ${dblKeyToFind}`);
    this.ctx.emitBrCond(keyMatch, foundLabel, `${loopLabel}_next`);

    this.ctx.emitLabel(foundLabel);
    this.ctx.emitStore("double", "1.0", resultReg);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(`${loopLabel}_next`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.ctx.emitStore("i32", nextIndex, indexReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(endLabel);
    const result = this.ctx.emitLoad("double", resultReg);
    this.ctx.setVariableType(result, "double");
    return result;
  }

  generateMapSize(mapPtr: string): string {
    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 2`);
    const sizeI32 = this.ctx.emitLoad("i32", sizeFieldPtr);
    const size = this.nextTemp();
    this.emit(`${size} = sitofp i32 ${sizeI32} to double`);
    this.ctx.setVariableType(size, "double");
    return size;
  }

  generateMapClear(expr: MethodCallNode, params: string[]): string {
    const mapPtr = this.ctx.generateExpression(expr.object, params);
    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 2`);
    this.ctx.emitStore("i32", "0", sizeFieldPtr);
    return "0.0";
  }

  generateMapDelete(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      return this.ctx.emitError("Map.delete() requires exactly 1 argument", expr.loc);
    }

    const mapPtr = this.ctx.generateExpression(expr.object, params);
    const keyToFind = this.ctx.generateExpression(expr.args[0], params);

    const keysFieldPtr = this.nextTemp();
    this.emit(`${keysFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 0`);
    const keysPtr = this.ctx.emitLoad("double*", keysFieldPtr);

    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 1`);
    const valuesPtr = this.ctx.emitLoad("double*", valuesFieldPtr);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 2`);
    const mapSize = this.ctx.emitLoad("i32", sizeFieldPtr);

    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca double`);
    this.ctx.emitStore("double", "0.0", resultReg);

    const loopLabel = this.nextLabel("map_del_loop");
    const bodyLabel = this.nextLabel("map_del_body");
    const foundLabel = this.nextLabel("map_del_found");
    const shiftLabel = this.nextLabel("map_del_shift");
    const shiftBodyLabel = this.nextLabel("map_del_shift_body");
    const endLabel = this.nextLabel("map_del_end");

    const indexReg = this.nextTemp();
    this.emit(`${indexReg} = alloca i32`);
    this.ctx.emitStore("i32", "0", indexReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(loopLabel);
    const currentIndex = this.ctx.emitLoad("i32", indexReg);
    const cond = this.ctx.emitIcmp("slt", "i32", currentIndex, mapSize);
    this.ctx.emitBrCond(cond, bodyLabel, endLabel);

    this.ctx.emitLabel(bodyLabel);
    const keyElemPtr = this.nextTemp();
    this.emit(
      `${keyElemPtr} = getelementptr inbounds double, double* ${keysPtr}, i32 ${currentIndex}`,
    );
    const keyValue = this.ctx.emitLoad("double", keyElemPtr);
    const dblKeyToFind = this.ctx.ensureDouble(keyToFind);
    const keyMatch = this.nextTemp();
    this.emit(`${keyMatch} = fcmp oeq double ${keyValue}, ${dblKeyToFind}`);
    this.ctx.emitBrCond(keyMatch, foundLabel, `${loopLabel}_next`);

    this.ctx.emitLabel(foundLabel);
    this.ctx.emitStore("double", "1.0", resultReg);
    const newSize = this.nextTemp();
    this.emit(`${newSize} = sub i32 ${mapSize}, 1`);
    this.ctx.emitStore("i32", newSize, sizeFieldPtr);
    const shiftIdx = this.nextTemp();
    this.emit(`${shiftIdx} = alloca i32`);
    const currentIndex2 = this.ctx.emitLoad("i32", indexReg);
    this.ctx.emitStore("i32", currentIndex2, shiftIdx);
    this.ctx.emitBr(shiftLabel);

    this.ctx.emitLabel(shiftLabel);
    const shiftI = this.ctx.emitLoad("i32", shiftIdx);
    const shiftCond = this.ctx.emitIcmp("slt", "i32", shiftI, newSize);
    this.ctx.emitBrCond(shiftCond, shiftBodyLabel, endLabel);

    this.ctx.emitLabel(shiftBodyLabel);
    const nextI = this.nextTemp();
    this.emit(`${nextI} = add i32 ${shiftI}, 1`);
    const nextKeyPtr = this.nextTemp();
    this.emit(`${nextKeyPtr} = getelementptr inbounds double, double* ${keysPtr}, i32 ${nextI}`);
    const nextKey = this.ctx.emitLoad("double", nextKeyPtr);
    const currKeyPtr = this.nextTemp();
    this.emit(`${currKeyPtr} = getelementptr inbounds double, double* ${keysPtr}, i32 ${shiftI}`);
    this.ctx.emitStore("double", nextKey, currKeyPtr);
    const nextValPtr = this.nextTemp();
    this.emit(`${nextValPtr} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${nextI}`);
    const nextVal = this.ctx.emitLoad("double", nextValPtr);
    const currValPtr = this.nextTemp();
    this.emit(`${currValPtr} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${shiftI}`);
    this.ctx.emitStore("double", nextVal, currValPtr);
    this.ctx.emitStore("i32", nextI, shiftIdx);
    this.ctx.emitBr(shiftLabel);

    this.ctx.emitLabel(`${loopLabel}_next`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.ctx.emitStore("i32", nextIndex, indexReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(endLabel);
    const result = this.ctx.emitLoad("double", resultReg);

    return result;
  }
}

export class StringMapGenerator {
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

  generateEmptyStringMap(): string {
    const sizeofPtr = this.nextTemp();
    this.emit(`${sizeofPtr} = getelementptr %StringMap, %StringMap* null, i32 1`);
    const structSize = this.nextTemp();
    this.emit(`${structSize} = ptrtoint %StringMap* ${sizeofPtr} to i64`);
    const mapMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${structSize}`);
    const mapPtr = this.ctx.emitBitcast(mapMem, "i8*", "%StringMap*");

    const initialCapacity = 16;
    const ptrSize = this.getPtrSize();

    const keysSize = initialCapacity * ptrSize;
    const keysMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${keysSize}`);
    const keysPtr = this.ctx.emitBitcast(keysMem, "i8*", "i8**");

    const valuesMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${keysSize}`);
    const valuesPtr = this.ctx.emitBitcast(valuesMem, "i8*", "i8**");

    const keysFieldPtr = this.nextTemp();
    this.emit(
      `${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`,
    );
    this.ctx.emitStore("i8**", keysPtr, keysFieldPtr);

    const valuesFieldPtr = this.nextTemp();
    this.emit(
      `${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`,
    );
    this.ctx.emitStore("i8**", valuesPtr, valuesFieldPtr);

    const sizeFieldPtr = this.nextTemp();
    this.emit(
      `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
    );
    this.ctx.emitStore("i32", "0", sizeFieldPtr);

    const capacityFieldPtr = this.nextTemp();
    this.emit(
      `${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`,
    );
    this.ctx.emitStore("i32", `${initialCapacity}`, capacityFieldPtr);

    // emitBitcast already set mapPtr type to %StringMap*
    return mapPtr;
  }

  generateStringMapSet(mapPtr: string, keyValue: string, valueValue: string): string {
    let valueType = this.ctx.getVariableType(valueValue);
    if (!valueType && valueValue !== "null") {
      const fc = valueValue.charAt(0);
      if ((fc >= "0" && fc <= "9") || fc === "-" || fc === ".") {
        valueType = "double";
      }
    }
    let storedValue = valueValue;
    if (valueType === "double") {
      const asI64 = this.nextTemp();
      this.emit(`${asI64} = bitcast double ${valueValue} to i64`);
      storedValue = this.nextTemp();
      this.emit(`${storedValue} = inttoptr i64 ${asI64} to i8*`);
    } else if (valueType === "i64") {
      const asDouble = this.nextTemp();
      this.emit(`${asDouble} = sitofp i64 ${valueValue} to double`);
      const asI64Bits = this.nextTemp();
      this.emit(`${asI64Bits} = bitcast double ${asDouble} to i64`);
      storedValue = this.nextTemp();
      this.emit(`${storedValue} = inttoptr i64 ${asI64Bits} to i8*`);
    } else if (valueType === "i1") {
      const asDouble = this.nextTemp();
      this.emit(`${asDouble} = uitofp i1 ${valueValue} to double`);
      const asI64Bits = this.nextTemp();
      this.emit(`${asI64Bits} = bitcast double ${asDouble} to i64`);
      storedValue = this.nextTemp();
      this.emit(`${storedValue} = inttoptr i64 ${asI64Bits} to i8*`);
    }

    const keysFieldPtr = this.nextTemp();
    this.emit(
      `${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`,
    );
    const valuesFieldPtr = this.nextTemp();
    this.emit(
      `${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`,
    );
    const sizeFieldPtr = this.nextTemp();
    this.emit(
      `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
    );
    const capacityFieldPtr = this.nextTemp();
    this.emit(
      `${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`,
    );

    const currentSize = this.ctx.emitLoad("i32", sizeFieldPtr);
    const currentCapacity = this.ctx.emitLoad("i32", capacityFieldPtr);

    const resizeCheckLabel = this.nextLabel("strmap_set_resize_check");
    const resizeLabel = this.nextLabel("strmap_set_resize");
    const probeLabel = this.nextLabel("strmap_set_probe");
    const probeBodyLabel = this.nextLabel("strmap_set_probe_body");
    const foundLabel = this.nextLabel("strmap_set_found");
    const insertLabel = this.nextLabel("strmap_set_insert");
    const endLabel = this.nextLabel("strmap_set_end");

    // Check load factor: if (size+1) * 10 >= capacity * 7, resize before insertion
    const sizeP1 = this.nextTemp();
    this.emit(`${sizeP1} = add i32 ${currentSize}, 1`);
    const sizeTimes10 = this.nextTemp();
    this.emit(`${sizeTimes10} = mul i32 ${sizeP1}, 10`);
    const capTimes7 = this.nextTemp();
    this.emit(`${capTimes7} = mul i32 ${currentCapacity}, 7`);
    const needsResize = this.ctx.emitIcmp("sge", "i32", sizeTimes10, capTimes7);
    this.ctx.emitBrCond(needsResize, resizeLabel, resizeCheckLabel);

    // Resize: double capacity and rehash
    this.ctx.emitLabel(resizeLabel);
    const newCapacity = this.nextTemp();
    this.emit(`${newCapacity} = shl i32 ${currentCapacity}, 1`);
    const newCapI64 = this.nextTemp();
    this.emit(`${newCapI64} = sext i32 ${newCapacity} to i64`);
    const newArrSize = this.nextTemp();
    this.emit(`${newArrSize} = mul i64 ${newCapI64}, 8`);
    const newKeysMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${newArrSize}`);
    const newKeysPtr = this.ctx.emitBitcast(newKeysMem, "i8*", "i8**");
    const newValuesMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${newArrSize}`);
    const newValuesPtr = this.ctx.emitBitcast(newValuesMem, "i8*", "i8**");

    const oldKeysPtr = this.ctx.emitLoad("i8**", keysFieldPtr);
    const oldValuesPtr = this.ctx.emitLoad("i8**", valuesFieldPtr);

    this.ctx.emitCallVoid(
      "@__strmap_rehash",
      `i8** ${oldKeysPtr}, i8** ${oldValuesPtr}, i32 ${currentCapacity}, i8** ${newKeysPtr}, i8** ${newValuesPtr}, i32 ${newCapacity}`,
    );

    this.ctx.emitStore("i8**", newKeysPtr, keysFieldPtr);
    this.ctx.emitStore("i8**", newValuesPtr, valuesFieldPtr);
    this.ctx.emitStore("i32", newCapacity, capacityFieldPtr);
    this.ctx.emitBr(resizeCheckLabel);

    // After potential resize, load fresh pointers and capacity
    this.ctx.emitLabel(resizeCheckLabel);
    const keysPtr = this.ctx.emitLoad("i8**", keysFieldPtr);
    const valuesPtr = this.ctx.emitLoad("i8**", valuesFieldPtr);
    const capacity = this.ctx.emitLoad("i32", capacityFieldPtr);

    // Hash the key and compute initial slot
    const hash = this.ctx.emitCall("i32", "@__string_hash", `i8* ${keyValue}`);
    const mask = this.nextTemp();
    this.emit(`${mask} = sub i32 ${capacity}, 1`);
    const startSlot = this.nextTemp();
    this.emit(`${startSlot} = and i32 ${hash}, ${mask}`);

    // Probe loop
    const slotReg = this.nextTemp();
    this.emit(`${slotReg} = alloca i32`);
    this.ctx.emitStore("i32", startSlot, slotReg);
    this.ctx.emitBr(probeLabel);

    this.ctx.emitLabel(probeLabel);
    const slot = this.ctx.emitLoad("i32", slotReg);
    const keyElemPtr = this.nextTemp();
    this.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${slot}`);
    const keyAtSlot = this.ctx.emitLoad("i8*", keyElemPtr);
    const isNull = this.ctx.emitIcmp("eq", "i8*", keyAtSlot, "null");
    this.ctx.emitBrCond(isNull, insertLabel, probeBodyLabel);

    // Slot is occupied - check if same key
    this.ctx.emitLabel(probeBodyLabel);
    const cmpResult = this.ctx.emitCall("i32", "@strcmp", `i8* ${keyAtSlot}, i8* ${keyValue}`);
    const keyMatch = this.ctx.emitIcmp("eq", "i32", cmpResult, "0");
    this.ctx.emitBrCond(keyMatch, foundLabel, `${probeLabel}_next`);

    // Key already exists - update value
    this.ctx.emitLabel(foundLabel);
    const valElemPtrFound = this.nextTemp();
    this.emit(`${valElemPtrFound} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${slot}`);
    this.ctx.emitStore("i8*", storedValue, valElemPtrFound);
    this.ctx.emitBr(endLabel);

    // Next probe slot
    this.ctx.emitLabel(`${probeLabel}_next`);
    const nextSlot = this.nextTemp();
    this.emit(`${nextSlot} = add i32 ${slot}, 1`);
    const wrappedSlot = this.nextTemp();
    this.emit(`${wrappedSlot} = and i32 ${nextSlot}, ${mask}`);
    this.ctx.emitStore("i32", wrappedSlot, slotReg);
    this.ctx.emitBr(probeLabel);

    // Empty slot found - insert new entry
    this.ctx.emitLabel(insertLabel);
    const insertSlot = this.ctx.emitLoad("i32", slotReg);
    const keyInsertPtr = this.nextTemp();
    this.emit(`${keyInsertPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${insertSlot}`);
    this.ctx.emitStore("i8*", keyValue, keyInsertPtr);
    const valInsertPtr = this.nextTemp();
    this.emit(`${valInsertPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${insertSlot}`);
    this.ctx.emitStore("i8*", storedValue, valInsertPtr);

    const newSize = this.ctx.emitLoad("i32", sizeFieldPtr);
    const incSize = this.nextTemp();
    this.emit(`${incSize} = add i32 ${newSize}, 1`);
    this.ctx.emitStore("i32", incSize, sizeFieldPtr);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(endLabel);

    return mapPtr;
  }

  generateStringMapGet(mapPtr: string, keyToFind: string): string {
    const keysFieldPtr = this.nextTemp();
    this.emit(
      `${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`,
    );
    const keysPtr = this.ctx.emitLoad("i8**", keysFieldPtr);
    const valuesFieldPtr = this.nextTemp();
    this.emit(
      `${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`,
    );
    const valuesPtr = this.ctx.emitLoad("i8**", valuesFieldPtr);
    const capacityFieldPtr = this.nextTemp();
    this.emit(
      `${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`,
    );
    const capacity = this.ctx.emitLoad("i32", capacityFieldPtr);

    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca i8*`);
    this.ctx.emitStore("i8*", "null", resultReg);

    const hash = this.ctx.emitCall("i32", "@__string_hash", `i8* ${keyToFind}`);
    const mask = this.nextTemp();
    this.emit(`${mask} = sub i32 ${capacity}, 1`);
    const startSlot = this.nextTemp();
    this.emit(`${startSlot} = and i32 ${hash}, ${mask}`);

    const probeLabel = this.nextLabel("strmap_get_probe");
    const probeBodyLabel = this.nextLabel("strmap_get_body");
    const foundLabel = this.nextLabel("strmap_get_found");
    const endLabel = this.nextLabel("strmap_get_end");

    const slotReg = this.nextTemp();
    this.emit(`${slotReg} = alloca i32`);
    this.ctx.emitStore("i32", startSlot, slotReg);
    this.ctx.emitBr(probeLabel);

    this.ctx.emitLabel(probeLabel);
    const slot = this.ctx.emitLoad("i32", slotReg);
    const keyElemPtr = this.nextTemp();
    this.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${slot}`);
    const keyAtSlot = this.ctx.emitLoad("i8*", keyElemPtr);
    const isNull = this.ctx.emitIcmp("eq", "i8*", keyAtSlot, "null");
    this.ctx.emitBrCond(isNull, endLabel, probeBodyLabel);

    this.ctx.emitLabel(probeBodyLabel);
    const cmpResult = this.ctx.emitCall("i32", "@strcmp", `i8* ${keyAtSlot}, i8* ${keyToFind}`);
    const keyMatch = this.ctx.emitIcmp("eq", "i32", cmpResult, "0");
    this.ctx.emitBrCond(keyMatch, foundLabel, `${probeLabel}_next`);

    this.ctx.emitLabel(foundLabel);
    const valueElemPtr = this.nextTemp();
    this.emit(`${valueElemPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${slot}`);
    const foundValue = this.ctx.emitLoad("i8*", valueElemPtr);
    this.ctx.emitStore("i8*", foundValue, resultReg);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(`${probeLabel}_next`);
    const nextSlot = this.nextTemp();
    this.emit(`${nextSlot} = add i32 ${slot}, 1`);
    const wrappedSlot = this.nextTemp();
    this.emit(`${wrappedSlot} = and i32 ${nextSlot}, ${mask}`);
    this.ctx.emitStore("i32", wrappedSlot, slotReg);
    this.ctx.emitBr(probeLabel);

    this.ctx.emitLabel(endLabel);
    // emitLoad auto-sets type to i8*
    const result = this.ctx.emitLoad("i8*", resultReg);

    return result;
  }

  generateStringMapHas(mapPtr: string, keyToFind: string): string {
    const keysFieldPtr = this.nextTemp();
    this.emit(
      `${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`,
    );
    const keysPtr = this.ctx.emitLoad("i8**", keysFieldPtr);
    const capacityFieldPtr = this.nextTemp();
    this.emit(
      `${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`,
    );
    const capacity = this.ctx.emitLoad("i32", capacityFieldPtr);

    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca double`);
    this.ctx.emitStore("double", "0.0", resultReg);

    const hash = this.ctx.emitCall("i32", "@__string_hash", `i8* ${keyToFind}`);
    const mask = this.nextTemp();
    this.emit(`${mask} = sub i32 ${capacity}, 1`);
    const startSlot = this.nextTemp();
    this.emit(`${startSlot} = and i32 ${hash}, ${mask}`);

    const probeLabel = this.nextLabel("strmap_has_probe");
    const probeBodyLabel = this.nextLabel("strmap_has_body");
    const foundLabel = this.nextLabel("strmap_has_found");
    const endLabel = this.nextLabel("strmap_has_end");

    const slotReg = this.nextTemp();
    this.emit(`${slotReg} = alloca i32`);
    this.ctx.emitStore("i32", startSlot, slotReg);
    this.ctx.emitBr(probeLabel);

    this.ctx.emitLabel(probeLabel);
    const slot = this.ctx.emitLoad("i32", slotReg);
    const keyElemPtr = this.nextTemp();
    this.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${slot}`);
    const keyAtSlot = this.ctx.emitLoad("i8*", keyElemPtr);
    const isNull = this.ctx.emitIcmp("eq", "i8*", keyAtSlot, "null");
    this.ctx.emitBrCond(isNull, endLabel, probeBodyLabel);

    this.ctx.emitLabel(probeBodyLabel);
    const cmpResult = this.ctx.emitCall("i32", "@strcmp", `i8* ${keyAtSlot}, i8* ${keyToFind}`);
    const keyMatch = this.ctx.emitIcmp("eq", "i32", cmpResult, "0");
    this.ctx.emitBrCond(keyMatch, foundLabel, `${probeLabel}_next`);

    this.ctx.emitLabel(foundLabel);
    this.ctx.emitStore("double", "1.0", resultReg);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(`${probeLabel}_next`);
    const nextSlot = this.nextTemp();
    this.emit(`${nextSlot} = add i32 ${slot}, 1`);
    const wrappedSlot = this.nextTemp();
    this.emit(`${wrappedSlot} = and i32 ${nextSlot}, ${mask}`);
    this.ctx.emitStore("i32", wrappedSlot, slotReg);
    this.ctx.emitBr(probeLabel);

    this.ctx.emitLabel(endLabel);
    const result = this.ctx.emitLoad("double", resultReg);
    this.ctx.setVariableType(result, "double");
    return result;
  }

  generateStringMapSize(mapPtr: string): string {
    const sizeFieldPtr = this.nextTemp();
    this.emit(
      `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
    );
    const sizeI32 = this.ctx.emitLoad("i32", sizeFieldPtr);
    const size = this.nextTemp();
    this.emit(`${size} = sitofp i32 ${sizeI32} to double`);
    this.ctx.setVariableType(size, "double");
    return size;
  }

  generateStringMapClear(mapPtr: string): string {
    const keysFieldPtr = this.nextTemp();
    this.emit(
      `${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`,
    );
    const valuesFieldPtr = this.nextTemp();
    this.emit(
      `${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`,
    );
    const capacityFieldPtr = this.nextTemp();
    this.emit(
      `${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`,
    );
    const capacity = this.ctx.emitLoad("i32", capacityFieldPtr);

    const capI64 = this.nextTemp();
    this.emit(`${capI64} = sext i32 ${capacity} to i64`);
    const arrSize = this.nextTemp();
    this.emit(`${arrSize} = mul i64 ${capI64}, 8`);

    const newKeysMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${arrSize}`);
    const newKeysPtr = this.ctx.emitBitcast(newKeysMem, "i8*", "i8**");
    this.ctx.emitStore("i8**", newKeysPtr, keysFieldPtr);

    const newValuesMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${arrSize}`);
    const newValuesPtr = this.ctx.emitBitcast(newValuesMem, "i8*", "i8**");
    this.ctx.emitStore("i8**", newValuesPtr, valuesFieldPtr);

    const sizeFieldPtr = this.nextTemp();
    this.emit(
      `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
    );
    this.ctx.emitStore("i32", "0", sizeFieldPtr);
    return "0.0";
  }

  generateStringMapDelete(mapPtr: string, keyToFind: string): string {
    const keysFieldPtr = this.nextTemp();
    this.emit(
      `${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`,
    );
    const keysPtr = this.ctx.emitLoad("i8**", keysFieldPtr);
    const valuesFieldPtr = this.nextTemp();
    this.emit(
      `${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`,
    );
    const valuesPtr = this.ctx.emitLoad("i8**", valuesFieldPtr);
    const sizeFieldPtr = this.nextTemp();
    this.emit(
      `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
    );
    const capacityFieldPtr = this.nextTemp();
    this.emit(
      `${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`,
    );
    const capacity = this.ctx.emitLoad("i32", capacityFieldPtr);

    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca double`);
    this.ctx.emitStore("double", "0.0", resultReg);

    const hash = this.ctx.emitCall("i32", "@__string_hash", `i8* ${keyToFind}`);
    const mask = this.nextTemp();
    this.emit(`${mask} = sub i32 ${capacity}, 1`);
    const startSlot = this.nextTemp();
    this.emit(`${startSlot} = and i32 ${hash}, ${mask}`);

    const probeLabel = this.nextLabel("strmap_del_probe");
    const probeBodyLabel = this.nextLabel("strmap_del_body");
    const foundLabel = this.nextLabel("strmap_del_found");
    const rehashLabel = this.nextLabel("strmap_del_rehash");
    const rehashBodyLabel = this.nextLabel("strmap_del_rehash_body");
    const rehashInsertLabel = this.nextLabel("strmap_del_rehash_insert");
    const rehashProbeLabel = this.nextLabel("strmap_del_rehash_probe");
    const rehashPlaceLabel = this.nextLabel("strmap_del_rehash_place");
    const endLabel = this.nextLabel("strmap_del_end");

    const slotReg = this.nextTemp();
    this.emit(`${slotReg} = alloca i32`);
    this.ctx.emitStore("i32", startSlot, slotReg);
    this.ctx.emitBr(probeLabel);

    this.ctx.emitLabel(probeLabel);
    const slot = this.ctx.emitLoad("i32", slotReg);
    const keyElemPtr = this.nextTemp();
    this.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${slot}`);
    const keyAtSlot = this.ctx.emitLoad("i8*", keyElemPtr);
    const isNull = this.ctx.emitIcmp("eq", "i8*", keyAtSlot, "null");
    this.ctx.emitBrCond(isNull, endLabel, probeBodyLabel);

    this.ctx.emitLabel(probeBodyLabel);
    const cmpResult = this.ctx.emitCall("i32", "@strcmp", `i8* ${keyAtSlot}, i8* ${keyToFind}`);
    const keyMatch = this.ctx.emitIcmp("eq", "i32", cmpResult, "0");
    this.ctx.emitBrCond(keyMatch, foundLabel, `${probeLabel}_next`);

    this.ctx.emitLabel(`${probeLabel}_next`);
    const nextSlotDel = this.nextTemp();
    this.emit(`${nextSlotDel} = add i32 ${slot}, 1`);
    const wrappedSlotDel = this.nextTemp();
    this.emit(`${wrappedSlotDel} = and i32 ${nextSlotDel}, ${mask}`);
    this.ctx.emitStore("i32", wrappedSlotDel, slotReg);
    this.ctx.emitBr(probeLabel);

    // Found - remove entry and backward-shift rehash
    this.ctx.emitLabel(foundLabel);
    this.ctx.emitStore("double", "1.0", resultReg);
    const foundSlot = this.ctx.emitLoad("i32", slotReg);
    const foundKeyPtr = this.nextTemp();
    this.emit(`${foundKeyPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${foundSlot}`);
    this.ctx.emitStore("i8*", "null", foundKeyPtr);
    const foundValPtr = this.nextTemp();
    this.emit(`${foundValPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${foundSlot}`);
    this.ctx.emitStore("i8*", "null", foundValPtr);
    const curSize = this.ctx.emitLoad("i32", sizeFieldPtr);
    const decSize = this.nextTemp();
    this.emit(`${decSize} = sub i32 ${curSize}, 1`);
    this.ctx.emitStore("i32", decSize, sizeFieldPtr);

    // Backward-shift rehash: fix up subsequent entries displaced by linear probing
    const rehashIdx = this.nextTemp();
    this.emit(`${rehashIdx} = alloca i32`);
    const nextAfterFound = this.nextTemp();
    this.emit(`${nextAfterFound} = add i32 ${foundSlot}, 1`);
    const wrappedNext = this.nextTemp();
    this.emit(`${wrappedNext} = and i32 ${nextAfterFound}, ${mask}`);
    this.ctx.emitStore("i32", wrappedNext, rehashIdx);
    this.ctx.emitBr(rehashLabel);

    this.ctx.emitLabel(rehashLabel);
    const ri = this.ctx.emitLoad("i32", rehashIdx);
    const riKeyPtr = this.nextTemp();
    this.emit(`${riKeyPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${ri}`);
    const riKey = this.ctx.emitLoad("i8*", riKeyPtr);
    const riIsNull = this.ctx.emitIcmp("eq", "i8*", riKey, "null");
    this.ctx.emitBrCond(riIsNull, endLabel, rehashBodyLabel);

    this.ctx.emitLabel(rehashBodyLabel);
    const riHash = this.ctx.emitCall("i32", "@__string_hash", `i8* ${riKey}`);
    const riDesired = this.nextTemp();
    this.emit(`${riDesired} = and i32 ${riHash}, ${mask}`);
    // Remove current entry
    this.ctx.emitStore("i8*", "null", riKeyPtr);
    const riValPtr = this.nextTemp();
    this.emit(`${riValPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${ri}`);
    const riVal = this.ctx.emitLoad("i8*", riValPtr);
    this.ctx.emitStore("i8*", "null", riValPtr);
    // Re-insert from desired position
    const riSlotReg = this.nextTemp();
    this.emit(`${riSlotReg} = alloca i32`);
    this.ctx.emitStore("i32", riDesired, riSlotReg);
    this.ctx.emitBr(rehashProbeLabel);

    this.ctx.emitLabel(rehashProbeLabel);
    const riSlot = this.ctx.emitLoad("i32", riSlotReg);
    const riSlotKeyPtr = this.nextTemp();
    this.emit(`${riSlotKeyPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${riSlot}`);
    const riSlotKey = this.ctx.emitLoad("i8*", riSlotKeyPtr);
    const riSlotEmpty = this.ctx.emitIcmp("eq", "i8*", riSlotKey, "null");
    this.ctx.emitBrCond(riSlotEmpty, rehashPlaceLabel, `${rehashProbeLabel}_next`);

    this.ctx.emitLabel(`${rehashProbeLabel}_next`);
    const riNextSlot = this.nextTemp();
    this.emit(`${riNextSlot} = add i32 ${riSlot}, 1`);
    const riWrapped = this.nextTemp();
    this.emit(`${riWrapped} = and i32 ${riNextSlot}, ${mask}`);
    this.ctx.emitStore("i32", riWrapped, riSlotReg);
    this.ctx.emitBr(rehashProbeLabel);

    this.ctx.emitLabel(rehashPlaceLabel);
    const placeSlot = this.ctx.emitLoad("i32", riSlotReg);
    const placeKeyPtr = this.nextTemp();
    this.emit(`${placeKeyPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${placeSlot}`);
    this.ctx.emitStore("i8*", riKey, placeKeyPtr);
    const placeValPtr = this.nextTemp();
    this.emit(`${placeValPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${placeSlot}`);
    this.ctx.emitStore("i8*", riVal, placeValPtr);

    const riNext = this.nextTemp();
    this.emit(`${riNext} = add i32 ${ri}, 1`);
    const riNextWrapped = this.nextTemp();
    this.emit(`${riNextWrapped} = and i32 ${riNext}, ${mask}`);
    this.ctx.emitStore("i32", riNextWrapped, rehashIdx);
    this.ctx.emitBr(rehashLabel);

    this.ctx.emitLabel(endLabel);
    const result = this.ctx.emitLoad("double", resultReg);
    this.ctx.setVariableType(result, "double");
    return result;
  }

  generateStringMapEntries(mapPtr: string): string {
    const keysFieldPtr = this.nextTemp();
    this.emit(
      `${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`,
    );
    const keysPtr = this.ctx.emitLoad("i8**", keysFieldPtr);

    const valuesFieldPtr = this.nextTemp();
    this.emit(
      `${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`,
    );
    const valuesPtr = this.ctx.emitLoad("i8**", valuesFieldPtr);

    const sizeFieldPtr = this.nextTemp();
    this.emit(
      `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
    );
    const mapSize = this.ctx.emitLoad("i32", sizeFieldPtr);

    const capacityFieldPtr = this.nextTemp();
    this.emit(
      `${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`,
    );
    const mapCapacity = this.ctx.emitLoad("i32", capacityFieldPtr);

    const arrayMem = this.ctx.emitCall("i8*", "@GC_malloc", "i64 24");
    const arrayPtr = this.ctx.emitBitcast(arrayMem, "i8*", "%Array*");

    const mapSizeI64 = this.nextTemp();
    this.emit(`${mapSizeI64} = sext i32 ${mapSize} to i64`);
    const dataSize = this.nextTemp();
    this.emit(`${dataSize} = mul i64 ${mapSizeI64}, 8`);
    const dataMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${dataSize}`);
    const dataPtr = this.ctx.emitBitcast(dataMem, "i8*", "i8**");

    const lenFieldPtr = this.nextTemp();
    this.emit(`${lenFieldPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    this.ctx.emitStore("i32", mapSize, lenFieldPtr);
    const capFieldPtr = this.nextTemp();
    this.emit(`${capFieldPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    this.ctx.emitStore("i32", mapSize, capFieldPtr);
    const dataFieldPtr = this.nextTemp();
    this.emit(`${dataFieldPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
    const dataCast = this.ctx.emitBitcast(dataPtr, "i8**", "double*");
    this.ctx.emitStore("double*", dataCast, dataFieldPtr);

    const loopLabel = this.nextLabel("strmap_entries_loop");
    const bodyLabel = this.nextLabel("strmap_entries_body");
    const skipLabel = this.nextLabel("strmap_entries_skip");
    const endLabel = this.nextLabel("strmap_entries_end");

    const indexReg = this.nextTemp();
    this.emit(`${indexReg} = alloca i32`);
    this.ctx.emitStore("i32", "0", indexReg);
    const outIdxReg = this.nextTemp();
    this.emit(`${outIdxReg} = alloca i32`);
    this.ctx.emitStore("i32", "0", outIdxReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(loopLabel);
    const currentIndex = this.ctx.emitLoad("i32", indexReg);
    const cond = this.ctx.emitIcmp("slt", "i32", currentIndex, mapCapacity);
    this.ctx.emitBrCond(cond, bodyLabel, endLabel);

    this.ctx.emitLabel(bodyLabel);
    const keyElemPtr = this.nextTemp();
    this.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${currentIndex}`);
    const keyValue = this.ctx.emitLoad("i8*", keyElemPtr);
    const keyIsNull = this.ctx.emitIcmp("eq", "i8*", keyValue, "null");
    this.ctx.emitBrCond(keyIsNull, skipLabel, `${bodyLabel}_store`);

    this.ctx.emitLabel(`${bodyLabel}_store`);
    const valueElemPtr = this.nextTemp();
    this.emit(
      `${valueElemPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${currentIndex}`,
    );
    const valueValue = this.ctx.emitLoad("i8*", valueElemPtr);

    const entryMem = this.ctx.emitCall("i8*", "@GC_malloc", "i64 16");
    const entryKvPtr = this.ctx.emitBitcast(entryMem, "i8*", "{ i8*, i8* }*");
    const keySlot = this.nextTemp();
    this.emit(
      `${keySlot} = getelementptr inbounds { i8*, i8* }, { i8*, i8* }* ${entryKvPtr}, i32 0, i32 0`,
    );
    this.ctx.emitStore("i8*", keyValue, keySlot);
    const valueSlot = this.nextTemp();
    this.emit(
      `${valueSlot} = getelementptr inbounds { i8*, i8* }, { i8*, i8* }* ${entryKvPtr}, i32 0, i32 1`,
    );
    this.ctx.emitStore("i8*", valueValue, valueSlot);

    const outIdx = this.ctx.emitLoad("i32", outIdxReg);
    const entrySlot = this.nextTemp();
    this.emit(`${entrySlot} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${outIdx}`);
    this.ctx.emitStore("i8*", entryMem, entrySlot);
    const nextOut = this.nextTemp();
    this.emit(`${nextOut} = add i32 ${outIdx}, 1`);
    this.ctx.emitStore("i32", nextOut, outIdxReg);
    this.ctx.emitBr(skipLabel);

    this.ctx.emitLabel(skipLabel);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.ctx.emitStore("i32", nextIndex, indexReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(endLabel);

    return arrayPtr;
  }

  generateStringMapValues(mapPtr: string): string {
    const valuesFieldPtr = this.nextTemp();
    this.emit(
      `${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`,
    );
    const valuesPtr = this.ctx.emitLoad("i8**", valuesFieldPtr);

    const keysFieldPtr = this.nextTemp();
    this.emit(
      `${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`,
    );
    const keysPtr = this.ctx.emitLoad("i8**", keysFieldPtr);

    const sizeFieldPtr = this.nextTemp();
    this.emit(
      `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
    );
    const mapSize = this.ctx.emitLoad("i32", sizeFieldPtr);

    const capacityFieldPtr = this.nextTemp();
    this.emit(
      `${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`,
    );
    const mapCapacity = this.ctx.emitLoad("i32", capacityFieldPtr);

    const arrayMem = this.ctx.emitCall("i8*", "@GC_malloc", "i64 24");
    const arrayPtr = this.ctx.emitBitcast(arrayMem, "i8*", "%Array*");

    const mapSizeI64 = this.nextTemp();
    this.emit(`${mapSizeI64} = sext i32 ${mapSize} to i64`);
    const dataSize = this.nextTemp();
    this.emit(`${dataSize} = mul i64 ${mapSizeI64}, 8`);
    const dataMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${dataSize}`);
    const dataPtr = this.ctx.emitBitcast(dataMem, "i8*", "i8**");

    const lenFieldPtr = this.nextTemp();
    this.emit(`${lenFieldPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    this.ctx.emitStore("i32", mapSize, lenFieldPtr);
    const capFieldPtr = this.nextTemp();
    this.emit(`${capFieldPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    this.ctx.emitStore("i32", mapSize, capFieldPtr);
    const dataFieldPtr = this.nextTemp();
    this.emit(`${dataFieldPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
    const dataCast = this.ctx.emitBitcast(dataPtr, "i8**", "double*");
    this.ctx.emitStore("double*", dataCast, dataFieldPtr);

    const loopLabel = this.nextLabel("strmap_values_loop");
    const bodyLabel = this.nextLabel("strmap_values_body");
    const skipLabel = this.nextLabel("strmap_values_skip");
    const endLabel = this.nextLabel("strmap_values_end");

    const indexReg = this.nextTemp();
    this.emit(`${indexReg} = alloca i32`);
    this.ctx.emitStore("i32", "0", indexReg);
    const outIdxReg = this.nextTemp();
    this.emit(`${outIdxReg} = alloca i32`);
    this.ctx.emitStore("i32", "0", outIdxReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(loopLabel);
    const currentIndex = this.ctx.emitLoad("i32", indexReg);
    const cond = this.ctx.emitIcmp("slt", "i32", currentIndex, mapCapacity);
    this.ctx.emitBrCond(cond, bodyLabel, endLabel);

    this.ctx.emitLabel(bodyLabel);
    const keyElemPtr = this.nextTemp();
    this.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${currentIndex}`);
    const keyValue = this.ctx.emitLoad("i8*", keyElemPtr);
    const keyIsNull = this.ctx.emitIcmp("eq", "i8*", keyValue, "null");
    this.ctx.emitBrCond(keyIsNull, skipLabel, `${bodyLabel}_store`);

    this.ctx.emitLabel(`${bodyLabel}_store`);
    const valueElemPtr = this.nextTemp();
    this.emit(
      `${valueElemPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${currentIndex}`,
    );
    const valueValue = this.ctx.emitLoad("i8*", valueElemPtr);

    const outIdx = this.ctx.emitLoad("i32", outIdxReg);
    const valueSlot = this.nextTemp();
    this.emit(`${valueSlot} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${outIdx}`);
    this.ctx.emitStore("i8*", valueValue, valueSlot);
    const nextOut = this.nextTemp();
    this.emit(`${nextOut} = add i32 ${outIdx}, 1`);
    this.ctx.emitStore("i32", nextOut, outIdxReg);
    this.ctx.emitBr(skipLabel);

    this.ctx.emitLabel(skipLabel);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.ctx.emitStore("i32", nextIndex, indexReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(endLabel);

    return arrayPtr;
  }

  generateStringMapKeys(mapPtr: string): string {
    const keysFieldPtr = this.nextTemp();
    this.emit(
      `${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`,
    );
    const keysPtr = this.ctx.emitLoad("i8**", keysFieldPtr);

    const sizeFieldPtr = this.nextTemp();
    this.emit(
      `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
    );
    const mapSize = this.ctx.emitLoad("i32", sizeFieldPtr);

    const capacityFieldPtr = this.nextTemp();
    this.emit(
      `${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`,
    );
    const mapCapacity = this.ctx.emitLoad("i32", capacityFieldPtr);

    const arrayMem = this.ctx.emitCall("i8*", "@GC_malloc", "i64 24");
    const arrayPtr = this.ctx.emitBitcast(arrayMem, "i8*", "%StringArray*");

    const mapSizeI64 = this.nextTemp();
    this.emit(`${mapSizeI64} = sext i32 ${mapSize} to i64`);
    const dataSize = this.nextTemp();
    this.emit(`${dataSize} = mul i64 ${mapSizeI64}, 8`);
    const dataMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${dataSize}`);
    const dataPtr = this.ctx.emitBitcast(dataMem, "i8*", "i8**");

    const dataPtrField = this.nextTemp();
    this.emit(
      `${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
    );
    this.ctx.emitStore("i8**", dataPtr, dataPtrField);
    const lenFieldPtr = this.nextTemp();
    this.emit(
      `${lenFieldPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`,
    );
    this.ctx.emitStore("i32", mapSize, lenFieldPtr);
    const capFieldPtr = this.nextTemp();
    this.emit(
      `${capFieldPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 2`,
    );
    this.ctx.emitStore("i32", mapSize, capFieldPtr);

    const loopLabel = this.nextLabel("strmap_keys_loop");
    const bodyLabel = this.nextLabel("strmap_keys_body");
    const skipLabel = this.nextLabel("strmap_keys_skip");
    const endLabel = this.nextLabel("strmap_keys_end");

    const indexReg = this.nextTemp();
    this.emit(`${indexReg} = alloca i32`);
    this.ctx.emitStore("i32", "0", indexReg);
    const outIdxReg = this.nextTemp();
    this.emit(`${outIdxReg} = alloca i32`);
    this.ctx.emitStore("i32", "0", outIdxReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(loopLabel);
    const currentIndex = this.ctx.emitLoad("i32", indexReg);
    const cond = this.ctx.emitIcmp("slt", "i32", currentIndex, mapCapacity);
    this.ctx.emitBrCond(cond, bodyLabel, endLabel);

    this.ctx.emitLabel(bodyLabel);
    const keyElemPtr = this.nextTemp();
    this.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${currentIndex}`);
    const keyVal = this.ctx.emitLoad("i8*", keyElemPtr);
    const keyIsNull = this.ctx.emitIcmp("eq", "i8*", keyVal, "null");
    this.ctx.emitBrCond(keyIsNull, skipLabel, `${bodyLabel}_store`);

    this.ctx.emitLabel(`${bodyLabel}_store`);
    const outIdx = this.ctx.emitLoad("i32", outIdxReg);
    const destElemPtr = this.nextTemp();
    this.emit(`${destElemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${outIdx}`);
    this.ctx.emitStore("i8*", keyVal, destElemPtr);
    const nextOut = this.nextTemp();
    this.emit(`${nextOut} = add i32 ${outIdx}, 1`);
    this.ctx.emitStore("i32", nextOut, outIdxReg);
    this.ctx.emitBr(skipLabel);

    this.ctx.emitLabel(skipLabel);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.ctx.emitStore("i32", nextIndex, indexReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(endLabel);

    // emitBitcast already set arrayPtr type to %StringArray*
    return arrayPtr;
  }
}

export class PointerMapGenerator {
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

  generatePointerMapGet(mapPtr: string, keyToFind: string, valueType: string): string {
    const keysFieldPtr = this.nextTemp();
    this.emit(
      `${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`,
    );
    const keysPtr = this.ctx.emitLoad("i8**", keysFieldPtr);

    const valuesFieldPtr = this.nextTemp();
    this.emit(
      `${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`,
    );
    const valuesPtr = this.ctx.emitLoad("i8**", valuesFieldPtr);

    const sizeFieldPtr = this.nextTemp();
    this.emit(
      `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
    );
    const mapSize = this.ctx.emitLoad("i32", sizeFieldPtr);

    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca i8*`);
    this.ctx.emitStore("i8*", "null", resultReg);

    const loopLabel = this.nextLabel("ptrmap_get_loop");
    const bodyLabel = this.nextLabel("ptrmap_get_body");
    const foundLabel = this.nextLabel("ptrmap_get_found");
    const endLabel = this.nextLabel("ptrmap_get_end");

    const indexReg = this.nextTemp();
    this.emit(`${indexReg} = alloca i32`);
    this.ctx.emitStore("i32", "0", indexReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(loopLabel);
    const currentIndex = this.ctx.emitLoad("i32", indexReg);
    const cond = this.ctx.emitIcmp("slt", "i32", currentIndex, mapSize);
    this.ctx.emitBrCond(cond, bodyLabel, endLabel);

    this.ctx.emitLabel(bodyLabel);
    const keyElemPtr = this.nextTemp();
    this.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${currentIndex}`);
    const keyValue = this.ctx.emitLoad("i8*", keyElemPtr);
    const keyCmp = this.ctx.emitCall("i32", "@strcmp", `i8* ${keyValue}, i8* ${keyToFind}`);
    const keyMatch = this.ctx.emitIcmp("eq", "i32", keyCmp, "0");
    this.ctx.emitBrCond(keyMatch, foundLabel, `${loopLabel}_next`);

    this.ctx.emitLabel(foundLabel);
    const valueElemPtr = this.nextTemp();
    this.emit(
      `${valueElemPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${currentIndex}`,
    );
    const foundValue = this.ctx.emitLoad("i8*", valueElemPtr);
    this.ctx.emitStore("i8*", foundValue, resultReg);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(`${loopLabel}_next`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.ctx.emitStore("i32", nextIndex, indexReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(endLabel);
    // emitLoad auto-sets type to i8*
    const result = this.ctx.emitLoad("i8*", resultReg);

    return result;
  }

  generatePointerMapSet(mapPtr: string, keyValue: string, valueValue: string): string {
    const keysFieldPtr = this.nextTemp();
    this.emit(
      `${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`,
    );
    const keysPtr = this.ctx.emitLoad("i8**", keysFieldPtr);

    const valuesFieldPtr = this.nextTemp();
    this.emit(
      `${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`,
    );
    const valuesPtr = this.ctx.emitLoad("i8**", valuesFieldPtr);

    const sizeFieldPtr = this.nextTemp();
    this.emit(
      `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
    );
    const currentSize = this.ctx.emitLoad("i32", sizeFieldPtr);

    const searchLoopLabel = this.nextLabel("ptrmap_set_search");
    const searchBodyLabel = this.nextLabel("ptrmap_set_body");
    const foundLabel = this.nextLabel("ptrmap_set_found");
    const notFoundLabel = this.nextLabel("ptrmap_set_notfound");
    const insertLabel = this.nextLabel("ptrmap_set_insert");
    const endLabel = this.nextLabel("ptrmap_set_end");

    const indexReg = this.nextTemp();
    this.emit(`${indexReg} = alloca i32`);
    this.ctx.emitStore("i32", "0", indexReg);
    this.ctx.emitBr(searchLoopLabel);

    this.ctx.emitLabel(searchLoopLabel);
    const currentIndex = this.ctx.emitLoad("i32", indexReg);
    const searchCond = this.ctx.emitIcmp("slt", "i32", currentIndex, currentSize);
    this.ctx.emitBrCond(searchCond, searchBodyLabel, notFoundLabel);

    this.ctx.emitLabel(searchBodyLabel);
    const keyElemPtrSearch = this.nextTemp();
    this.emit(
      `${keyElemPtrSearch} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${currentIndex}`,
    );
    const keyAtIndex = this.ctx.emitLoad("i8*", keyElemPtrSearch);
    const keyCmp = this.ctx.emitCall("i32", "@strcmp", `i8* ${keyAtIndex}, i8* ${keyValue}`);
    const keyMatch = this.ctx.emitIcmp("eq", "i32", keyCmp, "0");
    this.ctx.emitBrCond(keyMatch, foundLabel, `${searchLoopLabel}_next`);

    this.ctx.emitLabel(`${searchLoopLabel}_next`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.ctx.emitStore("i32", nextIndex, indexReg);
    this.ctx.emitBr(searchLoopLabel);

    this.ctx.emitLabel(foundLabel);
    const foundIdx = this.ctx.emitLoad("i32", indexReg);
    const valueElemPtrFound = this.nextTemp();
    this.emit(
      `${valueElemPtrFound} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${foundIdx}`,
    );
    this.ctx.emitStore("i8*", valueValue, valueElemPtrFound);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(notFoundLabel);
    this.ctx.emitBr(insertLabel);

    this.ctx.emitLabel(insertLabel);
    const capacityFieldPtr = this.nextTemp();
    this.emit(
      `${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`,
    );
    const currentCapacity = this.ctx.emitLoad("i32", capacityFieldPtr);
    const needsResize = this.ctx.emitIcmp("sge", "i32", currentSize, currentCapacity);
    const resizeLabel = this.nextLabel("ptrmap_set_resize");
    const doInsertLabel = this.nextLabel("ptrmap_set_doinsert");
    this.ctx.emitBrCond(needsResize, resizeLabel, doInsertLabel);

    this.ctx.emitLabel(resizeLabel);
    const newCapacity = this.nextTemp();
    this.emit(`${newCapacity} = mul i32 ${currentCapacity}, 2`);
    const newCapI64 = this.nextTemp();
    this.emit(`${newCapI64} = zext i32 ${newCapacity} to i64`);
    const ptrSize = 8;
    const newKeysSize = this.nextTemp();
    this.emit(`${newKeysSize} = mul i64 ${newCapI64}, ${ptrSize}`);
    const newKeysMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${newKeysSize}`);
    const newKeysPtr = this.ctx.emitBitcast(newKeysMem, "i8*", "i8**");
    const oldKeysI8 = this.ctx.emitBitcast(keysPtr, "i8**", "i8*");
    const oldCapI64 = this.nextTemp();
    this.emit(`${oldCapI64} = zext i32 ${currentCapacity} to i64`);
    const oldKeysSize = this.nextTemp();
    this.emit(`${oldKeysSize} = mul i64 ${oldCapI64}, ${ptrSize}`);
    this.emit(
      `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newKeysMem}, i8* ${oldKeysI8}, i64 ${oldKeysSize}, i1 false)`,
    );
    this.ctx.emitStore("i8**", newKeysPtr, keysFieldPtr);
    const newValuesSize = this.nextTemp();
    this.emit(`${newValuesSize} = mul i64 ${newCapI64}, ${ptrSize}`);
    const newValuesMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${newValuesSize}`);
    const newValuesPtr = this.ctx.emitBitcast(newValuesMem, "i8*", "i8**");
    const oldValuesI8 = this.ctx.emitBitcast(valuesPtr, "i8**", "i8*");
    this.emit(
      `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newValuesMem}, i8* ${oldValuesI8}, i64 ${oldKeysSize}, i1 false)`,
    );
    this.ctx.emitStore("i8**", newValuesPtr, valuesFieldPtr);
    this.ctx.emitStore("i32", newCapacity, capacityFieldPtr);
    this.ctx.emitBr(doInsertLabel);

    this.ctx.emitLabel(doInsertLabel);
    const insertKeysPtr = this.ctx.emitLoad("i8**", keysFieldPtr);
    const insertValuesPtr = this.ctx.emitLoad("i8**", valuesFieldPtr);
    const keyElemPtr = this.nextTemp();
    this.emit(
      `${keyElemPtr} = getelementptr inbounds i8*, i8** ${insertKeysPtr}, i32 ${currentSize}`,
    );
    this.ctx.emitStore("i8*", keyValue, keyElemPtr);

    const valueElemPtr = this.nextTemp();
    this.emit(
      `${valueElemPtr} = getelementptr inbounds i8*, i8** ${insertValuesPtr}, i32 ${currentSize}`,
    );
    this.ctx.emitStore("i8*", valueValue, valueElemPtr);

    const newSize = this.nextTemp();
    this.emit(`${newSize} = add i32 ${currentSize}, 1`);
    this.ctx.emitStore("i32", newSize, sizeFieldPtr);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(endLabel);

    return mapPtr;
  }

  generatePointerMapClear(mapPtr: string): string {
    const sizeFieldPtr = this.nextTemp();
    this.emit(
      `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
    );
    this.ctx.emitStore("i32", "0", sizeFieldPtr);
    return "0.0";
  }

  generatePointerMapHas(mapPtr: string, keyToFind: string): string {
    const keysFieldPtr = this.nextTemp();
    this.emit(
      `${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`,
    );
    const keysPtr = this.ctx.emitLoad("i8**", keysFieldPtr);

    const sizeFieldPtr = this.nextTemp();
    this.emit(
      `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
    );
    const mapSize = this.ctx.emitLoad("i32", sizeFieldPtr);

    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca double`);
    this.ctx.emitStore("double", "0.0", resultReg);

    const loopLabel = this.nextLabel("ptrmap_has_loop");
    const bodyLabel = this.nextLabel("ptrmap_has_body");
    const foundLabel = this.nextLabel("ptrmap_has_found");
    const endLabel = this.nextLabel("ptrmap_has_end");

    const indexReg = this.nextTemp();
    this.emit(`${indexReg} = alloca i32`);
    this.ctx.emitStore("i32", "0", indexReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(loopLabel);
    const currentIndex = this.ctx.emitLoad("i32", indexReg);
    const cond = this.ctx.emitIcmp("slt", "i32", currentIndex, mapSize);
    this.ctx.emitBrCond(cond, bodyLabel, endLabel);

    this.ctx.emitLabel(bodyLabel);
    const keyElemPtr = this.nextTemp();
    this.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${currentIndex}`);
    const keyValue = this.ctx.emitLoad("i8*", keyElemPtr);
    const keyCmp = this.ctx.emitCall("i32", "@strcmp", `i8* ${keyValue}, i8* ${keyToFind}`);
    const keyMatch = this.ctx.emitIcmp("eq", "i32", keyCmp, "0");
    this.ctx.emitBrCond(keyMatch, foundLabel, `${loopLabel}_next`);

    this.ctx.emitLabel(foundLabel);
    this.ctx.emitStore("double", "1.0", resultReg);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(`${loopLabel}_next`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.ctx.emitStore("i32", nextIndex, indexReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(endLabel);
    const result = this.ctx.emitLoad("double", resultReg);
    this.ctx.setVariableType(result, "double");
    return result;
  }

  generatePointerMapDelete(mapPtr: string, keyToFind: string): string {
    const keysFieldPtr = this.nextTemp();
    this.emit(
      `${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`,
    );
    const keysPtr = this.ctx.emitLoad("i8**", keysFieldPtr);

    const valuesFieldPtr = this.nextTemp();
    this.emit(
      `${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`,
    );
    const valuesPtr = this.ctx.emitLoad("i8**", valuesFieldPtr);

    const sizeFieldPtr = this.nextTemp();
    this.emit(
      `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
    );
    const currentSize = this.ctx.emitLoad("i32", sizeFieldPtr);

    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca double`);
    this.ctx.emitStore("double", "0.0", resultReg);

    const loopLabel = this.nextLabel("ptrmap_del_loop");
    const bodyLabel = this.nextLabel("ptrmap_del_body");
    const foundLabel = this.nextLabel("ptrmap_del_found");
    const endLabel = this.nextLabel("ptrmap_del_end");

    const indexReg = this.nextTemp();
    this.emit(`${indexReg} = alloca i32`);
    this.ctx.emitStore("i32", "0", indexReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(loopLabel);
    const currentIndex = this.ctx.emitLoad("i32", indexReg);
    const cond = this.ctx.emitIcmp("slt", "i32", currentIndex, currentSize);
    this.ctx.emitBrCond(cond, bodyLabel, endLabel);

    this.ctx.emitLabel(bodyLabel);
    const keyElemPtr = this.nextTemp();
    this.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${currentIndex}`);
    const keyValue = this.ctx.emitLoad("i8*", keyElemPtr);
    const keyCmp = this.ctx.emitCall("i32", "@strcmp", `i8* ${keyValue}, i8* ${keyToFind}`);
    const keyMatch = this.ctx.emitIcmp("eq", "i32", keyCmp, "0");
    this.ctx.emitBrCond(keyMatch, foundLabel, `${loopLabel}_next`);

    this.ctx.emitLabel(foundLabel);
    this.ctx.emitStore("double", "1.0", resultReg);
    const lastIdx = this.nextTemp();
    this.emit(`${lastIdx} = sub i32 ${currentSize}, 1`);
    const lastKeyPtr = this.nextTemp();
    this.emit(`${lastKeyPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${lastIdx}`);
    const lastKey = this.ctx.emitLoad("i8*", lastKeyPtr);
    this.ctx.emitStore("i8*", lastKey, keyElemPtr);
    const valElemPtr = this.nextTemp();
    this.emit(`${valElemPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${currentIndex}`);
    const lastValPtr = this.nextTemp();
    this.emit(`${lastValPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${lastIdx}`);
    const lastVal = this.ctx.emitLoad("i8*", lastValPtr);
    this.ctx.emitStore("i8*", lastVal, valElemPtr);
    this.ctx.emitStore("i32", lastIdx, sizeFieldPtr);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(`${loopLabel}_next`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.ctx.emitStore("i32", nextIndex, indexReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(endLabel);
    const result = this.ctx.emitLoad("double", resultReg);
    this.ctx.setVariableType(result, "double");
    return result;
  }

  generatePointerMapSize(mapPtr: string): string {
    const sizeFieldPtr = this.nextTemp();
    this.emit(
      `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
    );
    const sizeI32 = this.ctx.emitLoad("i32", sizeFieldPtr);
    const size = this.nextTemp();
    this.emit(`${size} = sitofp i32 ${sizeI32} to double`);
    this.ctx.setVariableType(size, "double");
    return size;
  }

  generatePointerMapEntries(mapPtr: string): string {
    const keysFieldPtr = this.nextTemp();
    this.emit(
      `${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`,
    );
    const keysPtr = this.ctx.emitLoad("i8**", keysFieldPtr);

    const valuesFieldPtr = this.nextTemp();
    this.emit(
      `${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`,
    );
    const valuesPtr = this.ctx.emitLoad("i8**", valuesFieldPtr);

    const sizeFieldPtr = this.nextTemp();
    this.emit(
      `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
    );
    const mapSize = this.ctx.emitLoad("i32", sizeFieldPtr);

    const arrayMem = this.ctx.emitCall("i8*", "@GC_malloc", "i64 24");
    const arrayPtr = this.ctx.emitBitcast(arrayMem, "i8*", "%Array*");

    const mapSizeI64 = this.nextTemp();
    this.emit(`${mapSizeI64} = sext i32 ${mapSize} to i64`);
    const dataSize = this.nextTemp();
    this.emit(`${dataSize} = mul i64 ${mapSizeI64}, 8`);
    const dataMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${dataSize}`);
    const dataPtr = this.ctx.emitBitcast(dataMem, "i8*", "i8**");

    const lenFieldPtr = this.nextTemp();
    this.emit(`${lenFieldPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    this.ctx.emitStore("i32", mapSize, lenFieldPtr);
    const capFieldPtr = this.nextTemp();
    this.emit(`${capFieldPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    this.ctx.emitStore("i32", mapSize, capFieldPtr);
    const dataFieldPtr = this.nextTemp();
    this.emit(`${dataFieldPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
    const dataCast = this.ctx.emitBitcast(dataPtr, "i8**", "double*");
    this.ctx.emitStore("double*", dataCast, dataFieldPtr);

    const loopLabel = this.nextLabel("ptrmap_entries_loop");
    const bodyLabel = this.nextLabel("ptrmap_entries_body");
    const endLabel = this.nextLabel("ptrmap_entries_end");

    const indexReg = this.nextTemp();
    this.emit(`${indexReg} = alloca i32`);
    this.ctx.emitStore("i32", "0", indexReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(loopLabel);
    const currentIndex = this.ctx.emitLoad("i32", indexReg);
    const cond = this.ctx.emitIcmp("slt", "i32", currentIndex, mapSize);
    this.ctx.emitBrCond(cond, bodyLabel, endLabel);

    this.ctx.emitLabel(bodyLabel);
    const keyElemPtr = this.nextTemp();
    this.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${currentIndex}`);
    const keyValue = this.ctx.emitLoad("i8*", keyElemPtr);
    const valueElemPtr = this.nextTemp();
    this.emit(
      `${valueElemPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${currentIndex}`,
    );
    const valueValue = this.ctx.emitLoad("i8*", valueElemPtr);

    const entryMem = this.ctx.emitCall("i8*", "@GC_malloc", "i64 16");
    const entryKvPtr = this.ctx.emitBitcast(entryMem, "i8*", "{ i8*, i8* }*");
    const keySlot = this.nextTemp();
    this.emit(
      `${keySlot} = getelementptr inbounds { i8*, i8* }, { i8*, i8* }* ${entryKvPtr}, i32 0, i32 0`,
    );
    this.ctx.emitStore("i8*", keyValue, keySlot);
    const valueSlot = this.nextTemp();
    this.emit(
      `${valueSlot} = getelementptr inbounds { i8*, i8* }, { i8*, i8* }* ${entryKvPtr}, i32 0, i32 1`,
    );
    this.ctx.emitStore("i8*", valueValue, valueSlot);

    const entrySlot = this.nextTemp();
    this.emit(`${entrySlot} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${currentIndex}`);
    this.ctx.emitStore("i8*", entryMem, entrySlot);

    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.ctx.emitStore("i32", nextIndex, indexReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(endLabel);

    return arrayPtr;
  }

  generatePointerMapKeys(mapPtr: string): string {
    const keysFieldPtr = this.nextTemp();
    this.emit(
      `${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`,
    );
    const keysPtr = this.ctx.emitLoad("i8**", keysFieldPtr);

    const sizeFieldPtr = this.nextTemp();
    this.emit(
      `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
    );
    const mapSize = this.ctx.emitLoad("i32", sizeFieldPtr);

    const arrayMem = this.ctx.emitCall("i8*", "@GC_malloc", "i64 24");
    const arrayPtr = this.ctx.emitBitcast(arrayMem, "i8*", "%ObjectArray*");

    const mapSizeI64 = this.nextTemp();
    this.emit(`${mapSizeI64} = sext i32 ${mapSize} to i64`);
    const dataSize = this.nextTemp();
    this.emit(`${dataSize} = mul i64 ${mapSizeI64}, 8`);
    const dataMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${dataSize}`);

    const dataPtrField = this.nextTemp();
    this.emit(
      `${dataPtrField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`,
    );
    this.ctx.emitStore("i8*", dataMem, dataPtrField);
    const lenFieldPtr = this.nextTemp();
    this.emit(
      `${lenFieldPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 1`,
    );
    this.ctx.emitStore("i32", mapSize, lenFieldPtr);
    const capFieldPtr = this.nextTemp();
    this.emit(
      `${capFieldPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 2`,
    );
    this.ctx.emitStore("i32", mapSize, capFieldPtr);

    const dataPtr = this.ctx.emitBitcast(dataMem, "i8*", "i8**");

    const loopLabel = this.nextLabel("ptrmap_keys_loop");
    const bodyLabel = this.nextLabel("ptrmap_keys_body");
    const endLabel = this.nextLabel("ptrmap_keys_end");

    const indexReg = this.nextTemp();
    this.emit(`${indexReg} = alloca i32`);
    this.ctx.emitStore("i32", "0", indexReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(loopLabel);
    const currentIndex = this.ctx.emitLoad("i32", indexReg);
    const cond = this.ctx.emitIcmp("slt", "i32", currentIndex, mapSize);
    this.ctx.emitBrCond(cond, bodyLabel, endLabel);

    this.ctx.emitLabel(bodyLabel);
    const keyElemPtr = this.nextTemp();
    this.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${currentIndex}`);
    const keyVal = this.ctx.emitLoad("i8*", keyElemPtr);
    const destElemPtr = this.nextTemp();
    this.emit(`${destElemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${currentIndex}`);
    this.ctx.emitStore("i8*", keyVal, destElemPtr);

    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.ctx.emitStore("i32", nextIndex, indexReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(endLabel);

    return arrayPtr;
  }

  generatePointerMapValues(mapPtr: string): string {
    const valuesFieldPtr = this.nextTemp();
    this.emit(
      `${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`,
    );
    const valuesPtr = this.ctx.emitLoad("i8**", valuesFieldPtr);

    const sizeFieldPtr = this.nextTemp();
    this.emit(
      `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
    );
    const mapSize = this.ctx.emitLoad("i32", sizeFieldPtr);

    const arrayMem = this.ctx.emitCall("i8*", "@GC_malloc", "i64 24");
    const arrayPtr = this.ctx.emitBitcast(arrayMem, "i8*", "%ObjectArray*");

    const mapSizeI64 = this.nextTemp();
    this.emit(`${mapSizeI64} = sext i32 ${mapSize} to i64`);
    const dataSize = this.nextTemp();
    this.emit(`${dataSize} = mul i64 ${mapSizeI64}, 8`);
    const dataMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${dataSize}`);

    const dataPtrField = this.nextTemp();
    this.emit(
      `${dataPtrField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`,
    );
    this.ctx.emitStore("i8*", dataMem, dataPtrField);
    const lenFieldPtr = this.nextTemp();
    this.emit(
      `${lenFieldPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 1`,
    );
    this.ctx.emitStore("i32", mapSize, lenFieldPtr);
    const capFieldPtr = this.nextTemp();
    this.emit(
      `${capFieldPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 2`,
    );
    this.ctx.emitStore("i32", mapSize, capFieldPtr);

    const dataPtr = this.ctx.emitBitcast(dataMem, "i8*", "i8**");

    const loopLabel = this.nextLabel("ptrmap_values_loop");
    const bodyLabel = this.nextLabel("ptrmap_values_body");
    const endLabel = this.nextLabel("ptrmap_values_end");

    const indexReg = this.nextTemp();
    this.emit(`${indexReg} = alloca i32`);
    this.ctx.emitStore("i32", "0", indexReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(loopLabel);
    const currentIndex = this.ctx.emitLoad("i32", indexReg);
    const cond = this.ctx.emitIcmp("slt", "i32", currentIndex, mapSize);
    this.ctx.emitBrCond(cond, bodyLabel, endLabel);

    this.ctx.emitLabel(bodyLabel);
    const valueElemPtr = this.nextTemp();
    this.emit(
      `${valueElemPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${currentIndex}`,
    );
    const valueVal = this.ctx.emitLoad("i8*", valueElemPtr);
    const destElemPtr = this.nextTemp();
    this.emit(`${destElemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${currentIndex}`);
    this.ctx.emitStore("i8*", valueVal, destElemPtr);

    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.ctx.emitStore("i32", nextIndex, indexReg);
    this.ctx.emitBr(loopLabel);

    this.ctx.emitLabel(endLabel);

    return arrayPtr;
  }
}
