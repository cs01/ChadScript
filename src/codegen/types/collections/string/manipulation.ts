// String manipulation IR generators: substring, slice, repeat, pad, trim, replace, case conversion.
// Uses structured IR builders (emitCall, emitLoad, emitStore, etc.) where possible;
// raw emit() kept for instructions without builders (phi, select, add, sub, alloca, inbounds GEP, etc.).

import { IGeneratorContext } from "../../../infrastructure/generator-context.js";
import {
  emitTrunc,
  emitSext,
  emitSelect,
  emitAdd,
  emitSub,
  emitOr,
  emitMul,
  emitSRem,
  emitPtrtoint,
} from "../../../infrastructure/ir-builders.js";

// ============================================
// STRING MANIPULATION - Substring, slice, repeat, pad, trim operations
// ============================================

export function generateSubstr(
  ctx: IGeneratorContext,
  strPtr: string,
  startIndex: string,
  length: string | null,
): string {
  const strLen = ctx.emitCall("i64", "@strlen", `i8* ${strPtr}`);
  const strLenI32 = emitTrunc(ctx, strLen, "i64", "i32");

  const startIsNeg = ctx.emitIcmp("slt", "i32", startIndex, "0");
  const negAdjusted = emitAdd(ctx, "i32", strLenI32, startIndex);
  const afterNeg = emitSelect(ctx, startIsNeg, "i32", negAdjusted, startIndex);
  const stillNeg = ctx.emitIcmp("slt", "i32", afterNeg, "0");
  const clampedLow = emitSelect(ctx, stillNeg, "i32", "0", afterNeg);
  const startTooBig = ctx.emitIcmp("sgt", "i32", clampedLow, strLenI32);
  const startI32 = emitSelect(ctx, startTooBig, "i32", strLenI32, clampedLow);

  let substrLen: string;
  if (length === null) {
    substrLen = emitSub(ctx, "i32", strLenI32, startI32);
  } else {
    substrLen = length;
  }

  const remainingLen = emitSub(ctx, "i32", strLenI32, startI32);

  const isLenTooLarge = ctx.emitIcmp("sgt", "i32", substrLen, remainingLen);

  const clampedLen = emitSelect(ctx, isLenTooLarge, "i32", remainingLen, substrLen);

  const isNegative = ctx.emitIcmp("slt", "i32", clampedLen, "0");

  const finalLen = emitSelect(ctx, isNegative, "i32", "0", clampedLen);

  const finalLenI64 = emitSext(ctx, finalLen, "i32", "i64");

  const allocLen = emitAdd(ctx, "i64", finalLenI64, "1");

  const resultPtr = ctx.emitCall("i8*", "@cs_arena_alloc", `i64 ${allocLen}`);

  const startI64 = emitSext(ctx, startI32, "i32", "i64");

  const srcPtr = ctx.nextTemp();
  ctx.emit(`${srcPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${startI64}`);

  ctx.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${resultPtr}, i8* ${srcPtr}, i64 ${finalLenI64}, i1 false)`,
  );

  const nullPtr = ctx.nextTemp();
  ctx.emit(`${nullPtr} = getelementptr inbounds i8, i8* ${resultPtr}, i64 ${finalLenI64}`);
  ctx.emitStore("i8", "0", nullPtr);

  return resultPtr;
}

export function generateRepeat(ctx: IGeneratorContext, strPtr: string, count: string): string {
  const strLen = ctx.emitCall("i64", "@strlen", `i8* ${strPtr}`);

  const isNeg = ctx.emitIcmp("slt", "i32", count, "0");
  const clampedCount = emitSelect(ctx, isNeg, "i32", "0", count);

  const maxCount = 1048576;
  const tooBig = ctx.emitIcmp("sgt", "i32", clampedCount, `${maxCount}`);
  const safeCount = emitSelect(ctx, tooBig, "i32", `${maxCount}`, clampedCount);

  const countI64 = emitSext(ctx, safeCount, "i32", "i64");

  const totalLen = emitMul(ctx, "i64", strLen, countI64);

  const allocLen = emitAdd(ctx, "i64", totalLen, "1");

  const resultPtr = ctx.emitCall("i8*", "@cs_arena_alloc", `i64 ${allocLen}`);

  ctx.emitStore("i8", "0", resultPtr);

  const loopLabel = ctx.nextLabel("repeat_loop");
  const loopBodyLabel = ctx.nextLabel("repeat_body");
  const loopEndLabel = ctx.nextLabel("repeat_end");

  const counterPtr = ctx.nextTemp();
  ctx.emit(`${counterPtr} = alloca i32`);
  ctx.emitStore("i32", "0", counterPtr);

  ctx.emitBr(loopLabel);

  ctx.emitLabel(loopLabel);
  const counterVal = ctx.emitLoad("i32", counterPtr);
  const loopCond = ctx.emitIcmp("slt", "i32", counterVal, safeCount);
  ctx.emitBrCond(loopCond, loopBodyLabel, loopEndLabel);

  ctx.emitLabel(loopBodyLabel);
  const strcatResult = ctx.emitCall("i8*", "@strcat", `i8* ${resultPtr}, i8* ${strPtr}`);
  // strcatResult unused but call has side effects

  const nextCounter = emitAdd(ctx, "i32", counterVal, "1");
  ctx.emitStore("i32", nextCounter, counterPtr);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(loopEndLabel);

  return resultPtr;
}

export function generatePadStart(
  ctx: IGeneratorContext,
  strPtr: string,
  targetLength: string,
  padString: string,
): string {
  const maxPadLen = 1048576;
  const padTooBig = ctx.emitIcmp("sgt", "i32", targetLength, `${maxPadLen}`);
  const safePadTarget = emitSelect(ctx, padTooBig, "i32", `${maxPadLen}`, targetLength);

  const strLen = ctx.emitCall("i64", "@strlen", `i8* ${strPtr}`);
  const strLenI32 = emitTrunc(ctx, strLen, "i64", "i32");

  const padLen = ctx.emitCall("i64", "@strlen", `i8* ${padString}`);
  const padLenI32 = emitTrunc(ctx, padLen, "i64", "i32");

  const paddingNeeded = emitSub(ctx, "i32", safePadTarget, strLenI32);

  const needsPaddingRaw = ctx.emitIcmp("sgt", "i32", paddingNeeded, "0");
  const padNonEmpty = ctx.emitIcmp("sgt", "i32", padLenI32, "0");
  const needsPadding = ctx.nextTemp();
  ctx.emit(`${needsPadding} = and i1 ${needsPaddingRaw}, ${padNonEmpty}`);

  const padCounterPtr = ctx.nextTemp();
  ctx.emit(`${padCounterPtr} = alloca i32`);

  const noPadLabel = ctx.nextLabel("padstart_nopad");
  const doPadLabel = ctx.nextLabel("padstart_dopad");
  const endLabel = ctx.nextLabel("padstart_end");

  ctx.emitBrCond(needsPadding, doPadLabel, noPadLabel);

  ctx.emitLabel(noPadLabel);
  const targetLenI64NoPad = emitSext(ctx, safePadTarget, "i32", "i64");
  const allocLen1 = emitAdd(ctx, "i64", targetLenI64NoPad, "1");
  const noPadResult = ctx.emitCall("i8*", "@cs_arena_alloc", `i64 ${allocLen1}`);
  const strcpyResult1 = ctx.emitCall("i8*", "@strcpy", `i8* ${noPadResult}, i8* ${strPtr}`);
  ctx.emitBr(endLabel);

  ctx.emitLabel(doPadLabel);
  const targetLenI64Pad = emitSext(ctx, safePadTarget, "i32", "i64");
  const allocLen2 = emitAdd(ctx, "i64", targetLenI64Pad, "1");
  const padResult = ctx.emitCall("i8*", "@cs_arena_alloc", `i64 ${allocLen2}`);

  ctx.emitStore("i8", "0", padResult);

  const fullPads = ctx.nextTemp();
  ctx.emit(`${fullPads} = sdiv i32 ${paddingNeeded}, ${padLenI32}`);

  const remainingPad = emitSRem(ctx, "i32", paddingNeeded, padLenI32);

  const padLoopLabel = ctx.nextLabel("padstart_loop");
  const padLoopBodyLabel = ctx.nextLabel("padstart_loop_body");
  const padLoopEndLabel = ctx.nextLabel("padstart_loop_end");

  ctx.emitStore("i32", "0", padCounterPtr);
  ctx.emitBr(padLoopLabel);

  ctx.emitLabel(padLoopLabel);
  const padCounterVal = ctx.emitLoad("i32", padCounterPtr);
  const padLoopCond = ctx.emitIcmp("slt", "i32", padCounterVal, fullPads);
  ctx.emitBrCond(padLoopCond, padLoopBodyLabel, padLoopEndLabel);

  ctx.emitLabel(padLoopBodyLabel);
  const strcatPad = ctx.emitCall("i8*", "@strcat", `i8* ${padResult}, i8* ${padString}`);
  const nextPadCounter = emitAdd(ctx, "i32", padCounterVal, "1");
  ctx.emitStore("i32", nextPadCounter, padCounterPtr);
  ctx.emitBr(padLoopLabel);

  ctx.emitLabel(padLoopEndLabel);

  const hasRemaining = ctx.emitIcmp("sgt", "i32", remainingPad, "0");

  const addRemainingLabel = ctx.nextLabel("padstart_add_remaining");
  const skipRemainingLabel = ctx.nextLabel("padstart_skip_remaining");

  ctx.emitBrCond(hasRemaining, addRemainingLabel, skipRemainingLabel);

  ctx.emitLabel(addRemainingLabel);
  const remainingSubstr = generateSubstr(ctx, padString, "0", remainingPad);
  const strcatRemaining = ctx.emitCall(
    "i8*",
    "@strcat",
    `i8* ${padResult}, i8* ${remainingSubstr}`,
  );
  ctx.emitBr(skipRemainingLabel);

  ctx.emitLabel(skipRemainingLabel);

  const finalResult = ctx.emitCall("i8*", "@strcat", `i8* ${padResult}, i8* ${strPtr}`);
  ctx.emitBr(endLabel);

  ctx.emitLabel(endLabel);
  const result = ctx.nextTemp();
  ctx.emit(
    `${result} = phi i8* [ ${noPadResult}, %${noPadLabel} ], [ ${padResult}, %${skipRemainingLabel} ]`,
  );
  ctx.setVariableType(result, "i8*");

  return result;
}

export function generatePadEnd(
  ctx: IGeneratorContext,
  strPtr: string,
  targetLength: string,
  padString: string,
): string {
  const maxPadLen = 1048576;
  const padTooBig = ctx.emitIcmp("sgt", "i32", targetLength, `${maxPadLen}`);
  const safePadTarget = emitSelect(ctx, padTooBig, "i32", `${maxPadLen}`, targetLength);

  const strLen = ctx.emitCall("i64", "@strlen", `i8* ${strPtr}`);
  const strLenI32 = emitTrunc(ctx, strLen, "i64", "i32");

  const padLen = ctx.emitCall("i64", "@strlen", `i8* ${padString}`);
  const padLenI32 = emitTrunc(ctx, padLen, "i64", "i32");

  const paddingNeeded = emitSub(ctx, "i32", safePadTarget, strLenI32);

  const needsPaddingRaw = ctx.emitIcmp("sgt", "i32", paddingNeeded, "0");
  const padNonEmpty = ctx.emitIcmp("sgt", "i32", padLenI32, "0");
  const needsPadding = ctx.nextTemp();
  ctx.emit(`${needsPadding} = and i1 ${needsPaddingRaw}, ${padNonEmpty}`);

  const padCounterPtr = ctx.nextTemp();
  ctx.emit(`${padCounterPtr} = alloca i32`);

  const noPadLabel = ctx.nextLabel("padend_nopad");
  const doPadLabel = ctx.nextLabel("padend_dopad");
  const endLabel = ctx.nextLabel("padend_end");

  ctx.emitBrCond(needsPadding, doPadLabel, noPadLabel);

  ctx.emitLabel(noPadLabel);
  const strLenI64NoPad = emitSext(ctx, strLenI32, "i32", "i64");
  const allocLen1 = emitAdd(ctx, "i64", strLenI64NoPad, "1");
  const noPadResult = ctx.emitCall("i8*", "@cs_arena_alloc", `i64 ${allocLen1}`);
  const strcpyResult1 = ctx.emitCall("i8*", "@strcpy", `i8* ${noPadResult}, i8* ${strPtr}`);
  ctx.emitBr(endLabel);

  ctx.emitLabel(doPadLabel);
  const targetLenI64Pad = emitSext(ctx, safePadTarget, "i32", "i64");
  const allocLen2 = emitAdd(ctx, "i64", targetLenI64Pad, "1");
  const padResult = ctx.emitCall("i8*", "@cs_arena_alloc", `i64 ${allocLen2}`);

  const strcpyOrig = ctx.emitCall("i8*", "@strcpy", `i8* ${padResult}, i8* ${strPtr}`);

  const fullPads = ctx.nextTemp();
  ctx.emit(`${fullPads} = sdiv i32 ${paddingNeeded}, ${padLenI32}`);

  const remainingPad = emitSRem(ctx, "i32", paddingNeeded, padLenI32);

  const padLoopLabel = ctx.nextLabel("padend_loop");
  const padLoopBodyLabel = ctx.nextLabel("padend_loop_body");
  const padLoopEndLabel = ctx.nextLabel("padend_loop_end");

  ctx.emitStore("i32", "0", padCounterPtr);
  ctx.emitBr(padLoopLabel);

  ctx.emitLabel(padLoopLabel);
  const padCounterVal = ctx.emitLoad("i32", padCounterPtr);
  const padLoopCond = ctx.emitIcmp("slt", "i32", padCounterVal, fullPads);
  ctx.emitBrCond(padLoopCond, padLoopBodyLabel, padLoopEndLabel);

  ctx.emitLabel(padLoopBodyLabel);
  const strcatPad = ctx.emitCall("i8*", "@strcat", `i8* ${padResult}, i8* ${padString}`);
  const nextPadCounter = emitAdd(ctx, "i32", padCounterVal, "1");
  ctx.emitStore("i32", nextPadCounter, padCounterPtr);
  ctx.emitBr(padLoopLabel);

  ctx.emitLabel(padLoopEndLabel);

  const hasRemaining = ctx.emitIcmp("sgt", "i32", remainingPad, "0");

  const addRemainingLabel = ctx.nextLabel("padend_add_remaining");
  const skipRemainingLabel = ctx.nextLabel("padend_skip_remaining");

  ctx.emitBrCond(hasRemaining, addRemainingLabel, skipRemainingLabel);

  ctx.emitLabel(addRemainingLabel);
  const remainingSubstr = generateSubstr(ctx, padString, "0", remainingPad);
  const strcatRemaining = ctx.emitCall(
    "i8*",
    "@strcat",
    `i8* ${padResult}, i8* ${remainingSubstr}`,
  );
  ctx.emitBr(skipRemainingLabel);

  ctx.emitLabel(skipRemainingLabel);
  ctx.emitBr(endLabel);

  ctx.emitLabel(endLabel);
  const result = ctx.nextTemp();
  ctx.emit(
    `${result} = phi i8* [ ${noPadResult}, %${noPadLabel} ], [ ${padResult}, %${skipRemainingLabel} ]`,
  );
  ctx.setVariableType(result, "i8*");

  return result;
}

export function generateSlice(
  ctx: IGeneratorContext,
  strPtr: string,
  startIndex: string,
  endIndex: string | null,
): string {
  const strLen = ctx.emitCall("i64", "@strlen", `i8* ${strPtr}`);
  const strLenI32 = emitTrunc(ctx, strLen, "i64", "i32");

  const startIsNegative = ctx.emitIcmp("slt", "i32", startIndex, "0");

  const adjustedStart1 = emitAdd(ctx, "i32", strLenI32, startIndex);

  const adjustedStart2 = emitSelect(ctx, startIsNegative, "i32", adjustedStart1, startIndex);

  const startTooSmall = ctx.emitIcmp("slt", "i32", adjustedStart2, "0");
  const clampedStart1 = emitSelect(ctx, startTooSmall, "i32", "0", adjustedStart2);

  const startTooBig = ctx.emitIcmp("sgt", "i32", clampedStart1, strLenI32);
  const finalStart = emitSelect(ctx, startTooBig, "i32", strLenI32, clampedStart1);

  let finalEnd: string;
  if (endIndex === null) {
    finalEnd = strLenI32;
  } else {
    const endIsNegative = ctx.emitIcmp("slt", "i32", endIndex, "0");

    const adjustedEnd1 = emitAdd(ctx, "i32", strLenI32, endIndex);

    const adjustedEnd2 = emitSelect(ctx, endIsNegative, "i32", adjustedEnd1, endIndex);

    const endTooSmall = ctx.emitIcmp("slt", "i32", adjustedEnd2, "0");
    const clampedEnd1 = emitSelect(ctx, endTooSmall, "i32", "0", adjustedEnd2);

    const endTooBig = ctx.emitIcmp("sgt", "i32", clampedEnd1, strLenI32);
    finalEnd = emitSelect(ctx, endTooBig, "i32", strLenI32, clampedEnd1);
  }

  const sliceLen = emitSub(ctx, "i32", finalEnd, finalStart);

  const lenIsNegative = ctx.emitIcmp("slt", "i32", sliceLen, "0");
  const finalLen = emitSelect(ctx, lenIsNegative, "i32", "0", sliceLen);

  return generateSubstr(ctx, strPtr, finalStart, finalLen);
}

export function generateTrim(ctx: IGeneratorContext, strPtr: string): string {
  const strLen = ctx.emitCall("i64", "@strlen", `i8* ${strPtr}`);
  const strLenI32 = emitTrunc(ctx, strLen, "i64", "i32");

  const isEmpty = ctx.emitIcmp("eq", "i32", strLenI32, "0");

  const startPtr = ctx.nextTemp();
  ctx.emit(`${startPtr} = alloca i32`);
  const endPtr = ctx.nextTemp();
  ctx.emit(`${endPtr} = alloca i32`);

  const emptyLabel = ctx.nextLabel("trim_empty");
  const notEmptyLabel = ctx.nextLabel("trim_notempty");
  const endLabel = ctx.nextLabel("trim_end");

  ctx.emitBrCond(isEmpty, emptyLabel, notEmptyLabel);

  ctx.emitLabel(emptyLabel);
  const emptyResult = ctx.emitCall("i8*", "@cs_arena_alloc", "i64 1");
  ctx.emitStore("i8", "0", emptyResult);
  ctx.emitBr(endLabel);

  ctx.emitLabel(notEmptyLabel);

  ctx.emitStore("i32", "0", startPtr);

  const findStartLabel = ctx.nextLabel("trim_find_start");
  const findStartBodyLabel = ctx.nextLabel("trim_find_start_body");
  const findStartCheckLabel = ctx.nextLabel("trim_find_start_check");
  const findStartEndLabel = ctx.nextLabel("trim_find_start_end");

  ctx.emitBr(findStartLabel);

  ctx.emitLabel(findStartLabel);
  const start = ctx.emitLoad("i32", startPtr);
  const startCond = ctx.emitIcmp("slt", "i32", start, strLenI32);
  ctx.emitBrCond(startCond, findStartBodyLabel, findStartEndLabel);

  ctx.emitLabel(findStartBodyLabel);
  const startI64 = emitSext(ctx, start, "i32", "i64");
  const charPtr1 = ctx.nextTemp();
  ctx.emit(`${charPtr1} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${startI64}`);
  const char1 = ctx.nextTemp();
  ctx.emit(`${char1} = load i8, i8* ${charPtr1}`);

  const isSpace = ctx.emitIcmp("eq", "i8", char1, "32");
  const isTab = ctx.emitIcmp("eq", "i8", char1, "9");
  const isNewline = ctx.emitIcmp("eq", "i8", char1, "10");
  const isCR = ctx.emitIcmp("eq", "i8", char1, "13");

  const isWS1 = emitOr(ctx, "i1", isSpace, isTab);
  const isWS2 = emitOr(ctx, "i1", isWS1, isNewline);
  const isWhitespace = emitOr(ctx, "i1", isWS2, isCR);

  ctx.emitBrCond(isWhitespace, findStartCheckLabel, findStartEndLabel);

  ctx.emitLabel(findStartCheckLabel);
  const nextStart = emitAdd(ctx, "i32", start, "1");
  ctx.emitStore("i32", nextStart, startPtr);
  ctx.emitBr(findStartLabel);

  ctx.emitLabel(findStartEndLabel);
  const finalStart = ctx.emitLoad("i32", startPtr);

  const allWhitespace = ctx.emitIcmp("eq", "i32", finalStart, strLenI32);

  const allWSLabel = ctx.nextLabel("trim_all_ws");
  const findEndLabel = ctx.nextLabel("trim_find_end");

  ctx.emitBrCond(allWhitespace, allWSLabel, findEndLabel);

  ctx.emitLabel(allWSLabel);
  const allWSResult = ctx.emitCall("i8*", "@cs_arena_alloc", "i64 1");
  ctx.emitStore("i8", "0", allWSResult);
  ctx.emitBr(endLabel);

  ctx.emitLabel(findEndLabel);
  const initEnd = emitSub(ctx, "i32", strLenI32, "1");
  ctx.emitStore("i32", initEnd, endPtr);

  const findEndLoopLabel = ctx.nextLabel("trim_find_end_loop");
  const findEndBodyLabel = ctx.nextLabel("trim_find_end_body");
  const findEndCheckLabel = ctx.nextLabel("trim_find_end_check");
  const findEndEndLabel = ctx.nextLabel("trim_find_end_end");

  ctx.emitBr(findEndLoopLabel);

  ctx.emitLabel(findEndLoopLabel);
  const end = ctx.emitLoad("i32", endPtr);
  const endCond = ctx.emitIcmp("sge", "i32", end, finalStart);
  ctx.emitBrCond(endCond, findEndBodyLabel, findEndEndLabel);

  ctx.emitLabel(findEndBodyLabel);
  const endI64 = emitSext(ctx, end, "i32", "i64");
  const charPtr2 = ctx.nextTemp();
  ctx.emit(`${charPtr2} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${endI64}`);
  const char2 = ctx.nextTemp();
  ctx.emit(`${char2} = load i8, i8* ${charPtr2}`);

  const isSpace2 = ctx.emitIcmp("eq", "i8", char2, "32");
  const isTab2 = ctx.emitIcmp("eq", "i8", char2, "9");
  const isNewline2 = ctx.emitIcmp("eq", "i8", char2, "10");
  const isCR2 = ctx.emitIcmp("eq", "i8", char2, "13");

  const isWS3 = emitOr(ctx, "i1", isSpace2, isTab2);
  const isWS4 = emitOr(ctx, "i1", isWS3, isNewline2);
  const isWhitespace2 = emitOr(ctx, "i1", isWS4, isCR2);

  ctx.emitBrCond(isWhitespace2, findEndCheckLabel, findEndEndLabel);

  ctx.emitLabel(findEndCheckLabel);
  const nextEnd = emitSub(ctx, "i32", end, "1");
  ctx.emitStore("i32", nextEnd, endPtr);
  ctx.emitBr(findEndLoopLabel);

  ctx.emitLabel(findEndEndLabel);
  const finalEnd = ctx.emitLoad("i32", endPtr);

  const trimmedLen = emitSub(ctx, "i32", finalEnd, finalStart);
  const trimmedLenPlus1 = emitAdd(ctx, "i32", trimmedLen, "1");

  const trimmedResult = generateSubstr(ctx, strPtr, finalStart, trimmedLenPlus1);
  ctx.emitBr(endLabel);

  ctx.emitLabel(endLabel);
  const result = ctx.nextTemp();
  ctx.emit(
    `${result} = phi i8* [ ${emptyResult}, %${emptyLabel} ], [ ${allWSResult}, %${allWSLabel} ], [ ${trimmedResult}, %${findEndEndLabel} ]`,
  );
  ctx.setVariableType(result, "i8*");

  return result;
}

export function generateTrimStart(ctx: IGeneratorContext, strPtr: string): string {
  const strLen = ctx.emitCall("i64", "@strlen", `i8* ${strPtr}`);
  const strLenI32 = emitTrunc(ctx, strLen, "i64", "i32");

  const isEmpty = ctx.emitIcmp("eq", "i32", strLenI32, "0");

  const startPtr = ctx.nextTemp();
  ctx.emit(`${startPtr} = alloca i32`);

  const emptyLabel = ctx.nextLabel("trimstart_empty");
  const notEmptyLabel = ctx.nextLabel("trimstart_notempty");
  const endLabel = ctx.nextLabel("trimstart_end");

  ctx.emitBrCond(isEmpty, emptyLabel, notEmptyLabel);

  ctx.emitLabel(emptyLabel);
  const emptyResult = ctx.emitCall("i8*", "@cs_arena_alloc", "i64 1");
  ctx.emitStore("i8", "0", emptyResult);
  ctx.emitBr(endLabel);

  ctx.emitLabel(notEmptyLabel);

  ctx.emitStore("i32", "0", startPtr);

  const findStartLabel = ctx.nextLabel("trimstart_find");
  const findStartBodyLabel = ctx.nextLabel("trimstart_find_body");
  const findStartCheckLabel = ctx.nextLabel("trimstart_find_check");
  const findStartEndLabel = ctx.nextLabel("trimstart_find_end");

  ctx.emitBr(findStartLabel);

  ctx.emitLabel(findStartLabel);
  const start = ctx.emitLoad("i32", startPtr);
  const startCond = ctx.emitIcmp("slt", "i32", start, strLenI32);
  ctx.emitBrCond(startCond, findStartBodyLabel, findStartEndLabel);

  ctx.emitLabel(findStartBodyLabel);
  const startI64 = emitSext(ctx, start, "i32", "i64");
  const charPtr = ctx.nextTemp();
  ctx.emit(`${charPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${startI64}`);
  const ch = ctx.nextTemp();
  ctx.emit(`${ch} = load i8, i8* ${charPtr}`);

  const isSpace = ctx.emitIcmp("eq", "i8", ch, "32");
  const isTab = ctx.emitIcmp("eq", "i8", ch, "9");
  const isNewline = ctx.emitIcmp("eq", "i8", ch, "10");
  const isCR = ctx.emitIcmp("eq", "i8", ch, "13");

  const isWS1 = emitOr(ctx, "i1", isSpace, isTab);
  const isWS2 = emitOr(ctx, "i1", isWS1, isNewline);
  const isWhitespace = emitOr(ctx, "i1", isWS2, isCR);

  ctx.emitBrCond(isWhitespace, findStartCheckLabel, findStartEndLabel);

  ctx.emitLabel(findStartCheckLabel);
  const nextStart = emitAdd(ctx, "i32", start, "1");
  ctx.emitStore("i32", nextStart, startPtr);
  ctx.emitBr(findStartLabel);

  ctx.emitLabel(findStartEndLabel);
  const finalStart = ctx.emitLoad("i32", startPtr);

  const allWhitespace = ctx.emitIcmp("eq", "i32", finalStart, strLenI32);

  const allWSLabel = ctx.nextLabel("trimstart_all_ws");
  const substrLabel = ctx.nextLabel("trimstart_substr");

  ctx.emitBrCond(allWhitespace, allWSLabel, substrLabel);

  ctx.emitLabel(allWSLabel);
  const allWSResult = ctx.emitCall("i8*", "@cs_arena_alloc", "i64 1");
  ctx.emitStore("i8", "0", allWSResult);
  ctx.emitBr(endLabel);

  ctx.emitLabel(substrLabel);
  const remainLen = emitSub(ctx, "i32", strLenI32, finalStart);
  const trimmedResult = generateSubstr(ctx, strPtr, finalStart, remainLen);
  ctx.emitBr(endLabel);

  ctx.emitLabel(endLabel);
  const result = ctx.nextTemp();
  ctx.emit(
    `${result} = phi i8* [ ${emptyResult}, %${emptyLabel} ], [ ${allWSResult}, %${allWSLabel} ], [ ${trimmedResult}, %${substrLabel} ]`,
  );
  ctx.setVariableType(result, "i8*");

  return result;
}

export function generateTrimEnd(ctx: IGeneratorContext, strPtr: string): string {
  const strLen = ctx.emitCall("i64", "@strlen", `i8* ${strPtr}`);
  const strLenI32 = emitTrunc(ctx, strLen, "i64", "i32");

  const isEmpty = ctx.emitIcmp("eq", "i32", strLenI32, "0");

  const endPtr = ctx.nextTemp();
  ctx.emit(`${endPtr} = alloca i32`);

  const emptyLabel = ctx.nextLabel("trimend_empty");
  const notEmptyLabel = ctx.nextLabel("trimend_notempty");
  const endLabel = ctx.nextLabel("trimend_end");

  ctx.emitBrCond(isEmpty, emptyLabel, notEmptyLabel);

  ctx.emitLabel(emptyLabel);
  const emptyResult = ctx.emitCall("i8*", "@cs_arena_alloc", "i64 1");
  ctx.emitStore("i8", "0", emptyResult);
  ctx.emitBr(endLabel);

  ctx.emitLabel(notEmptyLabel);

  const initEnd = emitSub(ctx, "i32", strLenI32, "1");
  ctx.emitStore("i32", initEnd, endPtr);

  const findEndLabel = ctx.nextLabel("trimend_find");
  const findEndBodyLabel = ctx.nextLabel("trimend_find_body");
  const findEndCheckLabel = ctx.nextLabel("trimend_find_check");
  const findEndEndLabel = ctx.nextLabel("trimend_find_end");

  ctx.emitBr(findEndLabel);

  ctx.emitLabel(findEndLabel);
  const end = ctx.emitLoad("i32", endPtr);
  const endCond = ctx.emitIcmp("sge", "i32", end, "0");
  ctx.emitBrCond(endCond, findEndBodyLabel, findEndEndLabel);

  ctx.emitLabel(findEndBodyLabel);
  const endI64 = emitSext(ctx, end, "i32", "i64");
  const charPtr = ctx.nextTemp();
  ctx.emit(`${charPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${endI64}`);
  const ch = ctx.nextTemp();
  ctx.emit(`${ch} = load i8, i8* ${charPtr}`);

  const isSpace = ctx.emitIcmp("eq", "i8", ch, "32");
  const isTab = ctx.emitIcmp("eq", "i8", ch, "9");
  const isNewline = ctx.emitIcmp("eq", "i8", ch, "10");
  const isCR = ctx.emitIcmp("eq", "i8", ch, "13");

  const isWS1 = emitOr(ctx, "i1", isSpace, isTab);
  const isWS2 = emitOr(ctx, "i1", isWS1, isNewline);
  const isWhitespace = emitOr(ctx, "i1", isWS2, isCR);

  ctx.emitBrCond(isWhitespace, findEndCheckLabel, findEndEndLabel);

  ctx.emitLabel(findEndCheckLabel);
  const nextEnd = emitSub(ctx, "i32", end, "1");
  ctx.emitStore("i32", nextEnd, endPtr);
  ctx.emitBr(findEndLabel);

  ctx.emitLabel(findEndEndLabel);
  const finalEnd = ctx.emitLoad("i32", endPtr);

  const allWhitespace = ctx.emitIcmp("slt", "i32", finalEnd, "0");

  const allWSLabel = ctx.nextLabel("trimend_all_ws");
  const substrLabel = ctx.nextLabel("trimend_substr");

  ctx.emitBrCond(allWhitespace, allWSLabel, substrLabel);

  ctx.emitLabel(allWSLabel);
  const allWSResult = ctx.emitCall("i8*", "@cs_arena_alloc", "i64 1");
  ctx.emitStore("i8", "0", allWSResult);
  ctx.emitBr(endLabel);

  ctx.emitLabel(substrLabel);
  const trimmedLen = emitAdd(ctx, "i32", finalEnd, "1");
  const trimmedResult = generateSubstr(ctx, strPtr, "0", trimmedLen);
  ctx.emitBr(endLabel);

  ctx.emitLabel(endLabel);
  const result = ctx.nextTemp();
  ctx.emit(
    `${result} = phi i8* [ ${emptyResult}, %${emptyLabel} ], [ ${allWSResult}, %${allWSLabel} ], [ ${trimmedResult}, %${substrLabel} ]`,
  );
  ctx.setVariableType(result, "i8*");

  return result;
}

export function generateReplace(
  ctx: IGeneratorContext,
  strPtr: string,
  searchPtr: string,
  replacePtr: string,
): string {
  const foundPtr = ctx.emitCall("i8*", "@strstr", `i8* ${strPtr}, i8* ${searchPtr}`);

  const isNull = ctx.emitIcmp("eq", "i8*", foundPtr, "null");

  const foundLabel = ctx.nextLabel("replace_found");
  const notFoundLabel = ctx.nextLabel("replace_not_found");
  const endLabel = ctx.nextLabel("replace_end");

  ctx.emitBrCond(isNull, notFoundLabel, foundLabel);

  ctx.emitLabel(notFoundLabel);
  const originalDup = ctx.emitCall("i8*", "@strdup", `i8* ${strPtr}`);
  ctx.emitBr(endLabel);

  ctx.emitLabel(foundLabel);

  const strLen = ctx.emitCall("i64", "@strlen", `i8* ${strPtr}`);
  const searchLen = ctx.emitCall("i64", "@strlen", `i8* ${searchPtr}`);
  const replaceLen = ctx.emitCall("i64", "@strlen", `i8* ${replacePtr}`);

  const newLen = emitSub(ctx, "i64", strLen, searchLen);
  const newLen2 = emitAdd(ctx, "i64", newLen, replaceLen);
  const allocLen = emitAdd(ctx, "i64", newLen2, "1");

  const resultPtr = ctx.emitCall("i8*", "@cs_arena_alloc", `i64 ${allocLen}`);

  const prefixLen = emitPtrtoint(ctx, foundPtr, "i8*", "i64");
  const strStart = emitPtrtoint(ctx, strPtr, "i8*", "i64");
  const prefixBytes = emitSub(ctx, "i64", prefixLen, strStart);

  ctx.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${resultPtr}, i8* ${strPtr}, i64 ${prefixBytes}, i1 false)`,
  );

  // GEP without inbounds -- use emitGep
  const insertPos = ctx.emitGep("i8", resultPtr, `i64 ${prefixBytes}`);
  ctx.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${insertPos}, i8* ${replacePtr}, i64 ${replaceLen}, i1 false)`,
  );

  const suffixStart = ctx.emitGep("i8", foundPtr, `i64 ${searchLen}`);
  const suffixLen = ctx.emitCall("i64", "@strlen", `i8* ${suffixStart}`);
  const suffixLenPlus1 = emitAdd(ctx, "i64", suffixLen, "1");

  const suffixDest = ctx.emitGep("i8", insertPos, `i64 ${replaceLen}`);
  ctx.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${suffixDest}, i8* ${suffixStart}, i64 ${suffixLenPlus1}, i1 false)`,
  );

  ctx.emitBr(endLabel);

  ctx.emitLabel(endLabel);
  const result = ctx.nextTemp();
  ctx.emit(
    `${result} = phi i8* [ ${originalDup}, %${notFoundLabel} ], [ ${resultPtr}, %${foundLabel} ]`,
  );
  ctx.setVariableType(result, "i8*");

  return result;
}

export function generateReplaceAll(
  ctx: IGeneratorContext,
  strPtr: string,
  searchPtr: string,
  replacePtr: string,
): string {
  const resultPtr = ctx.nextTemp();
  ctx.emit(`${resultPtr} = alloca i8*`);

  const searchLen = ctx.emitCall("i64", "@strlen", `i8* ${searchPtr}`);
  const isEmpty = ctx.emitIcmp("eq", "i64", searchLen, "0");
  const emptyLabel = ctx.nextLabel("replaceall_empty");
  const doReplaceLabel = ctx.nextLabel("replaceall_do");
  const doneLabel = ctx.nextLabel("replaceall_done");
  ctx.emitBrCond(isEmpty, emptyLabel, doReplaceLabel);

  ctx.emitLabel(emptyLabel);
  const origDup = ctx.emitCall("i8*", "@strdup", `i8* ${strPtr}`);
  ctx.emitBr(doneLabel);

  ctx.emitLabel(doReplaceLabel);
  ctx.emitStore("i8*", strPtr, resultPtr);

  const loopLabel = ctx.nextLabel("replaceall_loop");
  const bodyLabel = ctx.nextLabel("replaceall_body");
  const endLabel = ctx.nextLabel("replaceall_end");

  ctx.emitBr(loopLabel);

  ctx.emitLabel(loopLabel);
  const currentStr = ctx.emitLoad("i8*", resultPtr);
  const foundPtr = ctx.emitCall("i8*", "@strstr", `i8* ${currentStr}, i8* ${searchPtr}`);
  const isNull = ctx.emitIcmp("eq", "i8*", foundPtr, "null");
  ctx.emitBrCond(isNull, endLabel, bodyLabel);

  ctx.emitLabel(bodyLabel);
  const replaced = generateReplace(ctx, currentStr, searchPtr, replacePtr);
  ctx.emitStore("i8*", replaced, resultPtr);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(endLabel);
  const loopResult = ctx.emitLoad("i8*", resultPtr);
  ctx.emitBr(doneLabel);

  ctx.emitLabel(doneLabel);
  const result = ctx.nextTemp();
  ctx.emit(`${result} = phi i8* [ ${origDup}, %${emptyLabel} ], [ ${loopResult}, %${endLabel} ]`);
  ctx.setVariableType(result, "i8*");

  return result;
}

export function generateToUpperCase(ctx: IGeneratorContext, strPtr: string): string {
  const resultPtr = ctx.emitCall("i8*", "@cs_to_upper_alloc", `i8* ${strPtr}`);
  ctx.setVariableType(resultPtr, "i8*");
  return resultPtr;
}

export function generateToLowerCase(ctx: IGeneratorContext, strPtr: string): string {
  const resultPtr = ctx.emitCall("i8*", "@cs_to_lower_alloc", `i8* ${strPtr}`);
  ctx.setVariableType(resultPtr, "i8*");
  return resultPtr;
}
