import { Expression, MethodCallNode, MapEntry, MapNode } from "../../../../ast/types.js";
import { IGeneratorContext } from "../../../infrastructure/generator-context.js";
import {
  emitAdd,
  emitSub,
  emitMul,
  emitZext,
  emitSitofp,
  emitFcmp,
  emitAlloca,
  emitPtrtoint,
} from "../../../infrastructure/ir-builders.js";

const DOUBLE_SIZE = 8;

export function generateMapLiteral(
  ctx: IGeneratorContext,
  expr: Expression,
  params: string[],
): string {
  const mapExpr = expr as MapNode;
  if (mapExpr.type !== "map") {
    return ctx.emitError("Expected map literal");
  }

  const entries = mapExpr.entries || [];

  const sizeofPtr = ctx.nextTemp();
  ctx.emit(`${sizeofPtr} = getelementptr %Map, %Map* null, i32 1`);
  const structSize = emitPtrtoint(ctx, sizeofPtr, "%Map*", "i64");
  const mapMem = ctx.emitCall("i8*", "@GC_malloc", `i64 ${structSize}`);
  const mapPtr = ctx.emitBitcast(mapMem, "i8*", "%Map*");

  const initialCapacity = entries.length > 4 ? entries.length : 4;

  const keysCapI64 = emitZext(ctx, `${initialCapacity}`, "i32", "i64");
  const keysSize = emitMul(ctx, "i64", keysCapI64, `${DOUBLE_SIZE}`);
  const keysMem = ctx.emitCall("i8*", "@cs_arena_alloc", `i64 ${keysSize}`);
  const keysPtr = ctx.emitBitcast(keysMem, "i8*", "double*");

  const valuesCapI64 = emitZext(ctx, `${initialCapacity}`, "i32", "i64");
  const valuesSize = emitMul(ctx, "i64", valuesCapI64, `${DOUBLE_SIZE}`);
  const valuesMem = ctx.emitCall("i8*", "@cs_arena_alloc", `i64 ${valuesSize}`);
  const valuesPtr = ctx.emitBitcast(valuesMem, "i8*", "double*");

  const keysFieldPtr = ctx.nextTemp();
  ctx.emit(`${keysFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 0`);
  ctx.emitStore("double*", keysPtr, keysFieldPtr);

  const valuesFieldPtr = ctx.nextTemp();
  ctx.emit(`${valuesFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 1`);
  ctx.emitStore("double*", valuesPtr, valuesFieldPtr);

  const sizeFieldPtr = ctx.nextTemp();
  ctx.emit(`${sizeFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 2`);
  ctx.emitStore("i32", `${entries.length}`, sizeFieldPtr);

  const capacityFieldPtr = ctx.nextTemp();
  ctx.emit(`${capacityFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 3`);
  ctx.emitStore("i32", `${initialCapacity}`, capacityFieldPtr);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as MapEntry;
    const keyValue = ctx.generateExpression(entry.key, params);
    const valueValue = ctx.generateExpression(entry.value, params);

    const keyElemPtr = ctx.nextTemp();
    ctx.emit(`${keyElemPtr} = getelementptr inbounds double, double* ${keysPtr}, i32 ${i}`);
    ctx.emitStore("double", ctx.ensureDouble(keyValue), keyElemPtr);

    const valueElemPtr = ctx.nextTemp();
    ctx.emit(`${valueElemPtr} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${i}`);
    ctx.emitStore("double", ctx.ensureDouble(valueValue), valueElemPtr);
  }

  return mapPtr;
}

export function generateMapSet(
  ctx: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length !== 2) {
    return ctx.emitError("Map.set() requires exactly 2 arguments", expr.loc);
  }

  const mapPtr = ctx.generateExpression(expr.object, params);
  const keyValue = ctx.generateExpression(expr.args[0], params);
  const valueValue = ctx.generateExpression(expr.args[1], params);

  const keysFieldPtr = ctx.nextTemp();
  ctx.emit(`${keysFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 0`);
  const keysPtr = ctx.emitLoad("double*", keysFieldPtr);

  const valuesFieldPtr = ctx.nextTemp();
  ctx.emit(`${valuesFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 1`);
  const valuesPtr = ctx.emitLoad("double*", valuesFieldPtr);

  const sizeFieldPtr = ctx.nextTemp();
  ctx.emit(`${sizeFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 2`);
  const currentSize = ctx.emitLoad("i32", sizeFieldPtr);

  const searchLoopLabel = ctx.nextLabel("map_set_search");
  const searchBodyLabel = ctx.nextLabel("map_set_body");
  const foundLabel = ctx.nextLabel("map_set_found");
  const notFoundLabel = ctx.nextLabel("map_set_notfound");
  const insertLabel = ctx.nextLabel("map_set_insert");
  const endLabel = ctx.nextLabel("map_set_end");

  const indexReg = emitAlloca(ctx, "i32");
  ctx.emitStore("i32", "0", indexReg);
  ctx.emitBr(searchLoopLabel);

  ctx.emitLabel(searchLoopLabel);
  const currentIndex = ctx.emitLoad("i32", indexReg);
  const searchCond = ctx.emitIcmp("slt", "i32", currentIndex, currentSize);
  ctx.emitBrCond(searchCond, searchBodyLabel, notFoundLabel);

  ctx.emitLabel(searchBodyLabel);
  const keyElemPtrSearch = ctx.nextTemp();
  ctx.emit(
    `${keyElemPtrSearch} = getelementptr inbounds double, double* ${keysPtr}, i32 ${currentIndex}`,
  );
  const keyAtIndex = ctx.emitLoad("double", keyElemPtrSearch);
  const dblKeyValue = ctx.ensureDouble(keyValue);
  const keyMatch = emitFcmp(ctx, "oeq", keyAtIndex, dblKeyValue);
  ctx.emitBrCond(keyMatch, foundLabel, `${searchLoopLabel}_next`);

  ctx.emitLabel(`${searchLoopLabel}_next`);
  const nextIndex = emitAdd(ctx, "i32", currentIndex, "1");
  ctx.emitStore("i32", nextIndex, indexReg);
  ctx.emitBr(searchLoopLabel);

  ctx.emitLabel(foundLabel);
  const foundIdx = ctx.emitLoad("i32", indexReg);
  const valueElemPtrFound = ctx.nextTemp();
  ctx.emit(
    `${valueElemPtrFound} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${foundIdx}`,
  );
  ctx.emitStore("double", ctx.ensureDouble(valueValue), valueElemPtrFound);
  ctx.emitBr(endLabel);

  ctx.emitLabel(notFoundLabel);
  ctx.emitBr(insertLabel);

  ctx.emitLabel(insertLabel);
  const capacityFieldPtr = ctx.nextTemp();
  ctx.emit(`${capacityFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 3`);
  const currentCapacity = ctx.emitLoad("i32", capacityFieldPtr);
  const needsResize = ctx.emitIcmp("sge", "i32", currentSize, currentCapacity);
  const resizeLabel = ctx.nextLabel("map_set_resize");
  const doInsertLabel = ctx.nextLabel("map_set_doinsert");
  ctx.emitBrCond(needsResize, resizeLabel, doInsertLabel);

  ctx.emitLabel(resizeLabel);
  const newCapacity = emitMul(ctx, "i32", currentCapacity, "2");
  const newCapI64 = emitZext(ctx, newCapacity, "i32", "i64");
  const newKeysSize = emitMul(ctx, "i64", newCapI64, `${DOUBLE_SIZE}`);
  const newKeysMem = ctx.emitCall("i8*", "@cs_arena_alloc", `i64 ${newKeysSize}`);
  const newKeysPtr = ctx.emitBitcast(newKeysMem, "i8*", "double*");
  const oldKeysI8 = ctx.emitBitcast(keysPtr, "double*", "i8*");
  const oldCapI64 = emitZext(ctx, currentCapacity, "i32", "i64");
  const oldKeysSize = emitMul(ctx, "i64", oldCapI64, `${DOUBLE_SIZE}`);
  ctx.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newKeysMem}, i8* ${oldKeysI8}, i64 ${oldKeysSize}, i1 false)`,
  );
  ctx.emitStore("double*", newKeysPtr, keysFieldPtr);
  const newValuesSize = emitMul(ctx, "i64", newCapI64, `${DOUBLE_SIZE}`);
  const newValuesMem = ctx.emitCall("i8*", "@cs_arena_alloc", `i64 ${newValuesSize}`);
  const newValuesPtr = ctx.emitBitcast(newValuesMem, "i8*", "double*");
  const oldValuesI8 = ctx.emitBitcast(valuesPtr, "double*", "i8*");
  ctx.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newValuesMem}, i8* ${oldValuesI8}, i64 ${oldKeysSize}, i1 false)`,
  );
  ctx.emitStore("double*", newValuesPtr, valuesFieldPtr);
  ctx.emitStore("i32", newCapacity, capacityFieldPtr);
  ctx.emitBr(doInsertLabel);

  ctx.emitLabel(doInsertLabel);
  const insertKeysPtr = ctx.emitLoad("double*", keysFieldPtr);
  const insertValuesPtr = ctx.emitLoad("double*", valuesFieldPtr);
  const keyElemPtr = ctx.nextTemp();
  ctx.emit(
    `${keyElemPtr} = getelementptr inbounds double, double* ${insertKeysPtr}, i32 ${currentSize}`,
  );
  ctx.emitStore("double", ctx.ensureDouble(keyValue), keyElemPtr);

  const valueElemPtr = ctx.nextTemp();
  ctx.emit(
    `${valueElemPtr} = getelementptr inbounds double, double* ${insertValuesPtr}, i32 ${currentSize}`,
  );
  ctx.emitStore("double", ctx.ensureDouble(valueValue), valueElemPtr);

  const newSize = emitAdd(ctx, "i32", currentSize, "1");
  ctx.emitStore("i32", newSize, sizeFieldPtr);
  ctx.emitBr(endLabel);

  ctx.emitLabel(endLabel);

  return mapPtr;
}

export function generateMapGet(
  ctx: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length !== 1) {
    return ctx.emitError("Map.get() requires exactly 1 argument", expr.loc);
  }

  const mapPtr = ctx.generateExpression(expr.object, params);
  const keyToFind = ctx.generateExpression(expr.args[0], params);

  const keysFieldPtr = ctx.nextTemp();
  ctx.emit(`${keysFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 0`);
  const keysPtr = ctx.emitLoad("double*", keysFieldPtr);

  const valuesFieldPtr = ctx.nextTemp();
  ctx.emit(`${valuesFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 1`);
  const valuesPtr = ctx.emitLoad("double*", valuesFieldPtr);

  const sizeFieldPtr = ctx.nextTemp();
  ctx.emit(`${sizeFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 2`);
  const mapSize = ctx.emitLoad("i32", sizeFieldPtr);

  const resultReg = emitAlloca(ctx, "double");
  ctx.emitStore("double", "0.0", resultReg);

  const loopLabel = ctx.nextLabel("map_has_loop");
  const bodyLabel = ctx.nextLabel("map_has_body");
  const foundLabel = ctx.nextLabel("map_has_found");
  const endLabel = ctx.nextLabel("map_has_end");

  const indexReg = emitAlloca(ctx, "i32");
  ctx.emitStore("i32", "0", indexReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(loopLabel);
  const currentIndex = ctx.emitLoad("i32", indexReg);
  const cond = ctx.emitIcmp("slt", "i32", currentIndex, mapSize);
  ctx.emitBrCond(cond, bodyLabel, endLabel);

  ctx.emitLabel(bodyLabel);
  const keyElemPtr = ctx.nextTemp();
  ctx.emit(
    `${keyElemPtr} = getelementptr inbounds double, double* ${keysPtr}, i32 ${currentIndex}`,
  );
  const keyValue = ctx.emitLoad("double", keyElemPtr);
  const dblKeyToFind = ctx.ensureDouble(keyToFind);
  const keyMatch = emitFcmp(ctx, "oeq", keyValue, dblKeyToFind);
  ctx.emitBrCond(keyMatch, foundLabel, `${loopLabel}_next`);

  ctx.emitLabel(foundLabel);
  const valueElemPtr = ctx.nextTemp();
  ctx.emit(
    `${valueElemPtr} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${currentIndex}`,
  );
  const foundValue = ctx.emitLoad("double", valueElemPtr);
  ctx.emitStore("double", foundValue, resultReg);
  ctx.emitBr(endLabel);

  ctx.emitLabel(`${loopLabel}_next`);
  const nextIndex = emitAdd(ctx, "i32", currentIndex, "1");
  ctx.emitStore("i32", nextIndex, indexReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(endLabel);
  const result = ctx.emitLoad("double", resultReg);
  return result;
}

export function generateMapHas(
  ctx: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length !== 1) {
    return ctx.emitError("Map.has() requires exactly 1 argument", expr.loc);
  }

  const mapPtr = ctx.generateExpression(expr.object, params);
  const keyToFind = ctx.generateExpression(expr.args[0], params);

  const keysFieldPtr = ctx.nextTemp();
  ctx.emit(`${keysFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 0`);
  const keysPtr = ctx.emitLoad("double*", keysFieldPtr);

  const sizeFieldPtr = ctx.nextTemp();
  ctx.emit(`${sizeFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 2`);
  const mapSize = ctx.emitLoad("i32", sizeFieldPtr);

  const resultReg = emitAlloca(ctx, "double");
  ctx.emitStore("double", "0.0", resultReg);

  const loopLabel = ctx.nextLabel("map_get_loop");
  const bodyLabel = ctx.nextLabel("map_get_body");
  const foundLabel = ctx.nextLabel("map_get_found");
  const endLabel = ctx.nextLabel("map_get_end");

  const indexReg = emitAlloca(ctx, "i32");
  ctx.emitStore("i32", "0", indexReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(loopLabel);
  const currentIndex = ctx.emitLoad("i32", indexReg);
  const cond = ctx.emitIcmp("slt", "i32", currentIndex, mapSize);
  ctx.emitBrCond(cond, bodyLabel, endLabel);

  ctx.emitLabel(bodyLabel);
  const keyElemPtr = ctx.nextTemp();
  ctx.emit(
    `${keyElemPtr} = getelementptr inbounds double, double* ${keysPtr}, i32 ${currentIndex}`,
  );
  const keyValue = ctx.emitLoad("double", keyElemPtr);
  const dblKeyToFind = ctx.ensureDouble(keyToFind);
  const keyMatch = emitFcmp(ctx, "oeq", keyValue, dblKeyToFind);
  ctx.emitBrCond(keyMatch, foundLabel, `${loopLabel}_next`);

  ctx.emitLabel(foundLabel);
  ctx.emitStore("double", "1.0", resultReg);
  ctx.emitBr(endLabel);

  ctx.emitLabel(`${loopLabel}_next`);
  const nextIndex = emitAdd(ctx, "i32", currentIndex, "1");
  ctx.emitStore("i32", nextIndex, indexReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(endLabel);
  const result = ctx.emitLoad("double", resultReg);
  return result;
}

export function generateMapSize(ctx: IGeneratorContext, mapPtr: string): string {
  const sizeFieldPtr = ctx.nextTemp();
  ctx.emit(`${sizeFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 2`);
  const sizeI32 = ctx.emitLoad("i32", sizeFieldPtr);
  const size = emitSitofp(ctx, sizeI32, "i32");
  return size;
}

export function generateMapClear(
  ctx: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  const mapPtr = ctx.generateExpression(expr.object, params);
  const sizeFieldPtr = ctx.nextTemp();
  ctx.emit(`${sizeFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 2`);
  ctx.emitStore("i32", "0", sizeFieldPtr);
  return "0.0";
}

export function generateMapDelete(
  ctx: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length !== 1) {
    return ctx.emitError("Map.delete() requires exactly 1 argument", expr.loc);
  }

  const mapPtr = ctx.generateExpression(expr.object, params);
  const keyToFind = ctx.generateExpression(expr.args[0], params);

  const keysFieldPtr = ctx.nextTemp();
  ctx.emit(`${keysFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 0`);
  const keysPtr = ctx.emitLoad("double*", keysFieldPtr);

  const valuesFieldPtr = ctx.nextTemp();
  ctx.emit(`${valuesFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 1`);
  const valuesPtr = ctx.emitLoad("double*", valuesFieldPtr);

  const sizeFieldPtr = ctx.nextTemp();
  ctx.emit(`${sizeFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 2`);
  const mapSize = ctx.emitLoad("i32", sizeFieldPtr);

  const resultReg = emitAlloca(ctx, "double");
  ctx.emitStore("double", "0.0", resultReg);

  const loopLabel = ctx.nextLabel("map_del_loop");
  const bodyLabel = ctx.nextLabel("map_del_body");
  const foundLabel = ctx.nextLabel("map_del_found");
  const shiftLabel = ctx.nextLabel("map_del_shift");
  const shiftBodyLabel = ctx.nextLabel("map_del_shift_body");
  const endLabel = ctx.nextLabel("map_del_end");

  const indexReg = emitAlloca(ctx, "i32");
  const shiftIdx = emitAlloca(ctx, "i32");
  ctx.emitStore("i32", "0", indexReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(loopLabel);
  const currentIndex = ctx.emitLoad("i32", indexReg);
  const cond = ctx.emitIcmp("slt", "i32", currentIndex, mapSize);
  ctx.emitBrCond(cond, bodyLabel, endLabel);

  ctx.emitLabel(bodyLabel);
  const keyElemPtr = ctx.nextTemp();
  ctx.emit(
    `${keyElemPtr} = getelementptr inbounds double, double* ${keysPtr}, i32 ${currentIndex}`,
  );
  const keyValue = ctx.emitLoad("double", keyElemPtr);
  const dblKeyToFind = ctx.ensureDouble(keyToFind);
  const keyMatch = emitFcmp(ctx, "oeq", keyValue, dblKeyToFind);
  ctx.emitBrCond(keyMatch, foundLabel, `${loopLabel}_next`);

  ctx.emitLabel(foundLabel);
  ctx.emitStore("double", "1.0", resultReg);
  const newSize = emitSub(ctx, "i32", mapSize, "1");
  ctx.emitStore("i32", newSize, sizeFieldPtr);
  const currentIndex2 = ctx.emitLoad("i32", indexReg);
  ctx.emitStore("i32", currentIndex2, shiftIdx);
  ctx.emitBr(shiftLabel);

  ctx.emitLabel(shiftLabel);
  const shiftI = ctx.emitLoad("i32", shiftIdx);
  const shiftCond = ctx.emitIcmp("slt", "i32", shiftI, newSize);
  ctx.emitBrCond(shiftCond, shiftBodyLabel, endLabel);

  ctx.emitLabel(shiftBodyLabel);
  const nextI = emitAdd(ctx, "i32", shiftI, "1");
  const nextKeyPtr = ctx.nextTemp();
  ctx.emit(`${nextKeyPtr} = getelementptr inbounds double, double* ${keysPtr}, i32 ${nextI}`);
  const nextKey = ctx.emitLoad("double", nextKeyPtr);
  const currKeyPtr = ctx.nextTemp();
  ctx.emit(`${currKeyPtr} = getelementptr inbounds double, double* ${keysPtr}, i32 ${shiftI}`);
  ctx.emitStore("double", nextKey, currKeyPtr);
  const nextValPtr = ctx.nextTemp();
  ctx.emit(`${nextValPtr} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${nextI}`);
  const nextVal = ctx.emitLoad("double", nextValPtr);
  const currValPtr = ctx.nextTemp();
  ctx.emit(`${currValPtr} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${shiftI}`);
  ctx.emitStore("double", nextVal, currValPtr);
  ctx.emitStore("i32", nextI, shiftIdx);
  ctx.emitBr(shiftLabel);

  ctx.emitLabel(`${loopLabel}_next`);
  const nextIndex = emitAdd(ctx, "i32", currentIndex, "1");
  ctx.emitStore("i32", nextIndex, indexReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(endLabel);
  const result = ctx.emitLoad("double", resultReg);

  return result;
}

export function generateMapKeys(ctx: IGeneratorContext, mapPtr: string): string {
  const keysFieldPtr = ctx.nextTemp();
  ctx.emit(`${keysFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 0`);
  const keysPtr = ctx.emitLoad("double*", keysFieldPtr);

  const sizeFieldPtr = ctx.nextTemp();
  ctx.emit(`${sizeFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 2`);
  const mapSize = ctx.emitLoad("i32", sizeFieldPtr);

  const arrayMem = ctx.emitCall("i8*", "@GC_malloc", "i64 24");
  const arrayPtr = ctx.emitBitcast(arrayMem, "i8*", "%Array*");

  const mapSizeI64 = emitZext(ctx, mapSize, "i32", "i64");
  const dataSize = emitMul(ctx, "i64", mapSizeI64, "8");
  const dataMem = ctx.emitCall("i8*", "@cs_arena_alloc", `i64 ${dataSize}`);
  const dataPtr = ctx.emitBitcast(dataMem, "i8*", "double*");

  const dataPtrField = ctx.nextTemp();
  ctx.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  ctx.emitStore("double*", dataPtr, dataPtrField);
  const lenFieldPtr = ctx.nextTemp();
  ctx.emit(`${lenFieldPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  ctx.emitStore("i32", mapSize, lenFieldPtr);
  const capFieldPtr = ctx.nextTemp();
  ctx.emit(`${capFieldPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
  ctx.emitStore("i32", mapSize, capFieldPtr);

  const loopLabel = ctx.nextLabel("map_keys_loop");
  const bodyLabel = ctx.nextLabel("map_keys_body");
  const endLabel = ctx.nextLabel("map_keys_end");

  const indexReg = emitAlloca(ctx, "i32");
  ctx.emitStore("i32", "0", indexReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(loopLabel);
  const currentIndex = ctx.emitLoad("i32", indexReg);
  const cond = ctx.emitIcmp("slt", "i32", currentIndex, mapSize);
  ctx.emitBrCond(cond, bodyLabel, endLabel);

  ctx.emitLabel(bodyLabel);
  const srcPtr = ctx.nextTemp();
  ctx.emit(`${srcPtr} = getelementptr inbounds double, double* ${keysPtr}, i32 ${currentIndex}`);
  const keyVal = ctx.emitLoad("double", srcPtr);
  const dstPtr = ctx.nextTemp();
  ctx.emit(`${dstPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${currentIndex}`);
  ctx.emitStore("double", keyVal, dstPtr);
  const nextIndex = emitAdd(ctx, "i32", currentIndex, "1");
  ctx.emitStore("i32", nextIndex, indexReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(endLabel);
  ctx.setVariableType(arrayPtr, "%Array*");
  return arrayPtr;
}

export function generateMapValues(ctx: IGeneratorContext, mapPtr: string): string {
  const valuesFieldPtr = ctx.nextTemp();
  ctx.emit(`${valuesFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 1`);
  const valuesPtr = ctx.emitLoad("double*", valuesFieldPtr);

  const sizeFieldPtr = ctx.nextTemp();
  ctx.emit(`${sizeFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 2`);
  const mapSize = ctx.emitLoad("i32", sizeFieldPtr);

  const arrayMem = ctx.emitCall("i8*", "@GC_malloc", "i64 24");
  const arrayPtr = ctx.emitBitcast(arrayMem, "i8*", "%Array*");

  const mapSizeI64 = emitZext(ctx, mapSize, "i32", "i64");
  const dataSize = emitMul(ctx, "i64", mapSizeI64, "8");
  const dataMem = ctx.emitCall("i8*", "@cs_arena_alloc", `i64 ${dataSize}`);
  const dataPtr = ctx.emitBitcast(dataMem, "i8*", "double*");

  const dataPtrField = ctx.nextTemp();
  ctx.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  ctx.emitStore("double*", dataPtr, dataPtrField);
  const lenFieldPtr = ctx.nextTemp();
  ctx.emit(`${lenFieldPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  ctx.emitStore("i32", mapSize, lenFieldPtr);
  const capFieldPtr = ctx.nextTemp();
  ctx.emit(`${capFieldPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
  ctx.emitStore("i32", mapSize, capFieldPtr);

  const loopLabel = ctx.nextLabel("map_values_loop");
  const bodyLabel = ctx.nextLabel("map_values_body");
  const endLabel = ctx.nextLabel("map_values_end");

  const indexReg = emitAlloca(ctx, "i32");
  ctx.emitStore("i32", "0", indexReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(loopLabel);
  const currentIndex = ctx.emitLoad("i32", indexReg);
  const cond = ctx.emitIcmp("slt", "i32", currentIndex, mapSize);
  ctx.emitBrCond(cond, bodyLabel, endLabel);

  ctx.emitLabel(bodyLabel);
  const srcPtr = ctx.nextTemp();
  ctx.emit(`${srcPtr} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${currentIndex}`);
  const val = ctx.emitLoad("double", srcPtr);
  const dstPtr = ctx.nextTemp();
  ctx.emit(`${dstPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${currentIndex}`);
  ctx.emitStore("double", val, dstPtr);
  const nextIndex = emitAdd(ctx, "i32", currentIndex, "1");
  ctx.emitStore("i32", nextIndex, indexReg);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(endLabel);
  ctx.setVariableType(arrayPtr, "%Array*");
  return arrayPtr;
}
