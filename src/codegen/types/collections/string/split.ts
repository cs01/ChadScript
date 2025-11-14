import { BaseGenerator } from '../../../infrastructure/base-generator.js';
import { generateSubstr } from './manipulation.js';

// ============================================
// STRING SPLIT - Complex string splitting into arrays
// ============================================

export function generateSplit(this: BaseGenerator, strPtr: string, delimiter: string): string {
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
  const partStr = generateSubstr.call(this, strPtr, startPos, partLen);

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
