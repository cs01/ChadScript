import { IGeneratorContext } from "../../../infrastructure/generator-context.js";

const PTR_SIZE = 8;

export function generateEmptyStringMap(ctx: IGeneratorContext): string {
  const sizeofPtr = ctx.nextTemp();
  ctx.emit(`${sizeofPtr} = getelementptr %StringMap, %StringMap* null, i32 1`);
  const structSize = ctx.nextTemp();
  ctx.emit(`${structSize} = ptrtoint %StringMap* ${sizeofPtr} to i64`);
  const mapMem = ctx.emitCall("i8*", "@GC_malloc", `i64 ${structSize}`);
  const mapPtr = ctx.emitBitcast(mapMem, "i8*", "%StringMap*");

  const initialCapacity = 16;

  const keysSize = initialCapacity * PTR_SIZE;
  const keysMem = ctx.emitCall("i8*", "@GC_malloc", `i64 ${keysSize}`);
  const keysPtr = ctx.emitBitcast(keysMem, "i8*", "i8**");

  const valuesMem = ctx.emitCall("i8*", "@GC_malloc", `i64 ${keysSize}`);
  const valuesPtr = ctx.emitBitcast(valuesMem, "i8*", "i8**");

  const keysFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`,
  );
  ctx.emitStore("i8**", keysPtr, keysFieldPtr);

  const valuesFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`,
  );
  ctx.emitStore("i8**", valuesPtr, valuesFieldPtr);

  const sizeFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
  );
  ctx.emitStore("i32", "0", sizeFieldPtr);

  const capacityFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`,
  );
  ctx.emitStore("i32", `${initialCapacity}`, capacityFieldPtr);

  return mapPtr;
}

export function generateStringMapSet(
  ctx: IGeneratorContext,
  mapPtr: string,
  keyValue: string,
  valueValue: string,
  declaredValueType?: string,
): string {
  let valueType = ctx.getVariableType(valueValue);
  if (!valueType && declaredValueType === "number") {
    valueType = "double";
  }
  if (!valueType && valueValue !== "null") {
    const fc = valueValue.charAt(0);
    if ((fc >= "0" && fc <= "9") || fc === "-" || fc === ".") {
      valueType = "double";
    }
  }
  let storedValue = valueValue;
  if (valueType === "double") {
    const asI64 = ctx.nextTemp();
    ctx.emit(`${asI64} = bitcast double ${valueValue} to i64`);
    storedValue = ctx.nextTemp();
    ctx.emit(`${storedValue} = inttoptr i64 ${asI64} to i8*`);
  } else if (valueType === "i64") {
    const asDouble = ctx.nextTemp();
    ctx.emit(`${asDouble} = sitofp i64 ${valueValue} to double`);
    const asI64Bits = ctx.nextTemp();
    ctx.emit(`${asI64Bits} = bitcast double ${asDouble} to i64`);
    storedValue = ctx.nextTemp();
    ctx.emit(`${storedValue} = inttoptr i64 ${asI64Bits} to i8*`);
  } else if (valueType === "i1") {
    const asDouble = ctx.nextTemp();
    ctx.emit(`${asDouble} = uitofp i1 ${valueValue} to double`);
    const asI64Bits = ctx.nextTemp();
    ctx.emit(`${asI64Bits} = bitcast double ${asDouble} to i64`);
    storedValue = ctx.nextTemp();
    ctx.emit(`${storedValue} = inttoptr i64 ${asI64Bits} to i8*`);
  }

  const keysFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`,
  );
  const valuesFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`,
  );
  const sizeFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
  );
  const capacityFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`,
  );

  const currentSize = ctx.emitLoad("i32", sizeFieldPtr);
  const currentCapacity = ctx.emitLoad("i32", capacityFieldPtr);

  const resizeCheckLabel = ctx.nextLabel("strmap_set_resize_check");
  const resizeLabel = ctx.nextLabel("strmap_set_resize");
  const probeLabel = ctx.nextLabel("strmap_set_probe");
  const probeBodyLabel = ctx.nextLabel("strmap_set_probe_body");
  const foundLabel = ctx.nextLabel("strmap_set_found");
  const insertLabel = ctx.nextLabel("strmap_set_insert");
  const endLabel = ctx.nextLabel("strmap_set_end");

  const sizeP1 = ctx.nextTemp();
  ctx.emit(`${sizeP1} = add i32 ${currentSize}, 1`);
  const sizeTimes10 = ctx.nextTemp();
  ctx.emit(`${sizeTimes10} = mul i32 ${sizeP1}, 10`);
  const capTimes7 = ctx.nextTemp();
  ctx.emit(`${capTimes7} = mul i32 ${currentCapacity}, 7`);
  const needsResize = ctx.emitIcmp("sge", "i32", sizeTimes10, capTimes7);
  ctx.emitBrCond(needsResize, resizeLabel, resizeCheckLabel);

  ctx.emitLabel(resizeLabel);
  const newCapacity = ctx.nextTemp();
  ctx.emit(`${newCapacity} = shl i32 ${currentCapacity}, 1`);
  const newCapI64 = ctx.nextTemp();
  ctx.emit(`${newCapI64} = zext i32 ${newCapacity} to i64`);
  const newArrSize = ctx.nextTemp();
  ctx.emit(`${newArrSize} = mul i64 ${newCapI64}, 8`);
  const newKeysMem = ctx.emitCall("i8*", "@GC_malloc", `i64 ${newArrSize}`);
  const newKeysPtr = ctx.emitBitcast(newKeysMem, "i8*", "i8**");
  const newValuesMem = ctx.emitCall("i8*", "@GC_malloc", `i64 ${newArrSize}`);
  const newValuesPtr = ctx.emitBitcast(newValuesMem, "i8*", "i8**");

  const oldKeysPtr = ctx.emitLoad("i8**", keysFieldPtr);
  const oldValuesPtr = ctx.emitLoad("i8**", valuesFieldPtr);

  ctx.emitCallVoid(
    "@__strmap_rehash",
    `i8** ${oldKeysPtr}, i8** ${oldValuesPtr}, i32 ${currentCapacity}, i8** ${newKeysPtr}, i8** ${newValuesPtr}, i32 ${newCapacity}`,
  );

  ctx.emitStore("i8**", newKeysPtr, keysFieldPtr);
  ctx.emitStore("i8**", newValuesPtr, valuesFieldPtr);
  ctx.emitStore("i32", newCapacity, capacityFieldPtr);
  ctx.emitBr(resizeCheckLabel);

  ctx.emitLabel(resizeCheckLabel);
  const keysPtr = ctx.emitLoad("i8**", keysFieldPtr);
  const valuesPtr = ctx.emitLoad("i8**", valuesFieldPtr);
  const capacity = ctx.emitLoad("i32", capacityFieldPtr);

  const hash = ctx.emitCall("i32", "@__string_hash", `i8* ${keyValue}`);
  const mask = ctx.nextTemp();
  ctx.emit(`${mask} = sub i32 ${capacity}, 1`);
  const startSlot = ctx.nextTemp();
  ctx.emit(`${startSlot} = and i32 ${hash}, ${mask}`);

  const slotReg = ctx.nextTemp();
  ctx.emit(`${slotReg} = alloca i32`);
  ctx.emitStore("i32", startSlot, slotReg);
  ctx.emitBr(probeLabel);

  ctx.emitLabel(probeLabel);
  const slot = ctx.emitLoad("i32", slotReg);
  const keyElemPtr = ctx.nextTemp();
  ctx.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${slot}`);
  const keyAtSlot = ctx.emitLoad("i8*", keyElemPtr);
  const isNull = ctx.emitIcmp("eq", "i8*", keyAtSlot, "null");
  ctx.emitBrCond(isNull, insertLabel, probeBodyLabel);

  ctx.emitLabel(probeBodyLabel);
  const cmpResult = ctx.emitCall("i32", "@strcmp", `i8* ${keyAtSlot}, i8* ${keyValue}`);
  const keyMatch = ctx.emitIcmp("eq", "i32", cmpResult, "0");
  ctx.emitBrCond(keyMatch, foundLabel, `${probeLabel}_next`);

  ctx.emitLabel(foundLabel);
  const valElemPtrFound = ctx.nextTemp();
  ctx.emit(`${valElemPtrFound} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${slot}`);
  ctx.emitStore("i8*", storedValue, valElemPtrFound);
  ctx.emitBr(endLabel);

  ctx.emitLabel(`${probeLabel}_next`);
  const nextSlot = ctx.nextTemp();
  ctx.emit(`${nextSlot} = add i32 ${slot}, 1`);
  const wrappedSlot = ctx.nextTemp();
  ctx.emit(`${wrappedSlot} = and i32 ${nextSlot}, ${mask}`);
  ctx.emitStore("i32", wrappedSlot, slotReg);
  ctx.emitBr(probeLabel);

  ctx.emitLabel(insertLabel);
  const insertSlot = ctx.emitLoad("i32", slotReg);
  const keyInsertPtr = ctx.nextTemp();
  ctx.emit(`${keyInsertPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${insertSlot}`);
  ctx.emitStore("i8*", keyValue, keyInsertPtr);
  const valInsertPtr = ctx.nextTemp();
  ctx.emit(`${valInsertPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${insertSlot}`);
  ctx.emitStore("i8*", storedValue, valInsertPtr);

  const newSize = ctx.emitLoad("i32", sizeFieldPtr);
  const incSize = ctx.nextTemp();
  ctx.emit(`${incSize} = add i32 ${newSize}, 1`);
  ctx.emitStore("i32", incSize, sizeFieldPtr);
  ctx.emitBr(endLabel);

  ctx.emitLabel(endLabel);

  return mapPtr;
}

export function generateStringMapGet(
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
  const capacityFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`,
  );
  const capacity = ctx.emitLoad("i32", capacityFieldPtr);

  const resultReg = ctx.nextTemp();
  ctx.emit(`${resultReg} = alloca i8*`);
  ctx.emitStore("i8*", "null", resultReg);

  const hash = ctx.emitCall("i32", "@__string_hash", `i8* ${keyToFind}`);
  const mask = ctx.nextTemp();
  ctx.emit(`${mask} = sub i32 ${capacity}, 1`);
  const startSlot = ctx.nextTemp();
  ctx.emit(`${startSlot} = and i32 ${hash}, ${mask}`);

  const probeLabel = ctx.nextLabel("strmap_get_probe");
  const probeBodyLabel = ctx.nextLabel("strmap_get_body");
  const foundLabel = ctx.nextLabel("strmap_get_found");
  const endLabel = ctx.nextLabel("strmap_get_end");

  const slotReg = ctx.nextTemp();
  ctx.emit(`${slotReg} = alloca i32`);
  ctx.emitStore("i32", startSlot, slotReg);
  ctx.emitBr(probeLabel);

  ctx.emitLabel(probeLabel);
  const slot = ctx.emitLoad("i32", slotReg);
  const keyElemPtr = ctx.nextTemp();
  ctx.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${slot}`);
  const keyAtSlot = ctx.emitLoad("i8*", keyElemPtr);
  const isNull = ctx.emitIcmp("eq", "i8*", keyAtSlot, "null");
  ctx.emitBrCond(isNull, endLabel, probeBodyLabel);

  ctx.emitLabel(probeBodyLabel);
  const cmpResult = ctx.emitCall("i32", "@strcmp", `i8* ${keyAtSlot}, i8* ${keyToFind}`);
  const keyMatch = ctx.emitIcmp("eq", "i32", cmpResult, "0");
  ctx.emitBrCond(keyMatch, foundLabel, `${probeLabel}_next`);

  ctx.emitLabel(foundLabel);
  const valueElemPtr = ctx.nextTemp();
  ctx.emit(`${valueElemPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${slot}`);
  const foundValue = ctx.emitLoad("i8*", valueElemPtr);
  ctx.emitStore("i8*", foundValue, resultReg);
  ctx.emitBr(endLabel);

  ctx.emitLabel(`${probeLabel}_next`);
  const nextSlot = ctx.nextTemp();
  ctx.emit(`${nextSlot} = add i32 ${slot}, 1`);
  const wrappedSlot = ctx.nextTemp();
  ctx.emit(`${wrappedSlot} = and i32 ${nextSlot}, ${mask}`);
  ctx.emitStore("i32", wrappedSlot, slotReg);
  ctx.emitBr(probeLabel);

  ctx.emitLabel(endLabel);
  const result = ctx.emitLoad("i8*", resultReg);

  return result;
}

export function generateStringMapHas(
  ctx: IGeneratorContext,
  mapPtr: string,
  keyToFind: string,
): string {
  const keysFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`,
  );
  const keysPtr = ctx.emitLoad("i8**", keysFieldPtr);
  const capacityFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`,
  );
  const capacity = ctx.emitLoad("i32", capacityFieldPtr);

  const resultReg = ctx.nextTemp();
  ctx.emit(`${resultReg} = alloca double`);
  ctx.emitStore("double", "0.0", resultReg);

  const hash = ctx.emitCall("i32", "@__string_hash", `i8* ${keyToFind}`);
  const mask = ctx.nextTemp();
  ctx.emit(`${mask} = sub i32 ${capacity}, 1`);
  const startSlot = ctx.nextTemp();
  ctx.emit(`${startSlot} = and i32 ${hash}, ${mask}`);

  const probeLabel = ctx.nextLabel("strmap_has_probe");
  const probeBodyLabel = ctx.nextLabel("strmap_has_body");
  const foundLabel = ctx.nextLabel("strmap_has_found");
  const endLabel = ctx.nextLabel("strmap_has_end");

  const slotReg = ctx.nextTemp();
  ctx.emit(`${slotReg} = alloca i32`);
  ctx.emitStore("i32", startSlot, slotReg);
  ctx.emitBr(probeLabel);

  ctx.emitLabel(probeLabel);
  const slot = ctx.emitLoad("i32", slotReg);
  const keyElemPtr = ctx.nextTemp();
  ctx.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${slot}`);
  const keyAtSlot = ctx.emitLoad("i8*", keyElemPtr);
  const isNull = ctx.emitIcmp("eq", "i8*", keyAtSlot, "null");
  ctx.emitBrCond(isNull, endLabel, probeBodyLabel);

  ctx.emitLabel(probeBodyLabel);
  const cmpResult = ctx.emitCall("i32", "@strcmp", `i8* ${keyAtSlot}, i8* ${keyToFind}`);
  const keyMatch = ctx.emitIcmp("eq", "i32", cmpResult, "0");
  ctx.emitBrCond(keyMatch, foundLabel, `${probeLabel}_next`);

  ctx.emitLabel(foundLabel);
  ctx.emitStore("double", "1.0", resultReg);
  ctx.emitBr(endLabel);

  ctx.emitLabel(`${probeLabel}_next`);
  const nextSlot = ctx.nextTemp();
  ctx.emit(`${nextSlot} = add i32 ${slot}, 1`);
  const wrappedSlot = ctx.nextTemp();
  ctx.emit(`${wrappedSlot} = and i32 ${nextSlot}, ${mask}`);
  ctx.emitStore("i32", wrappedSlot, slotReg);
  ctx.emitBr(probeLabel);

  ctx.emitLabel(endLabel);
  const result = ctx.emitLoad("double", resultReg);
  ctx.setVariableType(result, "double");
  return result;
}

export function generateStringMapSize(ctx: IGeneratorContext, mapPtr: string): string {
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

export function generateStringMapClear(ctx: IGeneratorContext, mapPtr: string): string {
  const keysFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`,
  );
  const valuesFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`,
  );
  const capacityFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`,
  );
  const capacity = ctx.emitLoad("i32", capacityFieldPtr);

  const capI64 = ctx.nextTemp();
  ctx.emit(`${capI64} = zext i32 ${capacity} to i64`);
  const arrSize = ctx.nextTemp();
  ctx.emit(`${arrSize} = mul i64 ${capI64}, 8`);

  const newKeysMem = ctx.emitCall("i8*", "@GC_malloc", `i64 ${arrSize}`);
  const newKeysPtr = ctx.emitBitcast(newKeysMem, "i8*", "i8**");
  ctx.emitStore("i8**", newKeysPtr, keysFieldPtr);

  const newValuesMem = ctx.emitCall("i8*", "@GC_malloc", `i64 ${arrSize}`);
  const newValuesPtr = ctx.emitBitcast(newValuesMem, "i8*", "i8**");
  ctx.emitStore("i8**", newValuesPtr, valuesFieldPtr);

  const sizeFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
  );
  ctx.emitStore("i32", "0", sizeFieldPtr);
  return "0.0";
}

export function generateStringMapDelete(
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
  const capacityFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`,
  );
  const capacity = ctx.emitLoad("i32", capacityFieldPtr);

  const resultReg = ctx.nextTemp();
  ctx.emit(`${resultReg} = alloca double`);
  ctx.emitStore("double", "0.0", resultReg);

  const hash = ctx.emitCall("i32", "@__string_hash", `i8* ${keyToFind}`);
  const mask = ctx.nextTemp();
  ctx.emit(`${mask} = sub i32 ${capacity}, 1`);
  const startSlot = ctx.nextTemp();
  ctx.emit(`${startSlot} = and i32 ${hash}, ${mask}`);

  const probeLabel = ctx.nextLabel("strmap_del_probe");
  const probeBodyLabel = ctx.nextLabel("strmap_del_body");
  const foundLabel = ctx.nextLabel("strmap_del_found");
  const rehashLabel = ctx.nextLabel("strmap_del_rehash");
  const rehashBodyLabel = ctx.nextLabel("strmap_del_rehash_body");
  const rehashProbeLabel = ctx.nextLabel("strmap_del_rehash_probe");
  const rehashPlaceLabel = ctx.nextLabel("strmap_del_rehash_place");
  const endLabel = ctx.nextLabel("strmap_del_end");

  const slotReg = ctx.nextTemp();
  ctx.emit(`${slotReg} = alloca i32`);
  const rehashIdx = ctx.nextTemp();
  ctx.emit(`${rehashIdx} = alloca i32`);
  const riSlotReg = ctx.nextTemp();
  ctx.emit(`${riSlotReg} = alloca i32`);
  ctx.emitStore("i32", startSlot, slotReg);
  ctx.emitBr(probeLabel);

  ctx.emitLabel(probeLabel);
  const slot = ctx.emitLoad("i32", slotReg);
  const keyElemPtr = ctx.nextTemp();
  ctx.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${slot}`);
  const keyAtSlot = ctx.emitLoad("i8*", keyElemPtr);
  const isNull = ctx.emitIcmp("eq", "i8*", keyAtSlot, "null");
  ctx.emitBrCond(isNull, endLabel, probeBodyLabel);

  ctx.emitLabel(probeBodyLabel);
  const cmpResult = ctx.emitCall("i32", "@strcmp", `i8* ${keyAtSlot}, i8* ${keyToFind}`);
  const keyMatch = ctx.emitIcmp("eq", "i32", cmpResult, "0");
  ctx.emitBrCond(keyMatch, foundLabel, `${probeLabel}_next`);

  ctx.emitLabel(`${probeLabel}_next`);
  const nextSlotDel = ctx.nextTemp();
  ctx.emit(`${nextSlotDel} = add i32 ${slot}, 1`);
  const wrappedSlotDel = ctx.nextTemp();
  ctx.emit(`${wrappedSlotDel} = and i32 ${nextSlotDel}, ${mask}`);
  ctx.emitStore("i32", wrappedSlotDel, slotReg);
  ctx.emitBr(probeLabel);

  ctx.emitLabel(foundLabel);
  ctx.emitStore("double", "1.0", resultReg);
  const foundSlot = ctx.emitLoad("i32", slotReg);
  const foundKeyPtr = ctx.nextTemp();
  ctx.emit(`${foundKeyPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${foundSlot}`);
  ctx.emitStore("i8*", "null", foundKeyPtr);
  const foundValPtr = ctx.nextTemp();
  ctx.emit(`${foundValPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${foundSlot}`);
  ctx.emitStore("i8*", "null", foundValPtr);
  const curSize = ctx.emitLoad("i32", sizeFieldPtr);
  const decSize = ctx.nextTemp();
  ctx.emit(`${decSize} = sub i32 ${curSize}, 1`);
  ctx.emitStore("i32", decSize, sizeFieldPtr);

  const nextAfterFound = ctx.nextTemp();
  ctx.emit(`${nextAfterFound} = add i32 ${foundSlot}, 1`);
  const wrappedNext = ctx.nextTemp();
  ctx.emit(`${wrappedNext} = and i32 ${nextAfterFound}, ${mask}`);
  ctx.emitStore("i32", wrappedNext, rehashIdx);
  ctx.emitBr(rehashLabel);

  ctx.emitLabel(rehashLabel);
  const ri = ctx.emitLoad("i32", rehashIdx);
  const riKeyPtr = ctx.nextTemp();
  ctx.emit(`${riKeyPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${ri}`);
  const riKey = ctx.emitLoad("i8*", riKeyPtr);
  const riIsNull = ctx.emitIcmp("eq", "i8*", riKey, "null");
  ctx.emitBrCond(riIsNull, endLabel, rehashBodyLabel);

  ctx.emitLabel(rehashBodyLabel);
  const riHash = ctx.emitCall("i32", "@__string_hash", `i8* ${riKey}`);
  const riDesired = ctx.nextTemp();
  ctx.emit(`${riDesired} = and i32 ${riHash}, ${mask}`);
  ctx.emitStore("i8*", "null", riKeyPtr);
  const riValPtr = ctx.nextTemp();
  ctx.emit(`${riValPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${ri}`);
  const riVal = ctx.emitLoad("i8*", riValPtr);
  ctx.emitStore("i8*", "null", riValPtr);
  ctx.emitStore("i32", riDesired, riSlotReg);
  ctx.emitBr(rehashProbeLabel);

  ctx.emitLabel(rehashProbeLabel);
  const riSlot = ctx.emitLoad("i32", riSlotReg);
  const riSlotKeyPtr = ctx.nextTemp();
  ctx.emit(`${riSlotKeyPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${riSlot}`);
  const riSlotKey = ctx.emitLoad("i8*", riSlotKeyPtr);
  const riSlotEmpty = ctx.emitIcmp("eq", "i8*", riSlotKey, "null");
  ctx.emitBrCond(riSlotEmpty, rehashPlaceLabel, `${rehashProbeLabel}_next`);

  ctx.emitLabel(`${rehashProbeLabel}_next`);
  const riNextSlot = ctx.nextTemp();
  ctx.emit(`${riNextSlot} = add i32 ${riSlot}, 1`);
  const riWrapped = ctx.nextTemp();
  ctx.emit(`${riWrapped} = and i32 ${riNextSlot}, ${mask}`);
  ctx.emitStore("i32", riWrapped, riSlotReg);
  ctx.emitBr(rehashProbeLabel);

  ctx.emitLabel(rehashPlaceLabel);
  const placeSlot = ctx.emitLoad("i32", riSlotReg);
  const placeKeyPtr = ctx.nextTemp();
  ctx.emit(`${placeKeyPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${placeSlot}`);
  ctx.emitStore("i8*", riKey, placeKeyPtr);
  const placeValPtr = ctx.nextTemp();
  ctx.emit(`${placeValPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${placeSlot}`);
  ctx.emitStore("i8*", riVal, placeValPtr);

  const riNext = ctx.nextTemp();
  ctx.emit(`${riNext} = add i32 ${ri}, 1`);
  const riNextWrapped = ctx.nextTemp();
  ctx.emit(`${riNextWrapped} = and i32 ${riNext}, ${mask}`);
  ctx.emitStore("i32", riNextWrapped, rehashIdx);
  ctx.emitBr(rehashLabel);

  ctx.emitLabel(endLabel);
  const result = ctx.emitLoad("double", resultReg);
  ctx.setVariableType(result, "double");
  return result;
}

export function generateStringMapEntries(ctx: IGeneratorContext, mapPtr: string): string {
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

  const capacityFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`,
  );
  const mapCapacity = ctx.emitLoad("i32", capacityFieldPtr);

  const arrayMem = ctx.emitCall("i8*", "@GC_malloc", "i64 24");
  const arrayPtr = ctx.emitBitcast(arrayMem, "i8*", "%ObjectArray*");

  const mapSizeI64 = ctx.nextTemp();
  ctx.emit(`${mapSizeI64} = zext i32 ${mapSize} to i64`);
  const dataSize = ctx.nextTemp();
  ctx.emit(`${dataSize} = mul i64 ${mapSizeI64}, 8`);
  const dataMem = ctx.emitCall("i8*", "@GC_malloc", `i64 ${dataSize}`);
  const dataPtr = ctx.emitBitcast(dataMem, "i8*", "i8**");

  const dataFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${dataFieldPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`,
  );
  const dataCast = ctx.emitBitcast(dataPtr, "i8**", "i8*");
  ctx.emitStore("i8*", dataCast, dataFieldPtr);
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

  const loopLabel = ctx.nextLabel("strmap_entries_loop");
  const bodyLabel = ctx.nextLabel("strmap_entries_body");
  const skipLabel = ctx.nextLabel("strmap_entries_skip");
  const endLabel = ctx.nextLabel("strmap_entries_end");

  const indexReg = ctx.nextTemp();
  ctx.emit(`${indexReg} = alloca i32`);
  ctx.emitStore("i32", "0", indexReg);
  const outIdxReg = ctx.nextTemp();
  ctx.emit(`${outIdxReg} = alloca i32`);
  ctx.emitStore("i32", "0", outIdxReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(loopLabel);
  const currentIndex = ctx.emitLoad("i32", indexReg);
  const cond = ctx.emitIcmp("slt", "i32", currentIndex, mapCapacity);
  ctx.emitBrCond(cond, bodyLabel, endLabel);

  ctx.emitLabel(bodyLabel);
  const keyElemPtr = ctx.nextTemp();
  ctx.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${currentIndex}`);
  const keyValue = ctx.emitLoad("i8*", keyElemPtr);
  const keyIsNull = ctx.emitIcmp("eq", "i8*", keyValue, "null");
  ctx.emitBrCond(keyIsNull, skipLabel, `${bodyLabel}_store`);

  ctx.emitLabel(`${bodyLabel}_store`);
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

  const outIdx = ctx.emitLoad("i32", outIdxReg);
  const entrySlot = ctx.nextTemp();
  ctx.emit(`${entrySlot} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${outIdx}`);
  ctx.emitStore("i8*", entryMem, entrySlot);
  const nextOut = ctx.nextTemp();
  ctx.emit(`${nextOut} = add i32 ${outIdx}, 1`);
  ctx.emitStore("i32", nextOut, outIdxReg);
  ctx.emitBr(skipLabel);

  ctx.emitLabel(skipLabel);
  const nextIndex = ctx.nextTemp();
  ctx.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
  ctx.emitStore("i32", nextIndex, indexReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(endLabel);

  return arrayPtr;
}

export function generateStringMapValues(ctx: IGeneratorContext, mapPtr: string): string {
  const valuesFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`,
  );
  const valuesPtr = ctx.emitLoad("i8**", valuesFieldPtr);

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

  const capacityFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`,
  );
  const mapCapacity = ctx.emitLoad("i32", capacityFieldPtr);

  const arrayMem = ctx.emitCall("i8*", "@GC_malloc", "i64 24");
  const arrayPtr = ctx.emitBitcast(arrayMem, "i8*", "%Array*");

  const mapSizeI64 = ctx.nextTemp();
  ctx.emit(`${mapSizeI64} = zext i32 ${mapSize} to i64`);
  const dataSize = ctx.nextTemp();
  ctx.emit(`${dataSize} = mul i64 ${mapSizeI64}, 8`);
  const dataMem = ctx.emitCall("i8*", "@GC_malloc", `i64 ${dataSize}`);
  const dataPtr = ctx.emitBitcast(dataMem, "i8*", "i8**");

  const lenFieldPtr = ctx.nextTemp();
  ctx.emit(`${lenFieldPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  ctx.emitStore("i32", mapSize, lenFieldPtr);
  const capFieldPtr = ctx.nextTemp();
  ctx.emit(`${capFieldPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  ctx.emitStore("i32", mapSize, capFieldPtr);
  const dataFieldPtr = ctx.nextTemp();
  ctx.emit(`${dataFieldPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
  const dataCast = ctx.emitBitcast(dataPtr, "i8**", "double*");
  ctx.emitStore("double*", dataCast, dataFieldPtr);

  const loopLabel = ctx.nextLabel("strmap_values_loop");
  const bodyLabel = ctx.nextLabel("strmap_values_body");
  const skipLabel = ctx.nextLabel("strmap_values_skip");
  const endLabel = ctx.nextLabel("strmap_values_end");

  const indexReg = ctx.nextTemp();
  ctx.emit(`${indexReg} = alloca i32`);
  ctx.emitStore("i32", "0", indexReg);
  const outIdxReg = ctx.nextTemp();
  ctx.emit(`${outIdxReg} = alloca i32`);
  ctx.emitStore("i32", "0", outIdxReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(loopLabel);
  const currentIndex = ctx.emitLoad("i32", indexReg);
  const cond = ctx.emitIcmp("slt", "i32", currentIndex, mapCapacity);
  ctx.emitBrCond(cond, bodyLabel, endLabel);

  ctx.emitLabel(bodyLabel);
  const keyElemPtr = ctx.nextTemp();
  ctx.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${currentIndex}`);
  const keyValue = ctx.emitLoad("i8*", keyElemPtr);
  const keyIsNull = ctx.emitIcmp("eq", "i8*", keyValue, "null");
  ctx.emitBrCond(keyIsNull, skipLabel, `${bodyLabel}_store`);

  ctx.emitLabel(`${bodyLabel}_store`);
  const valueElemPtr = ctx.nextTemp();
  ctx.emit(`${valueElemPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${currentIndex}`);
  const valueValue = ctx.emitLoad("i8*", valueElemPtr);

  const outIdx = ctx.emitLoad("i32", outIdxReg);
  const valueSlot = ctx.nextTemp();
  ctx.emit(`${valueSlot} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${outIdx}`);
  ctx.emitStore("i8*", valueValue, valueSlot);
  const nextOut = ctx.nextTemp();
  ctx.emit(`${nextOut} = add i32 ${outIdx}, 1`);
  ctx.emitStore("i32", nextOut, outIdxReg);
  ctx.emitBr(skipLabel);

  ctx.emitLabel(skipLabel);
  const nextIndex = ctx.nextTemp();
  ctx.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
  ctx.emitStore("i32", nextIndex, indexReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(endLabel);

  return arrayPtr;
}

export function generateStringMapKeys(ctx: IGeneratorContext, mapPtr: string): string {
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

  const capacityFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`,
  );
  const mapCapacity = ctx.emitLoad("i32", capacityFieldPtr);

  const arrayMem = ctx.emitCall("i8*", "@GC_malloc", "i64 24");
  const arrayPtr = ctx.emitBitcast(arrayMem, "i8*", "%StringArray*");

  const mapSizeI64 = ctx.nextTemp();
  ctx.emit(`${mapSizeI64} = zext i32 ${mapSize} to i64`);
  const dataSize = ctx.nextTemp();
  ctx.emit(`${dataSize} = mul i64 ${mapSizeI64}, 8`);
  const dataMem = ctx.emitCall("i8*", "@GC_malloc", `i64 ${dataSize}`);
  const dataPtr = ctx.emitBitcast(dataMem, "i8*", "i8**");

  const dataPtrField = ctx.nextTemp();
  ctx.emit(
    `${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
  );
  ctx.emitStore("i8**", dataPtr, dataPtrField);
  const lenFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${lenFieldPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`,
  );
  ctx.emitStore("i32", mapSize, lenFieldPtr);
  const capFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${capFieldPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 2`,
  );
  ctx.emitStore("i32", mapSize, capFieldPtr);

  const loopLabel = ctx.nextLabel("strmap_keys_loop");
  const bodyLabel = ctx.nextLabel("strmap_keys_body");
  const skipLabel = ctx.nextLabel("strmap_keys_skip");
  const endLabel = ctx.nextLabel("strmap_keys_end");

  const indexReg = ctx.nextTemp();
  ctx.emit(`${indexReg} = alloca i32`);
  ctx.emitStore("i32", "0", indexReg);
  const outIdxReg = ctx.nextTemp();
  ctx.emit(`${outIdxReg} = alloca i32`);
  ctx.emitStore("i32", "0", outIdxReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(loopLabel);
  const currentIndex = ctx.emitLoad("i32", indexReg);
  const cond = ctx.emitIcmp("slt", "i32", currentIndex, mapCapacity);
  ctx.emitBrCond(cond, bodyLabel, endLabel);

  ctx.emitLabel(bodyLabel);
  const keyElemPtr = ctx.nextTemp();
  ctx.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${currentIndex}`);
  const keyVal = ctx.emitLoad("i8*", keyElemPtr);
  const keyIsNull = ctx.emitIcmp("eq", "i8*", keyVal, "null");
  ctx.emitBrCond(keyIsNull, skipLabel, `${bodyLabel}_store`);

  ctx.emitLabel(`${bodyLabel}_store`);
  const outIdx = ctx.emitLoad("i32", outIdxReg);
  const destElemPtr = ctx.nextTemp();
  ctx.emit(`${destElemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${outIdx}`);
  ctx.emitStore("i8*", keyVal, destElemPtr);
  const nextOut = ctx.nextTemp();
  ctx.emit(`${nextOut} = add i32 ${outIdx}, 1`);
  ctx.emitStore("i32", nextOut, outIdxReg);
  ctx.emitBr(skipLabel);

  ctx.emitLabel(skipLabel);
  const nextIndex = ctx.nextTemp();
  ctx.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
  ctx.emitStore("i32", nextIndex, indexReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(endLabel);

  return arrayPtr;
}
