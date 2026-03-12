// String split IR generator: splits a string by delimiter into a StringArray.
// Uses structured IR builders where possible; raw emit() for phi, select, add, sub, mul,
// zext, sext, alloca, inbounds GEP, memcpy intrinsics, and or.

import { IGeneratorContext } from "../../../infrastructure/generator-context.js";

// ============================================
// STRING SPLIT - Complex string splitting into arrays
// ============================================

export function generateSplit(ctx: IGeneratorContext, strPtr: string, delimiter: string): string {
  const strLen = ctx.emitCall("i64", "@strlen", `i8* ${strPtr}`);
  const strLenI32 = ctx.nextTemp();
  ctx.emit(`${strLenI32} = trunc i64 ${strLen} to i32`);

  const delimLen = ctx.emitCall("i64", "@strlen", `i8* ${delimiter}`);
  const delimLenI32 = ctx.nextTemp();
  ctx.emit(`${delimLenI32} = trunc i64 ${delimLen} to i32`);

  const emptyCounterPtr = ctx.nextTemp();
  ctx.emit(`${emptyCounterPtr} = alloca i32`);
  const partCountPtr = ctx.nextTemp();
  ctx.emit(`${partCountPtr} = alloca i32`);
  const scanPosPtr = ctx.nextTemp();
  ctx.emit(`${scanPosPtr} = alloca i32`);
  const startPosPtr = ctx.nextTemp();
  ctx.emit(`${startPosPtr} = alloca i32`);
  const curPosPtr = ctx.nextTemp();
  ctx.emit(`${curPosPtr} = alloca i32`);
  const partIndexPtr = ctx.nextTemp();
  ctx.emit(`${partIndexPtr} = alloca i32`);

  const isEmptyDelim = ctx.emitIcmp("eq", "i32", delimLenI32, "0");

  const emptyDelimLabel = ctx.nextLabel("split_empty_delim");
  const normalSplitLabel = ctx.nextLabel("split_normal");
  const endLabel = ctx.nextLabel("split_end");

  ctx.emitBrCond(isEmptyDelim, emptyDelimLabel, normalSplitLabel);

  ctx.emitLabel(emptyDelimLabel);

  const emptyArrMem = ctx.emitCall("i8*", "@GC_malloc", "i64 24");
  const emptyArrPtr = ctx.emitBitcast(emptyArrMem, "i8*", "%StringArray*");

  const strLenI64 = ctx.nextTemp();
  ctx.emit(`${strLenI64} = zext i32 ${strLenI32} to i64`);
  const emptyDataSizeI64 = ctx.nextTemp();
  ctx.emit(`${emptyDataSizeI64} = mul i64 ${strLenI64}, 8`);
  const emptyDataMem = ctx.emitCall("i8*", "@GC_malloc", `i64 ${emptyDataSizeI64}`);
  const emptyDataPtr = ctx.emitBitcast(emptyDataMem, "i8*", "i8**");

  const emptyLoopLabel = ctx.nextLabel("split_empty_loop");
  const emptyLoopBodyLabel = ctx.nextLabel("split_empty_body");
  const emptyLoopEndLabel = ctx.nextLabel("split_empty_end");

  ctx.emitStore("i32", "0", emptyCounterPtr);
  ctx.emitBr(emptyLoopLabel);

  ctx.emitLabel(emptyLoopLabel);
  const emptyCounterVal = ctx.emitLoad("i32", emptyCounterPtr);
  const emptyLoopCond = ctx.emitIcmp("slt", "i32", emptyCounterVal, strLenI32);
  ctx.emitBrCond(emptyLoopCond, emptyLoopBodyLabel, emptyLoopEndLabel);

  ctx.emitLabel(emptyLoopBodyLabel);
  const charStr = ctx.emitCall("i8*", "@GC_malloc_atomic", "i64 2");

  const charIdx = ctx.nextTemp();
  ctx.emit(`${charIdx} = sext i32 ${emptyCounterVal} to i64`);
  const charPtr = ctx.nextTemp();
  ctx.emit(`${charPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${charIdx}`);
  const charVal = ctx.nextTemp();
  ctx.emit(`${charVal} = load i8, i8* ${charPtr}`);

  ctx.emitStore("i8", charVal, charStr);
  const nullPtr = ctx.nextTemp();
  ctx.emit(`${nullPtr} = getelementptr inbounds i8, i8* ${charStr}, i64 1`);
  ctx.emitStore("i8", "0", nullPtr);

  const emptyElemPtr = ctx.nextTemp();
  ctx.emit(
    `${emptyElemPtr} = getelementptr inbounds i8*, i8** ${emptyDataPtr}, i32 ${emptyCounterVal}`,
  );
  ctx.emitStore("i8*", charStr, emptyElemPtr);

  const emptyNextCounter = ctx.nextTemp();
  ctx.emit(`${emptyNextCounter} = add i32 ${emptyCounterVal}, 1`);
  ctx.emitStore("i32", emptyNextCounter, emptyCounterPtr);
  ctx.emitBr(emptyLoopLabel);

  ctx.emitLabel(emptyLoopEndLabel);

  const emptyDataField = ctx.nextTemp();
  ctx.emit(
    `${emptyDataField} = getelementptr inbounds %StringArray, %StringArray* ${emptyArrPtr}, i32 0, i32 0`,
  );
  ctx.emitStore("i8**", emptyDataPtr, emptyDataField);

  const emptyLenField = ctx.nextTemp();
  ctx.emit(
    `${emptyLenField} = getelementptr inbounds %StringArray, %StringArray* ${emptyArrPtr}, i32 0, i32 1`,
  );
  ctx.emitStore("i32", strLenI32, emptyLenField);

  const emptyCapField = ctx.nextTemp();
  ctx.emit(
    `${emptyCapField} = getelementptr inbounds %StringArray, %StringArray* ${emptyArrPtr}, i32 0, i32 2`,
  );
  ctx.emitStore("i32", strLenI32, emptyCapField);

  ctx.emitBr(endLabel);

  ctx.emitLabel(normalSplitLabel);

  const delimLenI64 = ctx.nextTemp();
  ctx.emit(`${delimLenI64} = zext i32 ${delimLenI32} to i64`);

  const countLabel = ctx.nextLabel("split_count");
  const countBodyLabel = ctx.nextLabel("split_count_body");
  const countCheckLabel = ctx.nextLabel("split_count_check");
  const countEndLabel = ctx.nextLabel("split_count_end");

  ctx.emitStore("i32", "1", partCountPtr);
  ctx.emitStore("i32", "0", scanPosPtr);

  ctx.emitBr(countLabel);

  ctx.emitLabel(countLabel);
  const scanPos = ctx.emitLoad("i32", scanPosPtr);
  const canContinue = ctx.emitIcmp("slt", "i32", scanPos, strLenI32);
  ctx.emitBrCond(canContinue, countBodyLabel, countEndLabel);

  ctx.emitLabel(countBodyLabel);
  const scanPosI64 = ctx.nextTemp();
  ctx.emit(`${scanPosI64} = sext i32 ${scanPos} to i64`);
  const checkPtr = ctx.nextTemp();
  ctx.emit(`${checkPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${scanPosI64}`);
  const cmpResult = ctx.emitCall(
    "i32",
    "@strncmp",
    `i8* ${checkPtr}, i8* ${delimiter}, i64 ${delimLenI64}`,
  );
  const isMatch = ctx.emitIcmp("eq", "i32", cmpResult, "0");

  ctx.emitBrCond(isMatch, countCheckLabel, countCheckLabel);

  ctx.emitLabel(countCheckLabel);
  const partCount = ctx.emitLoad("i32", partCountPtr);
  const newPartCount = ctx.nextTemp();
  ctx.emit(`${newPartCount} = select i1 ${isMatch}, i32 ${partCount}, i32 ${partCount}`);
  const incPartCount = ctx.nextTemp();
  ctx.emit(`${incPartCount} = add i32 ${newPartCount}, 1`);
  const finalPartCount = ctx.nextTemp();
  ctx.emit(`${finalPartCount} = select i1 ${isMatch}, i32 ${incPartCount}, i32 ${newPartCount}`);
  ctx.emitStore("i32", finalPartCount, partCountPtr);

  const skipAmount = ctx.nextTemp();
  ctx.emit(`${skipAmount} = select i1 ${isMatch}, i32 ${delimLenI32}, i32 1`);
  const nextScanPos = ctx.nextTemp();
  ctx.emit(`${nextScanPos} = add i32 ${scanPos}, ${skipAmount}`);
  ctx.emitStore("i32", nextScanPos, scanPosPtr);
  ctx.emitBr(countLabel);

  ctx.emitLabel(countEndLabel);
  const totalParts = ctx.emitLoad("i32", partCountPtr);

  const arrayMem = ctx.emitCall("i8*", "@GC_malloc", "i64 24");
  const arrayPtr = ctx.emitBitcast(arrayMem, "i8*", "%StringArray*");

  const totalPartsI64 = ctx.nextTemp();
  ctx.emit(`${totalPartsI64} = zext i32 ${totalParts} to i64`);
  const dataSizeI64 = ctx.nextTemp();
  ctx.emit(`${dataSizeI64} = mul i64 ${totalPartsI64}, 8`);
  const dataMem = ctx.emitCall("i8*", "@GC_malloc", `i64 ${dataSizeI64}`);
  const dataPtr = ctx.emitBitcast(dataMem, "i8*", "i8**");

  const extractLabel = ctx.nextLabel("split_extract");
  const extractBodyLabel = ctx.nextLabel("split_extract_body");
  const extractMatchLabel = ctx.nextLabel("split_extract_match");
  const extractNoMatchLabel = ctx.nextLabel("split_extract_nomatch");
  const extractEndLabel = ctx.nextLabel("split_extract_end");

  ctx.emitStore("i32", "0", startPosPtr);
  ctx.emitStore("i32", "0", curPosPtr);
  ctx.emitStore("i32", "0", partIndexPtr);

  ctx.emitBr(extractLabel);

  ctx.emitLabel(extractLabel);
  const curPos = ctx.emitLoad("i32", curPosPtr);
  const extractCond = ctx.emitIcmp("sle", "i32", curPos, strLenI32);
  ctx.emitBrCond(extractCond, extractBodyLabel, extractEndLabel);

  ctx.emitLabel(extractBodyLabel);
  const atEnd = ctx.emitIcmp("eq", "i32", curPos, strLenI32);

  const curPosI64 = ctx.nextTemp();
  ctx.emit(`${curPosI64} = sext i32 ${curPos} to i64`);
  const extractCheckPtr = ctx.nextTemp();
  ctx.emit(`${extractCheckPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${curPosI64}`);
  const extractCmpResult = ctx.emitCall(
    "i32",
    "@strncmp",
    `i8* ${extractCheckPtr}, i8* ${delimiter}, i64 ${delimLenI64}`,
  );
  const extractIsMatch = ctx.emitIcmp("eq", "i32", extractCmpResult, "0");

  const shouldExtract = ctx.nextTemp();
  ctx.emit(`${shouldExtract} = or i1 ${atEnd}, ${extractIsMatch}`);

  ctx.emitBrCond(shouldExtract, extractMatchLabel, extractNoMatchLabel);

  ctx.emitLabel(extractMatchLabel);
  const startPos = ctx.emitLoad("i32", startPosPtr);
  const partLen = ctx.nextTemp();
  ctx.emit(`${partLen} = sub i32 ${curPos}, ${startPos}`);

  const partLenI64 = ctx.nextTemp();
  ctx.emit(`${partLenI64} = sext i32 ${partLen} to i64`);
  const allocLen = ctx.nextTemp();
  ctx.emit(`${allocLen} = add i64 ${partLenI64}, 1`);
  const partStr = ctx.emitCall("i8*", "@GC_malloc_atomic", `i64 ${allocLen}`);
  const startI64 = ctx.nextTemp();
  ctx.emit(`${startI64} = sext i32 ${startPos} to i64`);
  const srcPtr = ctx.nextTemp();
  ctx.emit(`${srcPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${startI64}`);
  ctx.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${partStr}, i8* ${srcPtr}, i64 ${partLenI64}, i1 false)`,
  );
  const nullTermPtr = ctx.nextTemp();
  ctx.emit(`${nullTermPtr} = getelementptr inbounds i8, i8* ${partStr}, i64 ${partLenI64}`);
  ctx.emitStore("i8", "0", nullTermPtr);

  const partIndex = ctx.emitLoad("i32", partIndexPtr);
  const partElemPtr = ctx.nextTemp();
  ctx.emit(`${partElemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${partIndex}`);
  ctx.emitStore("i8*", partStr, partElemPtr);

  const nextPartIndex = ctx.nextTemp();
  ctx.emit(`${nextPartIndex} = add i32 ${partIndex}, 1`);
  ctx.emitStore("i32", nextPartIndex, partIndexPtr);

  const newStartPos = ctx.nextTemp();
  ctx.emit(`${newStartPos} = add i32 ${curPos}, ${delimLenI32}`);
  ctx.emitStore("i32", newStartPos, startPosPtr);

  const newCurPos = ctx.nextTemp();
  ctx.emit(`${newCurPos} = add i32 ${curPos}, ${delimLenI32}`);
  ctx.emitStore("i32", newCurPos, curPosPtr);
  ctx.emitBr(extractLabel);

  ctx.emitLabel(extractNoMatchLabel);
  const incCurPos = ctx.nextTemp();
  ctx.emit(`${incCurPos} = add i32 ${curPos}, 1`);
  ctx.emitStore("i32", incCurPos, curPosPtr);
  ctx.emitBr(extractLabel);

  ctx.emitLabel(extractEndLabel);

  const dataField = ctx.nextTemp();
  ctx.emit(
    `${dataField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
  );
  ctx.emitStore("i8**", dataPtr, dataField);

  const lenField = ctx.nextTemp();
  ctx.emit(
    `${lenField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`,
  );
  ctx.emitStore("i32", totalParts, lenField);

  const capField = ctx.nextTemp();
  ctx.emit(
    `${capField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 2`,
  );
  ctx.emitStore("i32", totalParts, capField);

  ctx.emitBr(endLabel);

  ctx.emitLabel(endLabel);
  const result = ctx.nextTemp();
  ctx.emit(
    `${result} = phi %StringArray* [ ${emptyArrPtr}, %${emptyLoopEndLabel} ], [ ${arrayPtr}, %${extractEndLabel} ]`,
  );

  return result;
}
