import { Expression } from '../../../ast/types.js';
import { BaseGenerator } from '../../infrastructure/base-generator.js';

// ============================================
// STRING GENERATOR - String operations
// ============================================

export class StringGenerator extends BaseGenerator {
  // Generate delegate for expressions (set by LLVMGenerator)
  generateExpression!: (expr: Expression, params: string[]) => string;
  // Type check delegate (set by LLVMGenerator)
  isStringExpression!: (expr: Expression) => boolean;

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

  // Convert a double number to a string
  convertNumberToString(numValue: string): string {
    // Convert double to i32 for printing (truncates decimal part)
    const intValue = this.nextTemp();
    this.emit(`${intValue} = fptosi double ${numValue} to i32`);

    // Allocate buffer for the string (max 12 chars for 32-bit int + null terminator)
    const bufferSize = this.nextTemp();
    this.emit(`${bufferSize} = alloca [12 x i8], align 1`);

    // Cast to i8* for snprintf
    const bufferPtr = this.nextTemp();
    this.emit(`${bufferPtr} = getelementptr inbounds [12 x i8], [12 x i8]* ${bufferSize}, i64 0, i64 0`);

    // Format string for %d
    const formatStr = this.createStringConstant('%d');

    // Call snprintf to convert number to string
    const snprintfResult = this.nextTemp();
    this.emit(`${snprintfResult} = call i32 (i8*, i64, i8*, ...) @snprintf(i8* ${bufferPtr}, i64 12, i8* ${formatStr}, i32 ${intValue})`);

    // Duplicate the string on the heap so it persists
    const strLen = this.nextTemp();
    this.emit(`${strLen} = call i64 @strlen(i8* ${bufferPtr})`);

    const heapSize = this.nextTemp();
    this.emit(`${heapSize} = add i64 ${strLen}, 1`);

    const heapPtr = this.nextTemp();
    this.emit(`${heapPtr} = call i8* @malloc(i64 ${heapSize})`);

    const copyResult = this.nextTemp();
    this.emit(`${copyResult} = call i8* @strcpy(i8* ${heapPtr}, i8* ${bufferPtr})`);

    return heapPtr;
  }

  generateStringConcat(left: Expression, right: Expression, params: string[]): string {
    // Generate both operands
    const leftValue = this.generateExpression(left, params);
    const rightValue = this.generateExpression(right, params);

    // Check if either operand needs to be converted from number to string
    const leftIsString = this.isStringExpression(left) || this.variableTypes.get(leftValue) === 'i8*';
    const rightIsString = this.isStringExpression(right) || this.variableTypes.get(rightValue) === 'i8*';

    // Convert numbers to strings if needed
    const leftStr = leftIsString ? leftValue : this.convertNumberToString(leftValue);
    const rightStr = rightIsString ? rightValue : this.convertNumberToString(rightValue);

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

  generateCharAt(strPtr: string, index: string): string {
    // Get the character at the given index and return it as a single-character string

    // Convert index to i64 for getelementptr
    const indexI64 = this.nextTemp();
    this.emit(`${indexI64} = sext i32 ${index} to i64`);

    // Get pointer to the character at index
    const charPtr = this.nextTemp();
    this.emit(`${charPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${indexI64}`);

    // Load the character
    const charI8 = this.nextTemp();
    this.emit(`${charI8} = load i8, i8* ${charPtr}`);

    // Allocate a 2-byte buffer for single-char string (char + null terminator)
    const resultPtr = this.nextTemp();
    this.emit(`${resultPtr} = call i8* @malloc(i64 2)`);

    // Store the character in the buffer
    this.emit(`store i8 ${charI8}, i8* ${resultPtr}`);

    // Store null terminator
    const nullPtr = this.nextTemp();
    this.emit(`${nullPtr} = getelementptr inbounds i8, i8* ${resultPtr}, i64 1`);
    this.emit(`store i8 0, i8* ${nullPtr}`);

    return resultPtr;
  }

  generateIndexOf(strPtr: string, substring: string): string {
    // Use strstr to find the substring
    const foundPtr = this.nextTemp();
    this.emit(`${foundPtr} = call i8* @strstr(i8* ${strPtr}, i8* ${substring})`);

    // Check if substring was found (strstr returns NULL if not found)
    const isNull = this.nextTemp();
    this.emit(`${isNull} = icmp eq i8* ${foundPtr}, null`);

    const notFoundLabel = this.nextLabel('indexof_notfound');
    const foundLabel = this.nextLabel('indexof_found');
    const endLabel = this.nextLabel('indexof_end');

    this.emit(`br i1 ${isNull}, label %${notFoundLabel}, label %${foundLabel}`);

    // Not found - return -1
    this.emit(`${notFoundLabel}:`);
    this.emit(`br label %${endLabel}`);

    // Found - calculate index by subtracting pointers
    this.emit(`${foundLabel}:`);
    const strPtrInt = this.nextTemp();
    this.emit(`${strPtrInt} = ptrtoint i8* ${strPtr} to i64`);
    const foundPtrInt = this.nextTemp();
    this.emit(`${foundPtrInt} = ptrtoint i8* ${foundPtr} to i64`);
    const indexI64 = this.nextTemp();
    this.emit(`${indexI64} = sub i64 ${foundPtrInt}, ${strPtrInt}`);
    const indexI32 = this.nextTemp();
    this.emit(`${indexI32} = trunc i64 ${indexI64} to i32`);
    this.emit(`br label %${endLabel}`);

    // End - phi node to select result (-1 or index)
    this.emit(`${endLabel}:`);
    const resultI32 = this.nextTemp();
    this.emit(`${resultI32} = phi i32 [ -1, %${notFoundLabel} ], [ ${indexI32}, %${foundLabel} ]`);

    // Convert to double for compatibility with ChadScript's numeric type
    const result = this.nextTemp();
    this.emit(`${result} = sitofp i32 ${resultI32} to double`);

    return result;
  }

  generateIncludes(strPtr: string, substring: string): string {
    // Use strstr to find the substring
    const foundPtr = this.nextTemp();
    this.emit(`${foundPtr} = call i8* @strstr(i8* ${strPtr}, i8* ${substring})`);

    // Check if substring was found (strstr returns NULL if not found)
    // Return 1 if found (not null), 0 if not found (null)
    const isNull = this.nextTemp();
    this.emit(`${isNull} = icmp ne i8* ${foundPtr}, null`);

    // Convert i1 to i32, then to double for compatibility
    const resultI32 = this.nextTemp();
    this.emit(`${resultI32} = zext i1 ${isNull} to i32`);

    const result = this.nextTemp();
    this.emit(`${result} = sitofp i32 ${resultI32} to double`);

    return result;
  }

  generateSlice(strPtr: string, startIndex: string, endIndex: string | null): string {
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
    return this.generateSubstr(strPtr, finalStart, finalLen);
  }

  generateTrim(strPtr: string): string {
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
    this.emit(`${emptyResult} = call i8* @malloc(i64 1)`);
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
    this.emit(`${allWSResult} = call i8* @malloc(i64 1)`);
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
    const trimmedResult = this.generateSubstr(strPtr, finalStart, trimmedLenPlus1);
    this.emit(`br label %${endLabel}`);

    // End - phi node to select result
    this.emit(`${endLabel}:`);
    const result = this.nextTemp();
    this.emit(`${result} = phi i8* [ ${emptyResult}, %${emptyLabel} ], [ ${allWSResult}, %${allWSLabel} ], [ ${trimmedResult}, %${findEndEndLabel} ]`);

    return result;
  }
}
