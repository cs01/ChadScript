import { Expression } from '../../ast/types.js';
import { BaseGenerator } from './base-generator.js';

// ============================================
// STRING GENERATOR - String operations
// ============================================

export class StringGenerator extends BaseGenerator {
  // Generate delegate for expressions (set by LLVMGenerator)
  generateExpression!: (expr: Expression, params: string[]) => string;

  constructor() {
    super();
  }

  createStringConstant(value: string): string {
    // Escape special characters for LLVM
    const escaped = value
      .replace(/\\/g, '\\5C')
      .replace(/\n/g, '\\0A')
      .replace(/\t/g, '\\09')
      .replace(/\r/g, '\\0D')
      .replace(/"/g, '\\22');

    const length = value.length + 1; // +1 for null terminator
    const globalName = this.nextString();

    // Create global constant string
    this.globalStrings.push(
      `${globalName} = private unnamed_addr constant [${length} x i8] c"${escaped}\\00", align 1`
    );

    // Return a pointer to the string
    const ptrReg = this.nextTemp();
    this.emit(
      `${ptrReg} = getelementptr inbounds [${length} x i8], [${length} x i8]* ${globalName}, i64 0, i64 0`
    );
    return ptrReg;
  }

  generateStringConcat(left: Expression, right: Expression, params: string[]): string {
    // Generate both operands as strings
    const leftStr = this.generateExpression(left, params);
    const rightStr = this.generateExpression(right, params);

    return this.generateStringConcatDirect(leftStr, rightStr);
  }

  generateStringConcatDirect(leftStr: string, rightStr: string): string {
    // Get lengths of both strings
    const leftLen = this.nextTemp();
    this.emit(`${leftLen} = call i64 @strlen(i8* ${leftStr})`);
    const rightLen = this.nextTemp();
    this.emit(`${rightLen} = call i64 @strlen(i8* ${rightStr})`);

    // Calculate total length (left + right + 1 for null terminator)
    const totalLen = this.nextTemp();
    this.emit(`${totalLen} = add i64 ${leftLen}, ${rightLen}`);
    const totalLenPlus1 = this.nextTemp();
    this.emit(`${totalLenPlus1} = add i64 ${totalLen}, 1`);

    // Allocate memory for result
    const resultPtr = this.nextTemp();
    this.emit(`${resultPtr} = call i8* @malloc(i64 ${totalLenPlus1})`);

    // Copy left string to result
    const copyResult1 = this.nextTemp();
    this.emit(`${copyResult1} = call i8* @strcpy(i8* ${resultPtr}, i8* ${leftStr})`);

    // Concatenate right string to result
    const concatResult = this.nextTemp();
    this.emit(`${concatResult} = call i8* @strcat(i8* ${resultPtr}, i8* ${rightStr})`);

    return resultPtr;
  }

  generateSubstr(strPtr: string, startIndex: string, length: string | null): string {
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
    this.emit(`${resultPtr} = call i8* @malloc(i64 ${allocLen})`);

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

  generateRepeat(strPtr: string, count: string): string {
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
    this.emit(`${resultPtr} = call i8* @malloc(i64 ${allocLen})`);

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

  generatePadStart(strPtr: string, targetLength: string, padString: string): string {
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
    this.emit(`${noPadResult} = call i8* @malloc(i64 ${allocLen1})`);
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
    this.emit(`${padResult} = call i8* @malloc(i64 ${allocLen2})`);

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
    const remainingSubstr = this.generateSubstr(padString, '0', remainingPad);
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

  generateSplit(strPtr: string, delimiter: string): string {
    // Get string length
    const strLen = this.nextTemp();
    this.emit(`${strLen} = call i64 @strlen(i8* ${strPtr})`);
    const strLenI32 = this.nextTemp();
    this.emit(`${strLenI32} = trunc i64 ${strLen} to i32`);

    // Get delimiter length
    const delimLen = this.nextTemp();
    this.emit(`${delimLen} = call i64 @strlen(i8* ${delimiter})`);
    const delimLenI32 = this.nextTemp();
    this.emit(`${delimLenI32} = trunc i64 ${delimLen} to i32`);

    // Special case: empty delimiter - split into individual characters
    const isEmptyDelim = this.nextTemp();
    this.emit(`${isEmptyDelim} = icmp eq i32 ${delimLenI32}, 0`);

    const emptyDelimLabel = this.nextLabel('split_empty_delim');
    const normalSplitLabel = this.nextLabel('split_normal');
    const endLabel = this.nextLabel('split_end');

    this.emit(`br i1 ${isEmptyDelim}, label %${emptyDelimLabel}, label %${normalSplitLabel}`);

    // === Empty delimiter case: split into characters ===
    this.emit(`${emptyDelimLabel}:`);

    // Allocate StringArray with length = string length
    const emptyArrPtr = this.nextTemp();
    this.emit(`${emptyArrPtr} = alloca %StringArray`);

    // Allocate data array (i8** with strLenI32 elements)
    const emptyDataSize = this.nextTemp();
    this.emit(`${emptyDataSize} = mul i32 ${strLenI32}, 8`); // 8 bytes per pointer
    const emptyDataSizeI64 = this.nextTemp();
    this.emit(`${emptyDataSizeI64} = zext i32 ${emptyDataSize} to i64`);
    const emptyDataMem = this.nextTemp();
    this.emit(`${emptyDataMem} = call i8* @malloc(i64 ${emptyDataSizeI64})`);
    const emptyDataPtr = this.nextTemp();
    this.emit(`${emptyDataPtr} = bitcast i8* ${emptyDataMem} to i8**`);

    // Loop to create single-character strings
    const emptyLoopLabel = this.nextLabel('split_empty_loop');
    const emptyLoopBodyLabel = this.nextLabel('split_empty_body');
    const emptyLoopEndLabel = this.nextLabel('split_empty_end');

    const emptyCounterPtr = this.nextTemp();
    this.emit(`${emptyCounterPtr} = alloca i32`);
    this.emit(`store i32 0, i32* ${emptyCounterPtr}`);
    this.emit(`br label %${emptyLoopLabel}`);

    this.emit(`${emptyLoopLabel}:`);
    const emptyCounterVal = this.nextTemp();
    this.emit(`${emptyCounterVal} = load i32, i32* ${emptyCounterPtr}`);
    const emptyLoopCond = this.nextTemp();
    this.emit(`${emptyLoopCond} = icmp slt i32 ${emptyCounterVal}, ${strLenI32}`);
    this.emit(`br i1 ${emptyLoopCond}, label %${emptyLoopBodyLabel}, label %${emptyLoopEndLabel}`);

    this.emit(`${emptyLoopBodyLabel}:`);
    // Allocate 2-byte string (char + null terminator)
    const charStr = this.nextTemp();
    this.emit(`${charStr} = call i8* @malloc(i64 2)`);

    // Get character at index
    const charIdx = this.nextTemp();
    this.emit(`${charIdx} = sext i32 ${emptyCounterVal} to i64`);
    const charPtr = this.nextTemp();
    this.emit(`${charPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${charIdx}`);
    const charVal = this.nextTemp();
    this.emit(`${charVal} = load i8, i8* ${charPtr}`);

    // Store character and null terminator
    this.emit(`store i8 ${charVal}, i8* ${charStr}`);
    const nullPtr = this.nextTemp();
    this.emit(`${nullPtr} = getelementptr inbounds i8, i8* ${charStr}, i64 1`);
    this.emit(`store i8 0, i8* ${nullPtr}`);

    // Store string pointer in array
    const emptyElemPtr = this.nextTemp();
    this.emit(`${emptyElemPtr} = getelementptr inbounds i8*, i8** ${emptyDataPtr}, i32 ${emptyCounterVal}`);
    this.emit(`store i8* ${charStr}, i8** ${emptyElemPtr}`);

    // Increment counter
    const emptyNextCounter = this.nextTemp();
    this.emit(`${emptyNextCounter} = add i32 ${emptyCounterVal}, 1`);
    this.emit(`store i32 ${emptyNextCounter}, i32* ${emptyCounterPtr}`);
    this.emit(`br label %${emptyLoopLabel}`);

    this.emit(`${emptyLoopEndLabel}:`);

    // Store data pointer in StringArray struct (field 0)
    const emptyDataField = this.nextTemp();
    this.emit(`${emptyDataField} = getelementptr inbounds %StringArray, %StringArray* ${emptyArrPtr}, i32 0, i32 0`);
    this.emit(`store i8** ${emptyDataPtr}, i8*** ${emptyDataField}`);

    // Store length in StringArray struct (field 1)
    const emptyLenField = this.nextTemp();
    this.emit(`${emptyLenField} = getelementptr inbounds %StringArray, %StringArray* ${emptyArrPtr}, i32 0, i32 1`);
    this.emit(`store i32 ${strLenI32}, i32* ${emptyLenField}`);

    // Store capacity in StringArray struct (field 2)
    const emptyCapField = this.nextTemp();
    this.emit(`${emptyCapField} = getelementptr inbounds %StringArray, %StringArray* ${emptyArrPtr}, i32 0, i32 2`);
    this.emit(`store i32 ${strLenI32}, i32* ${emptyCapField}`);

    this.emit(`br label %${endLabel}`);

    // === Normal split case ===
    this.emit(`${normalSplitLabel}:`);

    // Convert delimiter length to i64 once (will be used in both loops)
    const delimLenI64 = this.nextTemp();
    this.emit(`${delimLenI64} = zext i32 ${delimLenI32} to i64`);

    // First pass: count how many parts we'll have
    // We'll scan through the string and count occurrences of the delimiter
    const countLabel = this.nextLabel('split_count');
    const countBodyLabel = this.nextLabel('split_count_body');
    const countCheckLabel = this.nextLabel('split_count_check');
    const countEndLabel = this.nextLabel('split_count_end');

    const partCountPtr = this.nextTemp();
    this.emit(`${partCountPtr} = alloca i32`);
    this.emit(`store i32 1, i32* ${partCountPtr}`); // At least 1 part

    const scanPosPtr = this.nextTemp();
    this.emit(`${scanPosPtr} = alloca i32`);
    this.emit(`store i32 0, i32* ${scanPosPtr}`);

    this.emit(`br label %${countLabel}`);

    this.emit(`${countLabel}:`);
    const scanPos = this.nextTemp();
    this.emit(`${scanPos} = load i32, i32* ${scanPosPtr}`);
    const canContinue = this.nextTemp();
    this.emit(`${canContinue} = icmp slt i32 ${scanPos}, ${strLenI32}`);
    this.emit(`br i1 ${canContinue}, label %${countBodyLabel}, label %${countEndLabel}`);

    this.emit(`${countBodyLabel}:`);
    // Check if delimiter matches at current position
    const scanPosI64 = this.nextTemp();
    this.emit(`${scanPosI64} = sext i32 ${scanPos} to i64`);
    const checkPtr = this.nextTemp();
    this.emit(`${checkPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${scanPosI64}`);
    const cmpResult = this.nextTemp();
    this.emit(`${cmpResult} = call i32 @strncmp(i8* ${checkPtr}, i8* ${delimiter}, i64 ${delimLenI64})`);
    const isMatch = this.nextTemp();
    this.emit(`${isMatch} = icmp eq i32 ${cmpResult}, 0`);

    this.emit(`br i1 ${isMatch}, label %${countCheckLabel}, label %${countCheckLabel}`);

    this.emit(`${countCheckLabel}:`);
    // If match, increment part count and skip delimiter length
    const partCount = this.nextTemp();
    this.emit(`${partCount} = load i32, i32* ${partCountPtr}`);
    const newPartCount = this.nextTemp();
    this.emit(`${newPartCount} = select i1 ${isMatch}, i32 ${partCount}, i32 ${partCount}`);
    const incPartCount = this.nextTemp();
    this.emit(`${incPartCount} = add i32 ${newPartCount}, 1`);
    const finalPartCount = this.nextTemp();
    this.emit(`${finalPartCount} = select i1 ${isMatch}, i32 ${incPartCount}, i32 ${newPartCount}`);
    this.emit(`store i32 ${finalPartCount}, i32* ${partCountPtr}`);

    // Move position forward (by delimiter length if match, by 1 otherwise)
    const skipAmount = this.nextTemp();
    this.emit(`${skipAmount} = select i1 ${isMatch}, i32 ${delimLenI32}, i32 1`);
    const nextScanPos = this.nextTemp();
    this.emit(`${nextScanPos} = add i32 ${scanPos}, ${skipAmount}`);
    this.emit(`store i32 ${nextScanPos}, i32* ${scanPosPtr}`);
    this.emit(`br label %${countLabel}`);

    this.emit(`${countEndLabel}:`);
    const totalParts = this.nextTemp();
    this.emit(`${totalParts} = load i32, i32* ${partCountPtr}`);

    // Allocate StringArray
    const arrayPtr = this.nextTemp();
    this.emit(`${arrayPtr} = alloca %StringArray`);

    // Allocate data array (i8** with totalParts elements)
    const dataSize = this.nextTemp();
    this.emit(`${dataSize} = mul i32 ${totalParts}, 8`); // 8 bytes per pointer
    const dataSizeI64 = this.nextTemp();
    this.emit(`${dataSizeI64} = zext i32 ${dataSize} to i64`);
    const dataMem = this.nextTemp();
    this.emit(`${dataMem} = call i8* @malloc(i64 ${dataSizeI64})`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = bitcast i8* ${dataMem} to i8**`);

    // Second pass: extract substrings
    const extractLabel = this.nextLabel('split_extract');
    const extractBodyLabel = this.nextLabel('split_extract_body');
    const extractMatchLabel = this.nextLabel('split_extract_match');
    const extractNoMatchLabel = this.nextLabel('split_extract_nomatch');
    const extractStoreLabel = this.nextLabel('split_extract_store');
    const extractEndLabel = this.nextLabel('split_extract_end');

    const startPosPtr = this.nextTemp();
    this.emit(`${startPosPtr} = alloca i32`);
    this.emit(`store i32 0, i32* ${startPosPtr}`);

    const curPosPtr = this.nextTemp();
    this.emit(`${curPosPtr} = alloca i32`);
    this.emit(`store i32 0, i32* ${curPosPtr}`);

    const partIndexPtr = this.nextTemp();
    this.emit(`${partIndexPtr} = alloca i32`);
    this.emit(`store i32 0, i32* ${partIndexPtr}`);

    this.emit(`br label %${extractLabel}`);

    this.emit(`${extractLabel}:`);
    const curPos = this.nextTemp();
    this.emit(`${curPos} = load i32, i32* ${curPosPtr}`);
    const extractCond = this.nextTemp();
    this.emit(`${extractCond} = icmp sle i32 ${curPos}, ${strLenI32}`);
    this.emit(`br i1 ${extractCond}, label %${extractBodyLabel}, label %${extractEndLabel}`);

    this.emit(`${extractBodyLabel}:`);
    // Check if we're at end or if delimiter matches
    const atEnd = this.nextTemp();
    this.emit(`${atEnd} = icmp eq i32 ${curPos}, ${strLenI32}`);

    const curPosI64 = this.nextTemp();
    this.emit(`${curPosI64} = sext i32 ${curPos} to i64`);
    const extractCheckPtr = this.nextTemp();
    this.emit(`${extractCheckPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${curPosI64}`);
    const extractCmpResult = this.nextTemp();
    this.emit(`${extractCmpResult} = call i32 @strncmp(i8* ${extractCheckPtr}, i8* ${delimiter}, i64 ${delimLenI64})`);
    const extractIsMatch = this.nextTemp();
    this.emit(`${extractIsMatch} = icmp eq i32 ${extractCmpResult}, 0`);

    const shouldExtract = this.nextTemp();
    this.emit(`${shouldExtract} = or i1 ${atEnd}, ${extractIsMatch}`);

    this.emit(`br i1 ${shouldExtract}, label %${extractMatchLabel}, label %${extractNoMatchLabel}`);

    this.emit(`${extractMatchLabel}:`);
    // Extract substring from startPos to curPos
    const startPos = this.nextTemp();
    this.emit(`${startPos} = load i32, i32* ${startPosPtr}`);
    const partLen = this.nextTemp();
    this.emit(`${partLen} = sub i32 ${curPos}, ${startPos}`);

    // Use substr to extract the part
    const partStr = this.generateSubstr(strPtr, startPos, partLen);

    // Store in array
    const partIndex = this.nextTemp();
    this.emit(`${partIndex} = load i32, i32* ${partIndexPtr}`);
    const partElemPtr = this.nextTemp();
    this.emit(`${partElemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${partIndex}`);
    this.emit(`store i8* ${partStr}, i8** ${partElemPtr}`);

    // Update indices
    const nextPartIndex = this.nextTemp();
    this.emit(`${nextPartIndex} = add i32 ${partIndex}, 1`);
    this.emit(`store i32 ${nextPartIndex}, i32* ${partIndexPtr}`);

    const newStartPos = this.nextTemp();
    this.emit(`${newStartPos} = add i32 ${curPos}, ${delimLenI32}`);
    this.emit(`store i32 ${newStartPos}, i32* ${startPosPtr}`);

    const newCurPos = this.nextTemp();
    this.emit(`${newCurPos} = add i32 ${curPos}, ${delimLenI32}`);
    this.emit(`store i32 ${newCurPos}, i32* ${curPosPtr}`);
    this.emit(`br label %${extractLabel}`);

    this.emit(`${extractNoMatchLabel}:`);
    const incCurPos = this.nextTemp();
    this.emit(`${incCurPos} = add i32 ${curPos}, 1`);
    this.emit(`store i32 ${incCurPos}, i32* ${curPosPtr}`);
    this.emit(`br label %${extractLabel}`);

    this.emit(`${extractEndLabel}:`);

    // Store data pointer in StringArray struct (field 0)
    const dataField = this.nextTemp();
    this.emit(`${dataField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
    this.emit(`store i8** ${dataPtr}, i8*** ${dataField}`);

    // Store length in StringArray struct (field 1)
    const lenField = this.nextTemp();
    this.emit(`${lenField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`);
    this.emit(`store i32 ${totalParts}, i32* ${lenField}`);

    // Store capacity in StringArray struct (field 2)
    const capField = this.nextTemp();
    this.emit(`${capField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 2`);
    this.emit(`store i32 ${totalParts}, i32* ${capField}`);

    this.emit(`br label %${endLabel}`);

    // === End - phi node to select result ===
    this.emit(`${endLabel}:`);
    const result = this.nextTemp();
    this.emit(`${result} = phi %StringArray* [ ${emptyArrPtr}, %${emptyLoopEndLabel} ], [ ${arrayPtr}, %${extractEndLabel} ]`);

    return result;
  }

  generateStartsWith(strPtr: string, prefix: string): string {
    const prefixLen = this.nextTemp();
    this.emit(`${prefixLen} = call i64 @strlen(i8* ${prefix})`);

    const cmpResult = this.nextTemp();
    this.emit(`${cmpResult} = call i32 @strncmp(i8* ${strPtr}, i8* ${prefix}, i64 ${prefixLen})`);

    const result = this.nextTemp();
    this.emit(`${result} = icmp eq i32 ${cmpResult}, 0`);

    const resultI32 = this.nextTemp();
    this.emit(`${resultI32} = zext i1 ${result} to i32`);

    return resultI32;
  }
}
