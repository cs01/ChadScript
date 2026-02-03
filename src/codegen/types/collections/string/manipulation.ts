import { IGeneratorContext } from '../../../infrastructure/generator-context.js';

// ============================================
// STRING MANIPULATION - Substring, slice, repeat, pad, trim operations
// ============================================

export function generateSubstr(ctx: IGeneratorContext, strPtr: string, startIndex: string, length: string | null): string {
  const strLen = ctx.nextTemp();
  ctx.emit(`${strLen} = call i64 @strlen(i8* ${strPtr})`);
  const strLenI32 = ctx.nextTemp();
  ctx.emit(`${strLenI32} = trunc i64 ${strLen} to i32`);

  const startI32 = startIndex;

  let substrLen: string;
  if (length === null) {
    substrLen = ctx.nextTemp();
    ctx.emit(`${substrLen} = sub i32 ${strLenI32}, ${startI32}`);
  } else {
    substrLen = length;
  }

  const remainingLen = ctx.nextTemp();
  ctx.emit(`${remainingLen} = sub i32 ${strLenI32}, ${startI32}`);

  const isLenTooLarge = ctx.nextTemp();
  ctx.emit(`${isLenTooLarge} = icmp sgt i32 ${substrLen}, ${remainingLen}`);

  const clampedLen = ctx.nextTemp();
  ctx.emit(`${clampedLen} = select i1 ${isLenTooLarge}, i32 ${remainingLen}, i32 ${substrLen}`);

  const isNegative = ctx.nextTemp();
  ctx.emit(`${isNegative} = icmp slt i32 ${clampedLen}, 0`);

  const finalLen = ctx.nextTemp();
  ctx.emit(`${finalLen} = select i1 ${isNegative}, i32 0, i32 ${clampedLen}`);

  const finalLenI64 = ctx.nextTemp();
  ctx.emit(`${finalLenI64} = sext i32 ${finalLen} to i64`);

  const allocLen = ctx.nextTemp();
  ctx.emit(`${allocLen} = add i64 ${finalLenI64}, 1`);

  const resultPtr = ctx.nextTemp();
  ctx.emit(`${resultPtr} = call i8* @GC_malloc_atomic(i64 ${allocLen})`);

  const startI64 = ctx.nextTemp();
  ctx.emit(`${startI64} = sext i32 ${startI32} to i64`);

  const srcPtr = ctx.nextTemp();
  ctx.emit(`${srcPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${startI64}`);

  ctx.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${resultPtr}, i8* ${srcPtr}, i64 ${finalLenI64}, i1 false)`);

  const nullPtr = ctx.nextTemp();
  ctx.emit(`${nullPtr} = getelementptr inbounds i8, i8* ${resultPtr}, i64 ${finalLenI64}`);
  ctx.emit(`store i8 0, i8* ${nullPtr}`);

  return resultPtr;
}

export function generateRepeat(ctx: IGeneratorContext, strPtr: string, count: string): string {
  const strLen = ctx.nextTemp();
  ctx.emit(`${strLen} = call i64 @strlen(i8* ${strPtr})`);

  const countI64 = ctx.nextTemp();
  ctx.emit(`${countI64} = sext i32 ${count} to i64`);

  const totalLen = ctx.nextTemp();
  ctx.emit(`${totalLen} = mul i64 ${strLen}, ${countI64}`);

  const allocLen = ctx.nextTemp();
  ctx.emit(`${allocLen} = add i64 ${totalLen}, 1`);

  const resultPtr = ctx.nextTemp();
  ctx.emit(`${resultPtr} = call i8* @GC_malloc_atomic(i64 ${allocLen})`);

  ctx.emit(`store i8 0, i8* ${resultPtr}`);

  const loopLabel = ctx.nextLabel('repeat_loop');
  const loopBodyLabel = ctx.nextLabel('repeat_body');
  const loopEndLabel = ctx.nextLabel('repeat_end');

  const counterPtr = ctx.nextTemp();
  ctx.emit(`${counterPtr} = alloca i32`);
  ctx.emit(`store i32 0, i32* ${counterPtr}`);

  ctx.emit(`br label %${loopLabel}`);

  ctx.emit(`${loopLabel}:`);
  const counterVal = ctx.nextTemp();
  ctx.emit(`${counterVal} = load i32, i32* ${counterPtr}`);
  const loopCond = ctx.nextTemp();
  ctx.emit(`${loopCond} = icmp slt i32 ${counterVal}, ${count}`);
  ctx.emit(`br i1 ${loopCond}, label %${loopBodyLabel}, label %${loopEndLabel}`);

  ctx.emit(`${loopBodyLabel}:`);
  const strcatResult = ctx.nextTemp();
  ctx.emit(`${strcatResult} = call i8* @strcat(i8* ${resultPtr}, i8* ${strPtr})`);

  const nextCounter = ctx.nextTemp();
  ctx.emit(`${nextCounter} = add i32 ${counterVal}, 1`);
  ctx.emit(`store i32 ${nextCounter}, i32* ${counterPtr}`);
  ctx.emit(`br label %${loopLabel}`);

  ctx.emit(`${loopEndLabel}:`);

  return resultPtr;
}

export function generatePadStart(ctx: IGeneratorContext, strPtr: string, targetLength: string, padString: string): string {
  const strLen = ctx.nextTemp();
  ctx.emit(`${strLen} = call i64 @strlen(i8* ${strPtr})`);
  const strLenI32 = ctx.nextTemp();
  ctx.emit(`${strLenI32} = trunc i64 ${strLen} to i32`);

  const padLen = ctx.nextTemp();
  ctx.emit(`${padLen} = call i64 @strlen(i8* ${padString})`);
  const padLenI32 = ctx.nextTemp();
  ctx.emit(`${padLenI32} = trunc i64 ${padLen} to i32`);

  const paddingNeeded = ctx.nextTemp();
  ctx.emit(`${paddingNeeded} = sub i32 ${targetLength}, ${strLenI32}`);

  const needsPadding = ctx.nextTemp();
  ctx.emit(`${needsPadding} = icmp sgt i32 ${paddingNeeded}, 0`);

  const noPadLabel = ctx.nextLabel('padstart_nopad');
  const doPadLabel = ctx.nextLabel('padstart_dopad');
  const endLabel = ctx.nextLabel('padstart_end');

  ctx.emit(`br i1 ${needsPadding}, label %${doPadLabel}, label %${noPadLabel}`);

  ctx.emit(`${noPadLabel}:`);
  const targetLenI64NoPad = ctx.nextTemp();
  ctx.emit(`${targetLenI64NoPad} = sext i32 ${targetLength} to i64`);
  const allocLen1 = ctx.nextTemp();
  ctx.emit(`${allocLen1} = add i64 ${targetLenI64NoPad}, 1`);
  const noPadResult = ctx.nextTemp();
  ctx.emit(`${noPadResult} = call i8* @GC_malloc_atomic(i64 ${allocLen1})`);
  const strcpyResult1 = ctx.nextTemp();
  ctx.emit(`${strcpyResult1} = call i8* @strcpy(i8* ${noPadResult}, i8* ${strPtr})`);
  ctx.emit(`br label %${endLabel}`);

  ctx.emit(`${doPadLabel}:`);
  const targetLenI64Pad = ctx.nextTemp();
  ctx.emit(`${targetLenI64Pad} = sext i32 ${targetLength} to i64`);
  const allocLen2 = ctx.nextTemp();
  ctx.emit(`${allocLen2} = add i64 ${targetLenI64Pad}, 1`);
  const padResult = ctx.nextTemp();
  ctx.emit(`${padResult} = call i8* @GC_malloc_atomic(i64 ${allocLen2})`);

  ctx.emit(`store i8 0, i8* ${padResult}`);

  const fullPads = ctx.nextTemp();
  ctx.emit(`${fullPads} = sdiv i32 ${paddingNeeded}, ${padLenI32}`);

  const remainingPad = ctx.nextTemp();
  ctx.emit(`${remainingPad} = srem i32 ${paddingNeeded}, ${padLenI32}`);

  const padLoopLabel = ctx.nextLabel('padstart_loop');
  const padLoopBodyLabel = ctx.nextLabel('padstart_loop_body');
  const padLoopEndLabel = ctx.nextLabel('padstart_loop_end');

  const padCounterPtr = ctx.nextTemp();
  ctx.emit(`${padCounterPtr} = alloca i32`);
  ctx.emit(`store i32 0, i32* ${padCounterPtr}`);
  ctx.emit(`br label %${padLoopLabel}`);

  ctx.emit(`${padLoopLabel}:`);
  const padCounterVal = ctx.nextTemp();
  ctx.emit(`${padCounterVal} = load i32, i32* ${padCounterPtr}`);
  const padLoopCond = ctx.nextTemp();
  ctx.emit(`${padLoopCond} = icmp slt i32 ${padCounterVal}, ${fullPads}`);
  ctx.emit(`br i1 ${padLoopCond}, label %${padLoopBodyLabel}, label %${padLoopEndLabel}`);

  ctx.emit(`${padLoopBodyLabel}:`);
  const strcatPad = ctx.nextTemp();
  ctx.emit(`${strcatPad} = call i8* @strcat(i8* ${padResult}, i8* ${padString})`);
  const nextPadCounter = ctx.nextTemp();
  ctx.emit(`${nextPadCounter} = add i32 ${padCounterVal}, 1`);
  ctx.emit(`store i32 ${nextPadCounter}, i32* ${padCounterPtr}`);
  ctx.emit(`br label %${padLoopLabel}`);

  ctx.emit(`${padLoopEndLabel}:`);

  const hasRemaining = ctx.nextTemp();
  ctx.emit(`${hasRemaining} = icmp sgt i32 ${remainingPad}, 0`);

  const addRemainingLabel = ctx.nextLabel('padstart_add_remaining');
  const skipRemainingLabel = ctx.nextLabel('padstart_skip_remaining');

  ctx.emit(`br i1 ${hasRemaining}, label %${addRemainingLabel}, label %${skipRemainingLabel}`);

  ctx.emit(`${addRemainingLabel}:`);
  const remainingSubstr = generateSubstr(ctx, padString, '0', remainingPad);
  const strcatRemaining = ctx.nextTemp();
  ctx.emit(`${strcatRemaining} = call i8* @strcat(i8* ${padResult}, i8* ${remainingSubstr})`);
  ctx.emit(`br label %${skipRemainingLabel}`);

  ctx.emit(`${skipRemainingLabel}:`);

  const finalResult = ctx.nextTemp();
  ctx.emit(`${finalResult} = call i8* @strcat(i8* ${padResult}, i8* ${strPtr})`);
  ctx.emit(`br label %${endLabel}`);

  ctx.emit(`${endLabel}:`);
  const result = ctx.nextTemp();
  ctx.emit(`${result} = phi i8* [ ${noPadResult}, %${noPadLabel} ], [ ${padResult}, %${skipRemainingLabel} ]`);
  ctx.setVariableType(result, 'i8*');

  return result;
}

export function generateSlice(ctx: IGeneratorContext, strPtr: string, startIndex: string, endIndex: string | null): string {
  const strLen = ctx.nextTemp();
  ctx.emit(`${strLen} = call i64 @strlen(i8* ${strPtr})`);
  const strLenI32 = ctx.nextTemp();
  ctx.emit(`${strLenI32} = trunc i64 ${strLen} to i32`);

  const startIsNegative = ctx.nextTemp();
  ctx.emit(`${startIsNegative} = icmp slt i32 ${startIndex}, 0`);

  const adjustedStart1 = ctx.nextTemp();
  ctx.emit(`${adjustedStart1} = add i32 ${strLenI32}, ${startIndex}`);

  const adjustedStart2 = ctx.nextTemp();
  ctx.emit(`${adjustedStart2} = select i1 ${startIsNegative}, i32 ${adjustedStart1}, i32 ${startIndex}`);

  const startTooSmall = ctx.nextTemp();
  ctx.emit(`${startTooSmall} = icmp slt i32 ${adjustedStart2}, 0`);
  const clampedStart1 = ctx.nextTemp();
  ctx.emit(`${clampedStart1} = select i1 ${startTooSmall}, i32 0, i32 ${adjustedStart2}`);

  const startTooBig = ctx.nextTemp();
  ctx.emit(`${startTooBig} = icmp sgt i32 ${clampedStart1}, ${strLenI32}`);
  const finalStart = ctx.nextTemp();
  ctx.emit(`${finalStart} = select i1 ${startTooBig}, i32 ${strLenI32}, i32 ${clampedStart1}`);

  let finalEnd: string;
  if (endIndex === null) {
    finalEnd = strLenI32;
  } else {
    const endIsNegative = ctx.nextTemp();
    ctx.emit(`${endIsNegative} = icmp slt i32 ${endIndex}, 0`);

    const adjustedEnd1 = ctx.nextTemp();
    ctx.emit(`${adjustedEnd1} = add i32 ${strLenI32}, ${endIndex}`);

    const adjustedEnd2 = ctx.nextTemp();
    ctx.emit(`${adjustedEnd2} = select i1 ${endIsNegative}, i32 ${adjustedEnd1}, i32 ${endIndex}`);

    const endTooSmall = ctx.nextTemp();
    ctx.emit(`${endTooSmall} = icmp slt i32 ${adjustedEnd2}, 0`);
    const clampedEnd1 = ctx.nextTemp();
    ctx.emit(`${clampedEnd1} = select i1 ${endTooSmall}, i32 0, i32 ${adjustedEnd2}`);

    const endTooBig = ctx.nextTemp();
    ctx.emit(`${endTooBig} = icmp sgt i32 ${clampedEnd1}, ${strLenI32}`);
    finalEnd = ctx.nextTemp();
    ctx.emit(`${finalEnd} = select i1 ${endTooBig}, i32 ${strLenI32}, i32 ${clampedEnd1}`);
  }

  const sliceLen = ctx.nextTemp();
  ctx.emit(`${sliceLen} = sub i32 ${finalEnd}, ${finalStart}`);

  const lenIsNegative = ctx.nextTemp();
  ctx.emit(`${lenIsNegative} = icmp slt i32 ${sliceLen}, 0`);
  const finalLen = ctx.nextTemp();
  ctx.emit(`${finalLen} = select i1 ${lenIsNegative}, i32 0, i32 ${sliceLen}`);

  return generateSubstr(ctx, strPtr, finalStart, finalLen);
}

export function generateTrim(ctx: IGeneratorContext, strPtr: string): string {
  const strLen = ctx.nextTemp();
  ctx.emit(`${strLen} = call i64 @strlen(i8* ${strPtr})`);
  const strLenI32 = ctx.nextTemp();
  ctx.emit(`${strLenI32} = trunc i64 ${strLen} to i32`);

  const isEmpty = ctx.nextTemp();
  ctx.emit(`${isEmpty} = icmp eq i32 ${strLenI32}, 0`);

  const emptyLabel = ctx.nextLabel('trim_empty');
  const notEmptyLabel = ctx.nextLabel('trim_notempty');
  const endLabel = ctx.nextLabel('trim_end');

  ctx.emit(`br i1 ${isEmpty}, label %${emptyLabel}, label %${notEmptyLabel}`);

  ctx.emit(`${emptyLabel}:`);
  const emptyResult = ctx.nextTemp();
  ctx.emit(`${emptyResult} = call i8* @GC_malloc_atomic(i64 1)`);
  ctx.emit(`store i8 0, i8* ${emptyResult}`);
  ctx.emit(`br label %${endLabel}`);

  ctx.emit(`${notEmptyLabel}:`);

  const startPtr = ctx.nextTemp();
  ctx.emit(`${startPtr} = alloca i32`);
  ctx.emit(`store i32 0, i32* ${startPtr}`);

  const findStartLabel = ctx.nextLabel('trim_find_start');
  const findStartBodyLabel = ctx.nextLabel('trim_find_start_body');
  const findStartCheckLabel = ctx.nextLabel('trim_find_start_check');
  const findStartEndLabel = ctx.nextLabel('trim_find_start_end');

  ctx.emit(`br label %${findStartLabel}`);

  ctx.emit(`${findStartLabel}:`);
  const start = ctx.nextTemp();
  ctx.emit(`${start} = load i32, i32* ${startPtr}`);
  const startCond = ctx.nextTemp();
  ctx.emit(`${startCond} = icmp slt i32 ${start}, ${strLenI32}`);
  ctx.emit(`br i1 ${startCond}, label %${findStartBodyLabel}, label %${findStartEndLabel}`);

  ctx.emit(`${findStartBodyLabel}:`);
  const startI64 = ctx.nextTemp();
  ctx.emit(`${startI64} = sext i32 ${start} to i64`);
  const charPtr1 = ctx.nextTemp();
  ctx.emit(`${charPtr1} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${startI64}`);
  const char1 = ctx.nextTemp();
  ctx.emit(`${char1} = load i8, i8* ${charPtr1}`);

  const isSpace = ctx.nextTemp();
  ctx.emit(`${isSpace} = icmp eq i8 ${char1}, 32`);
  const isTab = ctx.nextTemp();
  ctx.emit(`${isTab} = icmp eq i8 ${char1}, 9`);
  const isNewline = ctx.nextTemp();
  ctx.emit(`${isNewline} = icmp eq i8 ${char1}, 10`);
  const isCR = ctx.nextTemp();
  ctx.emit(`${isCR} = icmp eq i8 ${char1}, 13`);

  const isWS1 = ctx.nextTemp();
  ctx.emit(`${isWS1} = or i1 ${isSpace}, ${isTab}`);
  const isWS2 = ctx.nextTemp();
  ctx.emit(`${isWS2} = or i1 ${isWS1}, ${isNewline}`);
  const isWhitespace = ctx.nextTemp();
  ctx.emit(`${isWhitespace} = or i1 ${isWS2}, ${isCR}`);

  ctx.emit(`br i1 ${isWhitespace}, label %${findStartCheckLabel}, label %${findStartEndLabel}`);

  ctx.emit(`${findStartCheckLabel}:`);
  const nextStart = ctx.nextTemp();
  ctx.emit(`${nextStart} = add i32 ${start}, 1`);
  ctx.emit(`store i32 ${nextStart}, i32* ${startPtr}`);
  ctx.emit(`br label %${findStartLabel}`);

  ctx.emit(`${findStartEndLabel}:`);
  const finalStart = ctx.nextTemp();
  ctx.emit(`${finalStart} = load i32, i32* ${startPtr}`);

  const allWhitespace = ctx.nextTemp();
  ctx.emit(`${allWhitespace} = icmp eq i32 ${finalStart}, ${strLenI32}`);

  const allWSLabel = ctx.nextLabel('trim_all_ws');
  const findEndLabel = ctx.nextLabel('trim_find_end');

  ctx.emit(`br i1 ${allWhitespace}, label %${allWSLabel}, label %${findEndLabel}`);

  ctx.emit(`${allWSLabel}:`);
  const allWSResult = ctx.nextTemp();
  ctx.emit(`${allWSResult} = call i8* @GC_malloc_atomic(i64 1)`);
  ctx.emit(`store i8 0, i8* ${allWSResult}`);
  ctx.emit(`br label %${endLabel}`);

  ctx.emit(`${findEndLabel}:`);
  const endPtr = ctx.nextTemp();
  ctx.emit(`${endPtr} = alloca i32`);
  const initEnd = ctx.nextTemp();
  ctx.emit(`${initEnd} = sub i32 ${strLenI32}, 1`);
  ctx.emit(`store i32 ${initEnd}, i32* ${endPtr}`);

  const findEndLoopLabel = ctx.nextLabel('trim_find_end_loop');
  const findEndBodyLabel = ctx.nextLabel('trim_find_end_body');
  const findEndCheckLabel = ctx.nextLabel('trim_find_end_check');
  const findEndEndLabel = ctx.nextLabel('trim_find_end_end');

  ctx.emit(`br label %${findEndLoopLabel}`);

  ctx.emit(`${findEndLoopLabel}:`);
  const end = ctx.nextTemp();
  ctx.emit(`${end} = load i32, i32* ${endPtr}`);
  const endCond = ctx.nextTemp();
  ctx.emit(`${endCond} = icmp sge i32 ${end}, ${finalStart}`);
  ctx.emit(`br i1 ${endCond}, label %${findEndBodyLabel}, label %${findEndEndLabel}`);

  ctx.emit(`${findEndBodyLabel}:`);
  const endI64 = ctx.nextTemp();
  ctx.emit(`${endI64} = sext i32 ${end} to i64`);
  const charPtr2 = ctx.nextTemp();
  ctx.emit(`${charPtr2} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${endI64}`);
  const char2 = ctx.nextTemp();
  ctx.emit(`${char2} = load i8, i8* ${charPtr2}`);

  const isSpace2 = ctx.nextTemp();
  ctx.emit(`${isSpace2} = icmp eq i8 ${char2}, 32`);
  const isTab2 = ctx.nextTemp();
  ctx.emit(`${isTab2} = icmp eq i8 ${char2}, 9`);
  const isNewline2 = ctx.nextTemp();
  ctx.emit(`${isNewline2} = icmp eq i8 ${char2}, 10`);
  const isCR2 = ctx.nextTemp();
  ctx.emit(`${isCR2} = icmp eq i8 ${char2}, 13`);

  const isWS3 = ctx.nextTemp();
  ctx.emit(`${isWS3} = or i1 ${isSpace2}, ${isTab2}`);
  const isWS4 = ctx.nextTemp();
  ctx.emit(`${isWS4} = or i1 ${isWS3}, ${isNewline2}`);
  const isWhitespace2 = ctx.nextTemp();
  ctx.emit(`${isWhitespace2} = or i1 ${isWS4}, ${isCR2}`);

  ctx.emit(`br i1 ${isWhitespace2}, label %${findEndCheckLabel}, label %${findEndEndLabel}`);

  ctx.emit(`${findEndCheckLabel}:`);
  const nextEnd = ctx.nextTemp();
  ctx.emit(`${nextEnd} = sub i32 ${end}, 1`);
  ctx.emit(`store i32 ${nextEnd}, i32* ${endPtr}`);
  ctx.emit(`br label %${findEndLoopLabel}`);

  ctx.emit(`${findEndEndLabel}:`);
  const finalEnd = ctx.nextTemp();
  ctx.emit(`${finalEnd} = load i32, i32* ${endPtr}`);

  const trimmedLen = ctx.nextTemp();
  ctx.emit(`${trimmedLen} = sub i32 ${finalEnd}, ${finalStart}`);
  const trimmedLenPlus1 = ctx.nextTemp();
  ctx.emit(`${trimmedLenPlus1} = add i32 ${trimmedLen}, 1`);

  const trimmedResult = generateSubstr(ctx, strPtr, finalStart, trimmedLenPlus1);
  ctx.emit(`br label %${endLabel}`);

  ctx.emit(`${endLabel}:`);
  const result = ctx.nextTemp();
  ctx.emit(`${result} = phi i8* [ ${emptyResult}, %${emptyLabel} ], [ ${allWSResult}, %${allWSLabel} ], [ ${trimmedResult}, %${findEndEndLabel} ]`);
  ctx.setVariableType(result, 'i8*');

  return result;
}

export function generateReplace(ctx: IGeneratorContext, strPtr: string, searchPtr: string, replacePtr: string): string {
  const foundPtr = ctx.nextTemp();
  ctx.emit(`${foundPtr} = call i8* @strstr(i8* ${strPtr}, i8* ${searchPtr})`);

  const isNull = ctx.nextTemp();
  ctx.emit(`${isNull} = icmp eq i8* ${foundPtr}, null`);

  const foundLabel = ctx.nextLabel('replace_found');
  const notFoundLabel = ctx.nextLabel('replace_not_found');
  const endLabel = ctx.nextLabel('replace_end');

  ctx.emit(`br i1 ${isNull}, label %${notFoundLabel}, label %${foundLabel}`);

  ctx.emit(`${notFoundLabel}:`);
  const originalDup = ctx.nextTemp();
  ctx.emit(`${originalDup} = call i8* @strdup(i8* ${strPtr})`);
  ctx.emit(`br label %${endLabel}`);

  ctx.emit(`${foundLabel}:`);

  const strLen = ctx.nextTemp();
  ctx.emit(`${strLen} = call i64 @strlen(i8* ${strPtr})`);
  const searchLen = ctx.nextTemp();
  ctx.emit(`${searchLen} = call i64 @strlen(i8* ${searchPtr})`);
  const replaceLen = ctx.nextTemp();
  ctx.emit(`${replaceLen} = call i64 @strlen(i8* ${replacePtr})`);

  const newLen = ctx.nextTemp();
  ctx.emit(`${newLen} = sub i64 ${strLen}, ${searchLen}`);
  const newLen2 = ctx.nextTemp();
  ctx.emit(`${newLen2} = add i64 ${newLen}, ${replaceLen}`);
  const allocLen = ctx.nextTemp();
  ctx.emit(`${allocLen} = add i64 ${newLen2}, 1`);

  const resultPtr = ctx.nextTemp();
  ctx.emit(`${resultPtr} = call i8* @GC_malloc_atomic(i64 ${allocLen})`);

  const prefixLen = ctx.nextTemp();
  ctx.emit(`${prefixLen} = ptrtoint i8* ${foundPtr} to i64`);
  const strStart = ctx.nextTemp();
  ctx.emit(`${strStart} = ptrtoint i8* ${strPtr} to i64`);
  const prefixBytes = ctx.nextTemp();
  ctx.emit(`${prefixBytes} = sub i64 ${prefixLen}, ${strStart}`);

  ctx.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${resultPtr}, i8* ${strPtr}, i64 ${prefixBytes}, i1 false)`);

  const insertPos = ctx.nextTemp();
  ctx.emit(`${insertPos} = getelementptr i8, i8* ${resultPtr}, i64 ${prefixBytes}`);
  ctx.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${insertPos}, i8* ${replacePtr}, i64 ${replaceLen}, i1 false)`);

  const suffixStart = ctx.nextTemp();
  ctx.emit(`${suffixStart} = getelementptr i8, i8* ${foundPtr}, i64 ${searchLen}`);
  const suffixLen = ctx.nextTemp();
  ctx.emit(`${suffixLen} = call i64 @strlen(i8* ${suffixStart})`);
  const suffixLenPlus1 = ctx.nextTemp();
  ctx.emit(`${suffixLenPlus1} = add i64 ${suffixLen}, 1`);

  const suffixDest = ctx.nextTemp();
  ctx.emit(`${suffixDest} = getelementptr i8, i8* ${insertPos}, i64 ${replaceLen}`);
  ctx.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${suffixDest}, i8* ${suffixStart}, i64 ${suffixLenPlus1}, i1 false)`);

  ctx.emit(`br label %${endLabel}`);

  ctx.emit(`${endLabel}:`);
  const result = ctx.nextTemp();
  ctx.emit(`${result} = phi i8* [ ${originalDup}, %${notFoundLabel} ], [ ${resultPtr}, %${foundLabel} ]`);
  ctx.setVariableType(result, 'i8*');

  return result;
}

export function generateReplaceAll(ctx: IGeneratorContext, strPtr: string, searchPtr: string, replacePtr: string): string {
  const resultPtr = ctx.nextTemp();
  ctx.emit(`${resultPtr} = alloca i8*`);
  ctx.emit(`store i8* ${strPtr}, i8** ${resultPtr}`);

  const loopLabel = ctx.nextLabel('replaceall_loop');
  const bodyLabel = ctx.nextLabel('replaceall_body');
  const endLabel = ctx.nextLabel('replaceall_end');

  ctx.emit(`br label %${loopLabel}`);

  ctx.emit(`${loopLabel}:`);
  const currentStr = ctx.nextTemp();
  ctx.emit(`${currentStr} = load i8*, i8** ${resultPtr}`);
  const foundPtr = ctx.nextTemp();
  ctx.emit(`${foundPtr} = call i8* @strstr(i8* ${currentStr}, i8* ${searchPtr})`);
  const isNull = ctx.nextTemp();
  ctx.emit(`${isNull} = icmp eq i8* ${foundPtr}, null`);
  ctx.emit(`br i1 ${isNull}, label %${endLabel}, label %${bodyLabel}`);

  ctx.emit(`${bodyLabel}:`);
  const replaced = generateReplace(ctx, currentStr, searchPtr, replacePtr);
  ctx.emit(`store i8* ${replaced}, i8** ${resultPtr}`);
  ctx.emit(`br label %${loopLabel}`);

  ctx.emit(`${endLabel}:`);
  const result = ctx.nextTemp();
  ctx.emit(`${result} = load i8*, i8** ${resultPtr}`);
  ctx.setVariableType(result, 'i8*');

  return result;
}

export function generateToUpperCase(ctx: IGeneratorContext, strPtr: string): string {
  const strLen = ctx.nextTemp();
  ctx.emit(`${strLen} = call i64 @strlen(i8* ${strPtr})`);

  const allocLen = ctx.nextTemp();
  ctx.emit(`${allocLen} = add i64 ${strLen}, 1`);

  const resultPtr = ctx.nextTemp();
  ctx.emit(`${resultPtr} = call i8* @GC_malloc_atomic(i64 ${allocLen})`);

  const idxPtr = ctx.nextTemp();
  ctx.emit(`${idxPtr} = alloca i64, align 8`);
  ctx.emit(`store i64 0, i64* ${idxPtr}`);

  const loopLabel = ctx.nextLabel('toupper_loop');
  const bodyLabel = ctx.nextLabel('toupper_body');
  const endLabel = ctx.nextLabel('toupper_end');

  ctx.emit(`br label %${loopLabel}`);

  ctx.emit(`${loopLabel}:`);
  const idx = ctx.nextTemp();
  ctx.emit(`${idx} = load i64, i64* ${idxPtr}`);
  const cond = ctx.nextTemp();
  ctx.emit(`${cond} = icmp slt i64 ${idx}, ${strLen}`);
  ctx.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

  ctx.emit(`${bodyLabel}:`);
  const srcPtr = ctx.nextTemp();
  ctx.emit(`${srcPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${idx}`);
  const ch = ctx.nextTemp();
  ctx.emit(`${ch} = load i8, i8* ${srcPtr}`);

  const isLowerA = ctx.nextTemp();
  ctx.emit(`${isLowerA} = icmp sge i8 ${ch}, 97`);
  const isLowerZ = ctx.nextTemp();
  ctx.emit(`${isLowerZ} = icmp sle i8 ${ch}, 122`);
  const isLower = ctx.nextTemp();
  ctx.emit(`${isLower} = and i1 ${isLowerA}, ${isLowerZ}`);

  const upperCh = ctx.nextTemp();
  ctx.emit(`${upperCh} = sub i8 ${ch}, 32`);
  const finalCh = ctx.nextTemp();
  ctx.emit(`${finalCh} = select i1 ${isLower}, i8 ${upperCh}, i8 ${ch}`);

  const dstPtr = ctx.nextTemp();
  ctx.emit(`${dstPtr} = getelementptr inbounds i8, i8* ${resultPtr}, i64 ${idx}`);
  ctx.emit(`store i8 ${finalCh}, i8* ${dstPtr}`);

  const nextIdx = ctx.nextTemp();
  ctx.emit(`${nextIdx} = add i64 ${idx}, 1`);
  ctx.emit(`store i64 ${nextIdx}, i64* ${idxPtr}`);
  ctx.emit(`br label %${loopLabel}`);

  ctx.emit(`${endLabel}:`);
  const nullPtr = ctx.nextTemp();
  ctx.emit(`${nullPtr} = getelementptr inbounds i8, i8* ${resultPtr}, i64 ${strLen}`);
  ctx.emit(`store i8 0, i8* ${nullPtr}`);

  ctx.setVariableType(resultPtr, 'i8*');
  return resultPtr;
}

export function generateToLowerCase(ctx: IGeneratorContext, strPtr: string): string {
  const strLen = ctx.nextTemp();
  ctx.emit(`${strLen} = call i64 @strlen(i8* ${strPtr})`);

  const allocLen = ctx.nextTemp();
  ctx.emit(`${allocLen} = add i64 ${strLen}, 1`);

  const resultPtr = ctx.nextTemp();
  ctx.emit(`${resultPtr} = call i8* @GC_malloc_atomic(i64 ${allocLen})`);

  const idxPtr = ctx.nextTemp();
  ctx.emit(`${idxPtr} = alloca i64, align 8`);
  ctx.emit(`store i64 0, i64* ${idxPtr}`);

  const loopLabel = ctx.nextLabel('tolower_loop');
  const bodyLabel = ctx.nextLabel('tolower_body');
  const endLabel = ctx.nextLabel('tolower_end');

  ctx.emit(`br label %${loopLabel}`);

  ctx.emit(`${loopLabel}:`);
  const idx = ctx.nextTemp();
  ctx.emit(`${idx} = load i64, i64* ${idxPtr}`);
  const cond = ctx.nextTemp();
  ctx.emit(`${cond} = icmp slt i64 ${idx}, ${strLen}`);
  ctx.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

  ctx.emit(`${bodyLabel}:`);
  const srcPtr = ctx.nextTemp();
  ctx.emit(`${srcPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${idx}`);
  const ch = ctx.nextTemp();
  ctx.emit(`${ch} = load i8, i8* ${srcPtr}`);

  const isUpperA = ctx.nextTemp();
  ctx.emit(`${isUpperA} = icmp sge i8 ${ch}, 65`);
  const isUpperZ = ctx.nextTemp();
  ctx.emit(`${isUpperZ} = icmp sle i8 ${ch}, 90`);
  const isUpper = ctx.nextTemp();
  ctx.emit(`${isUpper} = and i1 ${isUpperA}, ${isUpperZ}`);

  const lowerCh = ctx.nextTemp();
  ctx.emit(`${lowerCh} = add i8 ${ch}, 32`);
  const finalCh = ctx.nextTemp();
  ctx.emit(`${finalCh} = select i1 ${isUpper}, i8 ${lowerCh}, i8 ${ch}`);

  const dstPtr = ctx.nextTemp();
  ctx.emit(`${dstPtr} = getelementptr inbounds i8, i8* ${resultPtr}, i64 ${idx}`);
  ctx.emit(`store i8 ${finalCh}, i8* ${dstPtr}`);

  const nextIdx = ctx.nextTemp();
  ctx.emit(`${nextIdx} = add i64 ${idx}, 1`);
  ctx.emit(`store i64 ${nextIdx}, i64* ${idxPtr}`);
  ctx.emit(`br label %${loopLabel}`);

  ctx.emit(`${endLabel}:`);
  const nullPtr = ctx.nextTemp();
  ctx.emit(`${nullPtr} = getelementptr inbounds i8, i8* ${resultPtr}, i64 ${strLen}`);
  ctx.emit(`store i8 0, i8* ${nullPtr}`);

  ctx.setVariableType(resultPtr, 'i8*');
  return resultPtr;
}
