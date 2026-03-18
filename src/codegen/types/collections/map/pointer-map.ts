import { IGeneratorContext } from "../../../infrastructure/generator-context.js";

export function generatePointerMapGet(
  ctx: IGeneratorContext,
  mapPtr: string,
  keyToFind: string,
  valueType: string,
): string {
  const keysFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`,
  );
  const keysPtr = ctx.emitLoad("i8**", keysFieldPtr);

  const valuesFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`,
  );
  const valuesPtr = ctx.emitLoad("i8**", valuesFieldPtr);

  const sizeFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
  );
  const mapSize = ctx.emitLoad("i32", sizeFieldPtr);

  const resultReg = ctx.nextTemp();
  ctx.emit(`${resultReg} = alloca i8*`);
  ctx.emitStore("i8*", "null", resultReg);

  const loopLabel = ctx.nextLabel("ptrmap_get_loop");
  const bodyLabel = ctx.nextLabel("ptrmap_get_body");
  const foundLabel = ctx.nextLabel("ptrmap_get_found");
  const endLabel = ctx.nextLabel("ptrmap_get_end");

  const indexReg = ctx.nextTemp();
  ctx.emit(`${indexReg} = alloca i32`);
  ctx.emitStore("i32", "0", indexReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(loopLabel);
  const currentIndex = ctx.emitLoad("i32", indexReg);
  const cond = ctx.emitIcmp("slt", "i32", currentIndex, mapSize);
  ctx.emitBrCond(cond, bodyLabel, endLabel);

  ctx.emitLabel(bodyLabel);
  const keyElemPtr = ctx.nextTemp();
  ctx.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${currentIndex}`);
  const keyValue = ctx.emitLoad("i8*", keyElemPtr);
  const keyCmp = ctx.emitCall("i32", "@strcmp", `i8* ${keyValue}, i8* ${keyToFind}`);
  const keyMatch = ctx.emitIcmp("eq", "i32", keyCmp, "0");
  ctx.emitBrCond(keyMatch, foundLabel, `${loopLabel}_next`);

  ctx.emitLabel(foundLabel);
  const valueElemPtr = ctx.nextTemp();
  ctx.emit(`${valueElemPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${currentIndex}`);
  const foundValue = ctx.emitLoad("i8*", valueElemPtr);
  ctx.emitStore("i8*", foundValue, resultReg);
  ctx.emitBr(endLabel);

  ctx.emitLabel(`${loopLabel}_next`);
  const nextIndex = ctx.nextTemp();
  ctx.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
  ctx.emitStore("i32", nextIndex, indexReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(endLabel);
  const result = ctx.emitLoad("i8*", resultReg);

  return result;
}

export function generatePointerMapSet(
  ctx: IGeneratorContext,
  mapPtr: string,
  keyValue: string,
  valueValue: string,
): string {
  const keysFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`,
  );
  const keysPtr = ctx.emitLoad("i8**", keysFieldPtr);

  const valuesFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`,
  );
  const valuesPtr = ctx.emitLoad("i8**", valuesFieldPtr);

  const sizeFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
  );
  const currentSize = ctx.emitLoad("i32", sizeFieldPtr);

  const searchLoopLabel = ctx.nextLabel("ptrmap_set_search");
  const searchBodyLabel = ctx.nextLabel("ptrmap_set_body");
  const foundLabel = ctx.nextLabel("ptrmap_set_found");
  const notFoundLabel = ctx.nextLabel("ptrmap_set_notfound");
  const insertLabel = ctx.nextLabel("ptrmap_set_insert");
  const endLabel = ctx.nextLabel("ptrmap_set_end");

  const indexReg = ctx.nextTemp();
  ctx.emit(`${indexReg} = alloca i32`);
  ctx.emitStore("i32", "0", indexReg);
  ctx.emitBr(searchLoopLabel);

  ctx.emitLabel(searchLoopLabel);
  const currentIndex = ctx.emitLoad("i32", indexReg);
  const searchCond = ctx.emitIcmp("slt", "i32", currentIndex, currentSize);
  ctx.emitBrCond(searchCond, searchBodyLabel, notFoundLabel);

  ctx.emitLabel(searchBodyLabel);
  const keyElemPtrSearch = ctx.nextTemp();
  ctx.emit(
    `${keyElemPtrSearch} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${currentIndex}`,
  );
  const keyAtIndex = ctx.emitLoad("i8*", keyElemPtrSearch);
  const keyCmp = ctx.emitCall("i32", "@strcmp", `i8* ${keyAtIndex}, i8* ${keyValue}`);
  const keyMatch = ctx.emitIcmp("eq", "i32", keyCmp, "0");
  ctx.emitBrCond(keyMatch, foundLabel, `${searchLoopLabel}_next`);

  ctx.emitLabel(`${searchLoopLabel}_next`);
  const nextIndex = ctx.nextTemp();
  ctx.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
  ctx.emitStore("i32", nextIndex, indexReg);
  ctx.emitBr(searchLoopLabel);

  ctx.emitLabel(foundLabel);
  const foundIdx = ctx.emitLoad("i32", indexReg);
  const valueElemPtrFound = ctx.nextTemp();
  ctx.emit(`${valueElemPtrFound} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${foundIdx}`);
  ctx.emitStore("i8*", valueValue, valueElemPtrFound);
  ctx.emitBr(endLabel);

  ctx.emitLabel(notFoundLabel);
  ctx.emitBr(insertLabel);

  ctx.emitLabel(insertLabel);
  const capacityFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`,
  );
  const currentCapacity = ctx.emitLoad("i32", capacityFieldPtr);
  const needsResize = ctx.emitIcmp("sge", "i32", currentSize, currentCapacity);
  const resizeLabel = ctx.nextLabel("ptrmap_set_resize");
  const doInsertLabel = ctx.nextLabel("ptrmap_set_doinsert");
  ctx.emitBrCond(needsResize, resizeLabel, doInsertLabel);

  ctx.emitLabel(resizeLabel);
  const newCapacity = ctx.nextTemp();
  ctx.emit(`${newCapacity} = mul i32 ${currentCapacity}, 2`);
  const newCapI64 = ctx.nextTemp();
  ctx.emit(`${newCapI64} = zext i32 ${newCapacity} to i64`);
  const ptrSize = 8;
  const newKeysSize = ctx.nextTemp();
  ctx.emit(`${newKeysSize} = mul i64 ${newCapI64}, ${ptrSize}`);
  const newKeysMem = ctx.emitCall("i8*", "@GC_malloc", `i64 ${newKeysSize}`);
  const newKeysPtr = ctx.emitBitcast(newKeysMem, "i8*", "i8**");
  const oldKeysI8 = ctx.emitBitcast(keysPtr, "i8**", "i8*");
  const oldCapI64 = ctx.nextTemp();
  ctx.emit(`${oldCapI64} = zext i32 ${currentCapacity} to i64`);
  const oldKeysSize = ctx.nextTemp();
  ctx.emit(`${oldKeysSize} = mul i64 ${oldCapI64}, ${ptrSize}`);
  ctx.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newKeysMem}, i8* ${oldKeysI8}, i64 ${oldKeysSize}, i1 false)`,
  );
  ctx.emitStore("i8**", newKeysPtr, keysFieldPtr);
  const newValuesSize = ctx.nextTemp();
  ctx.emit(`${newValuesSize} = mul i64 ${newCapI64}, ${ptrSize}`);
  const newValuesMem = ctx.emitCall("i8*", "@GC_malloc", `i64 ${newValuesSize}`);
  const newValuesPtr = ctx.emitBitcast(newValuesMem, "i8*", "i8**");
  const oldValuesI8 = ctx.emitBitcast(valuesPtr, "i8**", "i8*");
  ctx.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newValuesMem}, i8* ${oldValuesI8}, i64 ${oldKeysSize}, i1 false)`,
  );
  ctx.emitStore("i8**", newValuesPtr, valuesFieldPtr);
  ctx.emitStore("i32", newCapacity, capacityFieldPtr);
  ctx.emitBr(doInsertLabel);

  ctx.emitLabel(doInsertLabel);
  const insertKeysPtr = ctx.emitLoad("i8**", keysFieldPtr);
  const insertValuesPtr = ctx.emitLoad("i8**", valuesFieldPtr);
  const keyElemPtr = ctx.nextTemp();
  ctx.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${insertKeysPtr}, i32 ${currentSize}`);
  ctx.emitStore("i8*", keyValue, keyElemPtr);

  const valueElemPtr = ctx.nextTemp();
  ctx.emit(
    `${valueElemPtr} = getelementptr inbounds i8*, i8** ${insertValuesPtr}, i32 ${currentSize}`,
  );
  ctx.emitStore("i8*", valueValue, valueElemPtr);

  const newSize = ctx.nextTemp();
  ctx.emit(`${newSize} = add i32 ${currentSize}, 1`);
  ctx.emitStore("i32", newSize, sizeFieldPtr);
  ctx.emitBr(endLabel);

  ctx.emitLabel(endLabel);

  return mapPtr;
}

export function generatePointerMapClear(ctx: IGeneratorContext, mapPtr: string): string {
  const sizeFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
  );
  ctx.emitStore("i32", "0", sizeFieldPtr);
  return "0.0";
}

export function generatePointerMapHas(
  ctx: IGeneratorContext,
  mapPtr: string,
  keyToFind: string,
): string {
  const keysFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`,
  );
  const keysPtr = ctx.emitLoad("i8**", keysFieldPtr);

  const sizeFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
  );
  const mapSize = ctx.emitLoad("i32", sizeFieldPtr);

  const resultReg = ctx.nextTemp();
  ctx.emit(`${resultReg} = alloca double`);
  ctx.emitStore("double", "0.0", resultReg);

  const loopLabel = ctx.nextLabel("ptrmap_has_loop");
  const bodyLabel = ctx.nextLabel("ptrmap_has_body");
  const foundLabel = ctx.nextLabel("ptrmap_has_found");
  const endLabel = ctx.nextLabel("ptrmap_has_end");

  const indexReg = ctx.nextTemp();
  ctx.emit(`${indexReg} = alloca i32`);
  ctx.emitStore("i32", "0", indexReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(loopLabel);
  const currentIndex = ctx.emitLoad("i32", indexReg);
  const cond = ctx.emitIcmp("slt", "i32", currentIndex, mapSize);
  ctx.emitBrCond(cond, bodyLabel, endLabel);

  ctx.emitLabel(bodyLabel);
  const keyElemPtr = ctx.nextTemp();
  ctx.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${currentIndex}`);
  const keyValue = ctx.emitLoad("i8*", keyElemPtr);
  const keyCmp = ctx.emitCall("i32", "@strcmp", `i8* ${keyValue}, i8* ${keyToFind}`);
  const keyMatch = ctx.emitIcmp("eq", "i32", keyCmp, "0");
  ctx.emitBrCond(keyMatch, foundLabel, `${loopLabel}_next`);

  ctx.emitLabel(foundLabel);
  ctx.emitStore("double", "1.0", resultReg);
  ctx.emitBr(endLabel);

  ctx.emitLabel(`${loopLabel}_next`);
  const nextIndex = ctx.nextTemp();
  ctx.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
  ctx.emitStore("i32", nextIndex, indexReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(endLabel);
  const result = ctx.emitLoad("double", resultReg);
  ctx.setVariableType(result, "double");
  return result;
}

export function generatePointerMapDelete(
  ctx: IGeneratorContext,
  mapPtr: string,
  keyToFind: string,
): string {
  const keysFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`,
  );
  const keysPtr = ctx.emitLoad("i8**", keysFieldPtr);

  const valuesFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`,
  );
  const valuesPtr = ctx.emitLoad("i8**", valuesFieldPtr);

  const sizeFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
  );
  const currentSize = ctx.emitLoad("i32", sizeFieldPtr);

  const resultReg = ctx.nextTemp();
  ctx.emit(`${resultReg} = alloca double`);
  ctx.emitStore("double", "0.0", resultReg);

  const loopLabel = ctx.nextLabel("ptrmap_del_loop");
  const bodyLabel = ctx.nextLabel("ptrmap_del_body");
  const foundLabel = ctx.nextLabel("ptrmap_del_found");
  const endLabel = ctx.nextLabel("ptrmap_del_end");

  const indexReg = ctx.nextTemp();
  ctx.emit(`${indexReg} = alloca i32`);
  ctx.emitStore("i32", "0", indexReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(loopLabel);
  const currentIndex = ctx.emitLoad("i32", indexReg);
  const cond = ctx.emitIcmp("slt", "i32", currentIndex, currentSize);
  ctx.emitBrCond(cond, bodyLabel, endLabel);

  ctx.emitLabel(bodyLabel);
  const keyElemPtr = ctx.nextTemp();
  ctx.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${currentIndex}`);
  const keyValue = ctx.emitLoad("i8*", keyElemPtr);
  const keyCmp = ctx.emitCall("i32", "@strcmp", `i8* ${keyValue}, i8* ${keyToFind}`);
  const keyMatch = ctx.emitIcmp("eq", "i32", keyCmp, "0");
  ctx.emitBrCond(keyMatch, foundLabel, `${loopLabel}_next`);

  ctx.emitLabel(foundLabel);
  ctx.emitStore("double", "1.0", resultReg);
  const lastIdx = ctx.nextTemp();
  ctx.emit(`${lastIdx} = sub i32 ${currentSize}, 1`);
  const lastKeyPtr = ctx.nextTemp();
  ctx.emit(`${lastKeyPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${lastIdx}`);
  const lastKey = ctx.emitLoad("i8*", lastKeyPtr);
  ctx.emitStore("i8*", lastKey, keyElemPtr);
  const valElemPtr = ctx.nextTemp();
  ctx.emit(`${valElemPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${currentIndex}`);
  const lastValPtr = ctx.nextTemp();
  ctx.emit(`${lastValPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${lastIdx}`);
  const lastVal = ctx.emitLoad("i8*", lastValPtr);
  ctx.emitStore("i8*", lastVal, valElemPtr);
  ctx.emitStore("i32", lastIdx, sizeFieldPtr);
  ctx.emitBr(endLabel);

  ctx.emitLabel(`${loopLabel}_next`);
  const nextIndex = ctx.nextTemp();
  ctx.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
  ctx.emitStore("i32", nextIndex, indexReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(endLabel);
  const result = ctx.emitLoad("double", resultReg);
  ctx.setVariableType(result, "double");
  return result;
}

export function generatePointerMapSize(ctx: IGeneratorContext, mapPtr: string): string {
  const sizeFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
  );
  const sizeI32 = ctx.emitLoad("i32", sizeFieldPtr);
  const size = ctx.nextTemp();
  ctx.emit(`${size} = sitofp i32 ${sizeI32} to double`);
  ctx.setVariableType(size, "double");
  return size;
}

export function generatePointerMapEntries(ctx: IGeneratorContext, mapPtr: string): string {
  const keysFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`,
  );
  const keysPtr = ctx.emitLoad("i8**", keysFieldPtr);

  const valuesFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`,
  );
  const valuesPtr = ctx.emitLoad("i8**", valuesFieldPtr);

  const sizeFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
  );
  const mapSize = ctx.emitLoad("i32", sizeFieldPtr);

  const arrayMem = ctx.emitCall("i8*", "@GC_malloc", "i64 24");
  const arrayPtr = ctx.emitBitcast(arrayMem, "i8*", "%ObjectArray*");

  const mapSizeI64 = ctx.nextTemp();
  ctx.emit(`${mapSizeI64} = zext i32 ${mapSize} to i64`);
  const dataSize = ctx.nextTemp();
  ctx.emit(`${dataSize} = mul i64 ${mapSizeI64}, 8`);
  const dataMem = ctx.emitCall("i8*", "@GC_malloc", `i64 ${dataSize}`);
  const dataPtr = ctx.emitBitcast(dataMem, "i8*", "i8**");

  const dataPtrField = ctx.nextTemp();
  ctx.emit(
    `${dataPtrField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`,
  );
  ctx.emitStore("i8*", dataMem, dataPtrField);
  const lenFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${lenFieldPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 1`,
  );
  ctx.emitStore("i32", mapSize, lenFieldPtr);
  const capFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${capFieldPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 2`,
  );
  ctx.emitStore("i32", mapSize, capFieldPtr);

  const loopLabel = ctx.nextLabel("ptrmap_entries_loop");
  const bodyLabel = ctx.nextLabel("ptrmap_entries_body");
  const endLabel = ctx.nextLabel("ptrmap_entries_end");

  const indexReg = ctx.nextTemp();
  ctx.emit(`${indexReg} = alloca i32`);
  ctx.emitStore("i32", "0", indexReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(loopLabel);
  const currentIndex = ctx.emitLoad("i32", indexReg);
  const cond = ctx.emitIcmp("slt", "i32", currentIndex, mapSize);
  ctx.emitBrCond(cond, bodyLabel, endLabel);

  ctx.emitLabel(bodyLabel);
  const keyElemPtr = ctx.nextTemp();
  ctx.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${currentIndex}`);
  const keyValue = ctx.emitLoad("i8*", keyElemPtr);
  const valueElemPtr = ctx.nextTemp();
  ctx.emit(`${valueElemPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${currentIndex}`);
  const valueValue = ctx.emitLoad("i8*", valueElemPtr);

  const entryMem = ctx.emitCall("i8*", "@GC_malloc", "i64 16");
  const entryKvPtr = ctx.emitBitcast(entryMem, "i8*", "{ i8*, i8* }*");
  const keySlot = ctx.nextTemp();
  ctx.emit(
    `${keySlot} = getelementptr inbounds { i8*, i8* }, { i8*, i8* }* ${entryKvPtr}, i32 0, i32 0`,
  );
  ctx.emitStore("i8*", keyValue, keySlot);
  const valueSlot = ctx.nextTemp();
  ctx.emit(
    `${valueSlot} = getelementptr inbounds { i8*, i8* }, { i8*, i8* }* ${entryKvPtr}, i32 0, i32 1`,
  );
  ctx.emitStore("i8*", valueValue, valueSlot);

  const entrySlot = ctx.nextTemp();
  ctx.emit(`${entrySlot} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${currentIndex}`);
  ctx.emitStore("i8*", entryMem, entrySlot);

  const nextIndex = ctx.nextTemp();
  ctx.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
  ctx.emitStore("i32", nextIndex, indexReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(endLabel);

  ctx.setVariableType(arrayPtr, "%ObjectArray*");
  return arrayPtr;
}

export function generatePointerMapKeys(ctx: IGeneratorContext, mapPtr: string): string {
  const keysFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`,
  );
  const keysPtr = ctx.emitLoad("i8**", keysFieldPtr);

  const sizeFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
  );
  const mapSize = ctx.emitLoad("i32", sizeFieldPtr);

  const arrayMem = ctx.emitCall("i8*", "@GC_malloc", "i64 24");
  const arrayPtr = ctx.emitBitcast(arrayMem, "i8*", "%ObjectArray*");

  const mapSizeI64 = ctx.nextTemp();
  ctx.emit(`${mapSizeI64} = zext i32 ${mapSize} to i64`);
  const dataSize = ctx.nextTemp();
  ctx.emit(`${dataSize} = mul i64 ${mapSizeI64}, 8`);
  const dataMem = ctx.emitCall("i8*", "@GC_malloc", `i64 ${dataSize}`);

  const dataPtrField = ctx.nextTemp();
  ctx.emit(
    `${dataPtrField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`,
  );
  ctx.emitStore("i8*", dataMem, dataPtrField);
  const lenFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${lenFieldPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 1`,
  );
  ctx.emitStore("i32", mapSize, lenFieldPtr);
  const capFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${capFieldPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 2`,
  );
  ctx.emitStore("i32", mapSize, capFieldPtr);

  const dataPtr = ctx.emitBitcast(dataMem, "i8*", "i8**");

  const loopLabel = ctx.nextLabel("ptrmap_keys_loop");
  const bodyLabel = ctx.nextLabel("ptrmap_keys_body");
  const endLabel = ctx.nextLabel("ptrmap_keys_end");

  const indexReg = ctx.nextTemp();
  ctx.emit(`${indexReg} = alloca i32`);
  ctx.emitStore("i32", "0", indexReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(loopLabel);
  const currentIndex = ctx.emitLoad("i32", indexReg);
  const cond = ctx.emitIcmp("slt", "i32", currentIndex, mapSize);
  ctx.emitBrCond(cond, bodyLabel, endLabel);

  ctx.emitLabel(bodyLabel);
  const keyElemPtr = ctx.nextTemp();
  ctx.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${currentIndex}`);
  const keyVal = ctx.emitLoad("i8*", keyElemPtr);
  const destElemPtr = ctx.nextTemp();
  ctx.emit(`${destElemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${currentIndex}`);
  ctx.emitStore("i8*", keyVal, destElemPtr);

  const nextIndex = ctx.nextTemp();
  ctx.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
  ctx.emitStore("i32", nextIndex, indexReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(endLabel);

  ctx.setVariableType(arrayPtr, "%ObjectArray*");
  return arrayPtr;
}

export function generatePointerMapValues(ctx: IGeneratorContext, mapPtr: string): string {
  const valuesFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`,
  );
  const valuesPtr = ctx.emitLoad("i8**", valuesFieldPtr);

  const sizeFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
  );
  const mapSize = ctx.emitLoad("i32", sizeFieldPtr);

  const arrayMem = ctx.emitCall("i8*", "@GC_malloc", "i64 24");
  const arrayPtr = ctx.emitBitcast(arrayMem, "i8*", "%ObjectArray*");

  const mapSizeI64 = ctx.nextTemp();
  ctx.emit(`${mapSizeI64} = zext i32 ${mapSize} to i64`);
  const dataSize = ctx.nextTemp();
  ctx.emit(`${dataSize} = mul i64 ${mapSizeI64}, 8`);
  const dataMem = ctx.emitCall("i8*", "@GC_malloc", `i64 ${dataSize}`);

  const dataPtrField = ctx.nextTemp();
  ctx.emit(
    `${dataPtrField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`,
  );
  ctx.emitStore("i8*", dataMem, dataPtrField);
  const lenFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${lenFieldPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 1`,
  );
  ctx.emitStore("i32", mapSize, lenFieldPtr);
  const capFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${capFieldPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 2`,
  );
  ctx.emitStore("i32", mapSize, capFieldPtr);

  const dataPtr = ctx.emitBitcast(dataMem, "i8*", "i8**");

  const loopLabel = ctx.nextLabel("ptrmap_values_loop");
  const bodyLabel = ctx.nextLabel("ptrmap_values_body");
  const endLabel = ctx.nextLabel("ptrmap_values_end");

  const indexReg = ctx.nextTemp();
  ctx.emit(`${indexReg} = alloca i32`);
  ctx.emitStore("i32", "0", indexReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(loopLabel);
  const currentIndex = ctx.emitLoad("i32", indexReg);
  const cond = ctx.emitIcmp("slt", "i32", currentIndex, mapSize);
  ctx.emitBrCond(cond, bodyLabel, endLabel);

  ctx.emitLabel(bodyLabel);
  const valueElemPtr = ctx.nextTemp();
  ctx.emit(`${valueElemPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${currentIndex}`);
  const valueVal = ctx.emitLoad("i8*", valueElemPtr);
  const destElemPtr = ctx.nextTemp();
  ctx.emit(`${destElemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${currentIndex}`);
  ctx.emitStore("i8*", valueVal, destElemPtr);

  const nextIndex = ctx.nextTemp();
  ctx.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
  ctx.emitStore("i32", nextIndex, indexReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(endLabel);

  ctx.setVariableType(arrayPtr, "%ObjectArray*");
  return arrayPtr;
}
