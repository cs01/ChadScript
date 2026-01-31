import { BaseGenerator } from '../../../infrastructure/base-generator.js';

// ============================================
// STRING MANIPULATION - Substring, slice, repeat, pad, trim operations
// ============================================

export function generateSubstr(this: BaseGenerator, strPtr: string, startIndex: string, length: string | null): string {
  // Get the original string length
  const strLen = this.nextTemp();
  this.emit(`${strLen} = call i64 @strlen(i8* ${strPtr})`);
  const strLenI32 = this.nextTemp();
  this.emit(`${strLenI32} = trunc i64 ${strLen} to i32`);

  // Calculate the actual start position (handle negative indices)
  const startI32 = startIndex;

  // If length is not provided, calculate length as (strLen - start)
  let substrLen: string;
  if (length === null) {
    substrLen = this.nextTemp();
    this.emit(`${substrLen} = sub i32 ${strLenI32}, ${startI32}`);
  } else {
    substrLen = length;
  }

  // Clamp substrLen to ensure it doesn't exceed remaining string length
  const remainingLen = this.nextTemp();
  this.emit(`${remainingLen} = sub i32 ${strLenI32}, ${startI32}`);

  const isLenTooLarge = this.nextTemp();
  this.emit(`${isLenTooLarge} = icmp sgt i32 ${substrLen}, ${remainingLen}`);

  const clampedLen = this.nextTemp();
  this.emit(`${clampedLen} = select i1 ${isLenTooLarge}, i32 ${remainingLen}, i32 ${substrLen}`);

  // Ensure length is non-negative
  const isNegative = this.nextTemp();
  this.emit(`${isNegative} = icmp slt i32 ${clampedLen}, 0`);

  const finalLen = this.nextTemp();
  this.emit(`${finalLen} = select i1 ${isNegative}, i32 0, i32 ${clampedLen}`);

  // Convert finalLen to i64 for allocation
  const finalLenI64 = this.nextTemp();
  this.emit(`${finalLenI64} = sext i32 ${finalLen} to i64`);

  // Allocate memory for the substring (+1 for null terminator)
  const allocLen = this.nextTemp();
  this.emit(`${allocLen} = add i64 ${finalLenI64}, 1`);

  const resultPtr = this.nextTemp();
  this.emit(`${resultPtr} = call i8* @GC_malloc_atomic(i64 ${allocLen})`);

  // Calculate source pointer (strPtr + start)
  const startI64 = this.nextTemp();
  this.emit(`${startI64} = sext i32 ${startI32} to i64`);

  const srcPtr = this.nextTemp();
  this.emit(`${srcPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${startI64}`);

  // Copy the substring using memcpy
  this.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${resultPtr}, i8* ${srcPtr}, i64 ${finalLenI64}, i1 false)`);

  // Add null terminator
  const nullPtr = this.nextTemp();
  this.emit(`${nullPtr} = getelementptr inbounds i8, i8* ${resultPtr}, i64 ${finalLenI64}`);
  this.emit(`store i8 0, i8* ${nullPtr}`);

  return resultPtr;
}

export function generateRepeat(this: BaseGenerator, strPtr: string, count: string): string {
  // Get string length
  const strLen = this.nextTemp();
  this.emit(`${strLen} = call i64 @strlen(i8* ${strPtr})`);

  // Convert count to i64
  const countI64 = this.nextTemp();
  this.emit(`${countI64} = sext i32 ${count} to i64`);

  // Calculate total length (strLen * count)
  const totalLen = this.nextTemp();
  this.emit(`${totalLen} = mul i64 ${strLen}, ${countI64}`);

  // Allocate memory for result (+1 for null terminator)
  const allocLen = this.nextTemp();
  this.emit(`${allocLen} = add i64 ${totalLen}, 1`);

  const resultPtr = this.nextTemp();
  this.emit(`${resultPtr} = call i8* @GC_malloc_atomic(i64 ${allocLen})`);

  // Initialize result to empty string
  this.emit(`store i8 0, i8* ${resultPtr}`);

  // Loop to concatenate string 'count' times
  const loopLabel = this.nextLabel('repeat_loop');
  const loopBodyLabel = this.nextLabel('repeat_body');
  const loopEndLabel = this.nextLabel('repeat_end');

  // Initialize counter
  const counterPtr = this.nextTemp();
  this.emit(`${counterPtr} = alloca i32`);
  this.emit(`store i32 0, i32* ${counterPtr}`);

  this.emit(`br label %${loopLabel}`);

  // Loop condition
  this.emit(`${loopLabel}:`);
  const counterVal = this.nextTemp();
  this.emit(`${counterVal} = load i32, i32* ${counterPtr}`);
  const loopCond = this.nextTemp();
  this.emit(`${loopCond} = icmp slt i32 ${counterVal}, ${count}`);
  this.emit(`br i1 ${loopCond}, label %${loopBodyLabel}, label %${loopEndLabel}`);

  // Loop body: concatenate string
  this.emit(`${loopBodyLabel}:`);
  const strcatResult = this.nextTemp();
  this.emit(`${strcatResult} = call i8* @strcat(i8* ${resultPtr}, i8* ${strPtr})`);

  // Increment counter
  const nextCounter = this.nextTemp();
  this.emit(`${nextCounter} = add i32 ${counterVal}, 1`);
  this.emit(`store i32 ${nextCounter}, i32* ${counterPtr}`);
  this.emit(`br label %${loopLabel}`);

  // Loop end
  this.emit(`${loopEndLabel}:`);

  return resultPtr;
}

export function generatePadStart(this: BaseGenerator, strPtr: string, targetLength: string, padString: string): string {
  // Get current string length
  const strLen = this.nextTemp();
  this.emit(`${strLen} = call i64 @strlen(i8* ${strPtr})`);
  const strLenI32 = this.nextTemp();
  this.emit(`${strLenI32} = trunc i64 ${strLen} to i32`);

  // Get pad string length
  const padLen = this.nextTemp();
  this.emit(`${padLen} = call i64 @strlen(i8* ${padString})`);
  const padLenI32 = this.nextTemp();
  this.emit(`${padLenI32} = trunc i64 ${padLen} to i32`);

  // Calculate padding needed
  const paddingNeeded = this.nextTemp();
  this.emit(`${paddingNeeded} = sub i32 ${targetLength}, ${strLenI32}`);

  // Check if padding is needed
  const needsPadding = this.nextTemp();
  this.emit(`${needsPadding} = icmp sgt i32 ${paddingNeeded}, 0`);

  const noPadLabel = this.nextLabel('padstart_nopad');
  const doPadLabel = this.nextLabel('padstart_dopad');
  const endLabel = this.nextLabel('padstart_end');

  this.emit(`br i1 ${needsPadding}, label %${doPadLabel}, label %${noPadLabel}`);

  // No padding needed - return copy of original string
  this.emit(`${noPadLabel}:`);
  const targetLenI64NoPad = this.nextTemp();
  this.emit(`${targetLenI64NoPad} = sext i32 ${targetLength} to i64`);
  const allocLen1 = this.nextTemp();
  this.emit(`${allocLen1} = add i64 ${targetLenI64NoPad}, 1`);
  const noPadResult = this.nextTemp();
  this.emit(`${noPadResult} = call i8* @GC_malloc_atomic(i64 ${allocLen1})`);
  const strcpyResult1 = this.nextTemp();
  this.emit(`${strcpyResult1} = call i8* @strcpy(i8* ${noPadResult}, i8* ${strPtr})`);
  this.emit(`br label %${endLabel}`);

  // Padding needed
  this.emit(`${doPadLabel}:`);
  const targetLenI64Pad = this.nextTemp();
  this.emit(`${targetLenI64Pad} = sext i32 ${targetLength} to i64`);
  const allocLen2 = this.nextTemp();
  this.emit(`${allocLen2} = add i64 ${targetLenI64Pad}, 1`);
  const padResult = this.nextTemp();
  this.emit(`${padResult} = call i8* @GC_malloc_atomic(i64 ${allocLen2})`);

  // Initialize to empty
  this.emit(`store i8 0, i8* ${padResult}`);

  // Calculate how many full pad strings we need
  const fullPads = this.nextTemp();
  this.emit(`${fullPads} = sdiv i32 ${paddingNeeded}, ${padLenI32}`);

  // Calculate remaining padding characters
  const remainingPad = this.nextTemp();
  this.emit(`${remainingPad} = srem i32 ${paddingNeeded}, ${padLenI32}`);

  // Add full pad strings
  const padLoopLabel = this.nextLabel('padstart_loop');
  const padLoopBodyLabel = this.nextLabel('padstart_loop_body');
  const padLoopEndLabel = this.nextLabel('padstart_loop_end');

  const padCounterPtr = this.nextTemp();
  this.emit(`${padCounterPtr} = alloca i32`);
  this.emit(`store i32 0, i32* ${padCounterPtr}`);
  this.emit(`br label %${padLoopLabel}`);

  this.emit(`${padLoopLabel}:`);
  const padCounterVal = this.nextTemp();
  this.emit(`${padCounterVal} = load i32, i32* ${padCounterPtr}`);
  const padLoopCond = this.nextTemp();
  this.emit(`${padLoopCond} = icmp slt i32 ${padCounterVal}, ${fullPads}`);
  this.emit(`br i1 ${padLoopCond}, label %${padLoopBodyLabel}, label %${padLoopEndLabel}`);

  this.emit(`${padLoopBodyLabel}:`);
  const strcatPad = this.nextTemp();
  this.emit(`${strcatPad} = call i8* @strcat(i8* ${padResult}, i8* ${padString})`);
  const nextPadCounter = this.nextTemp();
  this.emit(`${nextPadCounter} = add i32 ${padCounterVal}, 1`);
  this.emit(`store i32 ${nextPadCounter}, i32* ${padCounterPtr}`);
  this.emit(`br label %${padLoopLabel}`);

  this.emit(`${padLoopEndLabel}:`);

  // Add remaining characters if needed
  const hasRemaining = this.nextTemp();
  this.emit(`${hasRemaining} = icmp sgt i32 ${remainingPad}, 0`);

  const addRemainingLabel = this.nextLabel('padstart_add_remaining');
  const skipRemainingLabel = this.nextLabel('padstart_skip_remaining');

  this.emit(`br i1 ${hasRemaining}, label %${addRemainingLabel}, label %${skipRemainingLabel}`);

  this.emit(`${addRemainingLabel}:`);
  // Use substr to get first N characters of padString
  const remainingSubstr = generateSubstr.call(this, padString, '0', remainingPad);
  const strcatRemaining = this.nextTemp();
  this.emit(`${strcatRemaining} = call i8* @strcat(i8* ${padResult}, i8* ${remainingSubstr})`);
  this.emit(`br label %${skipRemainingLabel}`);

  this.emit(`${skipRemainingLabel}:`);

  // Finally, concatenate the original string
  const finalResult = this.nextTemp();
  this.emit(`${finalResult} = call i8* @strcat(i8* ${padResult}, i8* ${strPtr})`);
  this.emit(`br label %${endLabel}`);

  // End - phi node to select result
  this.emit(`${endLabel}:`);
  const result = this.nextTemp();
  this.emit(`${result} = phi i8* [ ${noPadResult}, %${noPadLabel} ], [ ${padResult}, %${skipRemainingLabel} ]`);

  return result;
}

export function generateSlice(this: BaseGenerator, strPtr: string, startIndex: string, endIndex: string | null): string {
  // Get string length
  const strLen = this.nextTemp();
  this.emit(`${strLen} = call i64 @strlen(i8* ${strPtr})`);
  const strLenI32 = this.nextTemp();
  this.emit(`${strLenI32} = trunc i64 ${strLen} to i32`);

  // Handle negative start index: if start < 0, start = max(0, len + start)
  const startIsNegative = this.nextTemp();
  this.emit(`${startIsNegative} = icmp slt i32 ${startIndex}, 0`);

  const adjustedStart1 = this.nextTemp();
  this.emit(`${adjustedStart1} = add i32 ${strLenI32}, ${startIndex}`);  // len + start (when start is negative)

  const adjustedStart2 = this.nextTemp();
  this.emit(`${adjustedStart2} = select i1 ${startIsNegative}, i32 ${adjustedStart1}, i32 ${startIndex}`);

  // Clamp start to [0, len]
  const startTooSmall = this.nextTemp();
  this.emit(`${startTooSmall} = icmp slt i32 ${adjustedStart2}, 0`);
  const clampedStart1 = this.nextTemp();
  this.emit(`${clampedStart1} = select i1 ${startTooSmall}, i32 0, i32 ${adjustedStart2}`);

  const startTooBig = this.nextTemp();
  this.emit(`${startTooBig} = icmp sgt i32 ${clampedStart1}, ${strLenI32}`);
  const finalStart = this.nextTemp();
  this.emit(`${finalStart} = select i1 ${startTooBig}, i32 ${strLenI32}, i32 ${clampedStart1}`);

  // Handle end index
  let finalEnd: string;
  if (endIndex === null) {
    // No end specified - use string length
    finalEnd = strLenI32;
  } else {
    // Handle negative end index: if end < 0, end = max(0, len + end)
    const endIsNegative = this.nextTemp();
    this.emit(`${endIsNegative} = icmp slt i32 ${endIndex}, 0`);

    const adjustedEnd1 = this.nextTemp();
    this.emit(`${adjustedEnd1} = add i32 ${strLenI32}, ${endIndex}`);  // len + end (when end is negative)

    const adjustedEnd2 = this.nextTemp();
    this.emit(`${adjustedEnd2} = select i1 ${endIsNegative}, i32 ${adjustedEnd1}, i32 ${endIndex}`);

    // Clamp end to [0, len]
    const endTooSmall = this.nextTemp();
    this.emit(`${endTooSmall} = icmp slt i32 ${adjustedEnd2}, 0`);
    const clampedEnd1 = this.nextTemp();
    this.emit(`${clampedEnd1} = select i1 ${endTooSmall}, i32 0, i32 ${adjustedEnd2}`);

    const endTooBig = this.nextTemp();
    this.emit(`${endTooBig} = icmp sgt i32 ${clampedEnd1}, ${strLenI32}`);
    finalEnd = this.nextTemp();
    this.emit(`${finalEnd} = select i1 ${endTooBig}, i32 ${strLenI32}, i32 ${clampedEnd1}`);
  }

  // Calculate length: end - start (must be >= 0)
  const sliceLen = this.nextTemp();
  this.emit(`${sliceLen} = sub i32 ${finalEnd}, ${finalStart}`);

  const lenIsNegative = this.nextTemp();
  this.emit(`${lenIsNegative} = icmp slt i32 ${sliceLen}, 0`);
  const finalLen = this.nextTemp();
  this.emit(`${finalLen} = select i1 ${lenIsNegative}, i32 0, i32 ${sliceLen}`);

  // Use existing substr to extract the slice
  return generateSubstr.call(this, strPtr, finalStart, finalLen);
}

export function generateTrim(this: BaseGenerator, strPtr: string): string {
  // Get string length
  const strLen = this.nextTemp();
  this.emit(`${strLen} = call i64 @strlen(i8* ${strPtr})`);
  const strLenI32 = this.nextTemp();
  this.emit(`${strLenI32} = trunc i64 ${strLen} to i32`);

  // Check if string is empty
  const isEmpty = this.nextTemp();
  this.emit(`${isEmpty} = icmp eq i32 ${strLenI32}, 0`);

  const emptyLabel = this.nextLabel('trim_empty');
  const notEmptyLabel = this.nextLabel('trim_notempty');
  const endLabel = this.nextLabel('trim_end');

  this.emit(`br i1 ${isEmpty}, label %${emptyLabel}, label %${notEmptyLabel}`);

  // Empty string case - return empty string
  this.emit(`${emptyLabel}:`);
  const emptyResult = this.nextTemp();
  this.emit(`${emptyResult} = call i8* @GC_malloc_atomic(i64 1)`);
  this.emit(`store i8 0, i8* ${emptyResult}`);
  this.emit(`br label %${endLabel}`);

  // Not empty - find first and last non-whitespace
  this.emit(`${notEmptyLabel}:`);

  // Find first non-whitespace character
  const startPtr = this.nextTemp();
  this.emit(`${startPtr} = alloca i32`);
  this.emit(`store i32 0, i32* ${startPtr}`);

  const findStartLabel = this.nextLabel('trim_find_start');
  const findStartBodyLabel = this.nextLabel('trim_find_start_body');
  const findStartCheckLabel = this.nextLabel('trim_find_start_check');
  const findStartEndLabel = this.nextLabel('trim_find_start_end');

  this.emit(`br label %${findStartLabel}`);

  this.emit(`${findStartLabel}:`);
  const start = this.nextTemp();
  this.emit(`${start} = load i32, i32* ${startPtr}`);
  const startCond = this.nextTemp();
  this.emit(`${startCond} = icmp slt i32 ${start}, ${strLenI32}`);
  this.emit(`br i1 ${startCond}, label %${findStartBodyLabel}, label %${findStartEndLabel}`);

  this.emit(`${findStartBodyLabel}:`);
  const startI64 = this.nextTemp();
  this.emit(`${startI64} = sext i32 ${start} to i64`);
  const charPtr1 = this.nextTemp();
  this.emit(`${charPtr1} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${startI64}`);
  const char1 = this.nextTemp();
  this.emit(`${char1} = load i8, i8* ${charPtr1}`);

  // Check if whitespace: space(32), tab(9), newline(10), carriage return(13)
  const isSpace = this.nextTemp();
  this.emit(`${isSpace} = icmp eq i8 ${char1}, 32`);
  const isTab = this.nextTemp();
  this.emit(`${isTab} = icmp eq i8 ${char1}, 9`);
  const isNewline = this.nextTemp();
  this.emit(`${isNewline} = icmp eq i8 ${char1}, 10`);
  const isCR = this.nextTemp();
  this.emit(`${isCR} = icmp eq i8 ${char1}, 13`);

  const isWS1 = this.nextTemp();
  this.emit(`${isWS1} = or i1 ${isSpace}, ${isTab}`);
  const isWS2 = this.nextTemp();
  this.emit(`${isWS2} = or i1 ${isWS1}, ${isNewline}`);
  const isWhitespace = this.nextTemp();
  this.emit(`${isWhitespace} = or i1 ${isWS2}, ${isCR}`);

  this.emit(`br i1 ${isWhitespace}, label %${findStartCheckLabel}, label %${findStartEndLabel}`);

  this.emit(`${findStartCheckLabel}:`);
  const nextStart = this.nextTemp();
  this.emit(`${nextStart} = add i32 ${start}, 1`);
  this.emit(`store i32 ${nextStart}, i32* ${startPtr}`);
  this.emit(`br label %${findStartLabel}`);

  this.emit(`${findStartEndLabel}:`);
  const finalStart = this.nextTemp();
  this.emit(`${finalStart} = load i32, i32* ${startPtr}`);

  // Check if entire string was whitespace
  const allWhitespace = this.nextTemp();
  this.emit(`${allWhitespace} = icmp eq i32 ${finalStart}, ${strLenI32}`);

  const allWSLabel = this.nextLabel('trim_all_ws');
  const findEndLabel = this.nextLabel('trim_find_end');

  this.emit(`br i1 ${allWhitespace}, label %${allWSLabel}, label %${findEndLabel}`);

  // All whitespace - return empty string
  this.emit(`${allWSLabel}:`);
  const allWSResult = this.nextTemp();
  this.emit(`${allWSResult} = call i8* @GC_malloc_atomic(i64 1)`);
  this.emit(`store i8 0, i8* ${allWSResult}`);
  this.emit(`br label %${endLabel}`);

  // Find last non-whitespace character
  this.emit(`${findEndLabel}:`);
  const endPtr = this.nextTemp();
  this.emit(`${endPtr} = alloca i32`);
  const initEnd = this.nextTemp();
  this.emit(`${initEnd} = sub i32 ${strLenI32}, 1`);
  this.emit(`store i32 ${initEnd}, i32* ${endPtr}`);

  const findEndLoopLabel = this.nextLabel('trim_find_end_loop');
  const findEndBodyLabel = this.nextLabel('trim_find_end_body');
  const findEndCheckLabel = this.nextLabel('trim_find_end_check');
  const findEndEndLabel = this.nextLabel('trim_find_end_end');

  this.emit(`br label %${findEndLoopLabel}`);

  this.emit(`${findEndLoopLabel}:`);
  const end = this.nextTemp();
  this.emit(`${end} = load i32, i32* ${endPtr}`);
  const endCond = this.nextTemp();
  this.emit(`${endCond} = icmp sge i32 ${end}, ${finalStart}`);
  this.emit(`br i1 ${endCond}, label %${findEndBodyLabel}, label %${findEndEndLabel}`);

  this.emit(`${findEndBodyLabel}:`);
  const endI64 = this.nextTemp();
  this.emit(`${endI64} = sext i32 ${end} to i64`);
  const charPtr2 = this.nextTemp();
  this.emit(`${charPtr2} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${endI64}`);
  const char2 = this.nextTemp();
  this.emit(`${char2} = load i8, i8* ${charPtr2}`);

  // Check if whitespace
  const isSpace2 = this.nextTemp();
  this.emit(`${isSpace2} = icmp eq i8 ${char2}, 32`);
  const isTab2 = this.nextTemp();
  this.emit(`${isTab2} = icmp eq i8 ${char2}, 9`);
  const isNewline2 = this.nextTemp();
  this.emit(`${isNewline2} = icmp eq i8 ${char2}, 10`);
  const isCR2 = this.nextTemp();
  this.emit(`${isCR2} = icmp eq i8 ${char2}, 13`);

  const isWS3 = this.nextTemp();
  this.emit(`${isWS3} = or i1 ${isSpace2}, ${isTab2}`);
  const isWS4 = this.nextTemp();
  this.emit(`${isWS4} = or i1 ${isWS3}, ${isNewline2}`);
  const isWhitespace2 = this.nextTemp();
  this.emit(`${isWhitespace2} = or i1 ${isWS4}, ${isCR2}`);

  this.emit(`br i1 ${isWhitespace2}, label %${findEndCheckLabel}, label %${findEndEndLabel}`);

  this.emit(`${findEndCheckLabel}:`);
  const nextEnd = this.nextTemp();
  this.emit(`${nextEnd} = sub i32 ${end}, 1`);
  this.emit(`store i32 ${nextEnd}, i32* ${endPtr}`);
  this.emit(`br label %${findEndLoopLabel}`);

  this.emit(`${findEndEndLabel}:`);
  const finalEnd = this.nextTemp();
  this.emit(`${finalEnd} = load i32, i32* ${endPtr}`);

  // Calculate trimmed length: finalEnd - finalStart + 1
  const trimmedLen = this.nextTemp();
  this.emit(`${trimmedLen} = sub i32 ${finalEnd}, ${finalStart}`);
  const trimmedLenPlus1 = this.nextTemp();
  this.emit(`${trimmedLenPlus1} = add i32 ${trimmedLen}, 1`);

  // Extract substring using existing substr logic
  const trimmedResult = generateSubstr.call(this, strPtr, finalStart, trimmedLenPlus1);
  this.emit(`br label %${endLabel}`);

  // End - phi node to select result
  this.emit(`${endLabel}:`);
  const result = this.nextTemp();
  this.emit(`${result} = phi i8* [ ${emptyResult}, %${emptyLabel} ], [ ${allWSResult}, %${allWSLabel} ], [ ${trimmedResult}, %${findEndEndLabel} ]`);

  return result;
}
