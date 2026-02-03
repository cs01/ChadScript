import { IGeneratorContext } from '../../../infrastructure/generator-context.js';
import { generateSubstr } from './manipulation.js';

// ============================================
// STRING SPLIT - Complex string splitting into arrays
// ============================================

export function generateSplit(ctx: IGeneratorContext, strPtr: string, delimiter: string): string {
  const strLen = ctx.nextTemp();
  ctx.emit(`${strLen} = call i64 @strlen(i8* ${strPtr})`);
  const strLenI32 = ctx.nextTemp();
  ctx.emit(`${strLenI32} = trunc i64 ${strLen} to i32`);

  const delimLen = ctx.nextTemp();
  ctx.emit(`${delimLen} = call i64 @strlen(i8* ${delimiter})`);
  const delimLenI32 = ctx.nextTemp();
  ctx.emit(`${delimLenI32} = trunc i64 ${delimLen} to i32`);

  const isEmptyDelim = ctx.nextTemp();
  ctx.emit(`${isEmptyDelim} = icmp eq i32 ${delimLenI32}, 0`);

  const emptyDelimLabel = ctx.nextLabel('split_empty_delim');
  const normalSplitLabel = ctx.nextLabel('split_normal');
  const endLabel = ctx.nextLabel('split_end');

  ctx.emit(`br i1 ${isEmptyDelim}, label %${emptyDelimLabel}, label %${normalSplitLabel}`);

  ctx.emit(`${emptyDelimLabel}:`);

  const emptyArrPtr = ctx.nextTemp();
  ctx.emit(`${emptyArrPtr} = alloca %StringArray`);

  const emptyDataSize = ctx.nextTemp();
  ctx.emit(`${emptyDataSize} = mul i32 ${strLenI32}, 8`);
  const emptyDataSizeI64 = ctx.nextTemp();
  ctx.emit(`${emptyDataSizeI64} = zext i32 ${emptyDataSize} to i64`);
  const emptyDataMem = ctx.nextTemp();
  ctx.emit(`${emptyDataMem} = call i8* @GC_malloc(i64 ${emptyDataSizeI64})`);
  const emptyDataPtr = ctx.nextTemp();
  ctx.emit(`${emptyDataPtr} = bitcast i8* ${emptyDataMem} to i8**`);

  const emptyLoopLabel = ctx.nextLabel('split_empty_loop');
  const emptyLoopBodyLabel = ctx.nextLabel('split_empty_body');
  const emptyLoopEndLabel = ctx.nextLabel('split_empty_end');

  const emptyCounterPtr = ctx.nextTemp();
  ctx.emit(`${emptyCounterPtr} = alloca i32`);
  ctx.emit(`store i32 0, i32* ${emptyCounterPtr}`);
  ctx.emit(`br label %${emptyLoopLabel}`);

  ctx.emit(`${emptyLoopLabel}:`);
  const emptyCounterVal = ctx.nextTemp();
  ctx.emit(`${emptyCounterVal} = load i32, i32* ${emptyCounterPtr}`);
  const emptyLoopCond = ctx.nextTemp();
  ctx.emit(`${emptyLoopCond} = icmp slt i32 ${emptyCounterVal}, ${strLenI32}`);
  ctx.emit(`br i1 ${emptyLoopCond}, label %${emptyLoopBodyLabel}, label %${emptyLoopEndLabel}`);

  ctx.emit(`${emptyLoopBodyLabel}:`);
  const charStr = ctx.nextTemp();
  ctx.emit(`${charStr} = call i8* @GC_malloc_atomic(i64 2)`);

  const charIdx = ctx.nextTemp();
  ctx.emit(`${charIdx} = sext i32 ${emptyCounterVal} to i64`);
  const charPtr = ctx.nextTemp();
  ctx.emit(`${charPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${charIdx}`);
  const charVal = ctx.nextTemp();
  ctx.emit(`${charVal} = load i8, i8* ${charPtr}`);

  ctx.emit(`store i8 ${charVal}, i8* ${charStr}`);
  const nullPtr = ctx.nextTemp();
  ctx.emit(`${nullPtr} = getelementptr inbounds i8, i8* ${charStr}, i64 1`);
  ctx.emit(`store i8 0, i8* ${nullPtr}`);

  const emptyElemPtr = ctx.nextTemp();
  ctx.emit(`${emptyElemPtr} = getelementptr inbounds i8*, i8** ${emptyDataPtr}, i32 ${emptyCounterVal}`);
  ctx.emit(`store i8* ${charStr}, i8** ${emptyElemPtr}`);

  const emptyNextCounter = ctx.nextTemp();
  ctx.emit(`${emptyNextCounter} = add i32 ${emptyCounterVal}, 1`);
  ctx.emit(`store i32 ${emptyNextCounter}, i32* ${emptyCounterPtr}`);
  ctx.emit(`br label %${emptyLoopLabel}`);

  ctx.emit(`${emptyLoopEndLabel}:`);

  const emptyDataField = ctx.nextTemp();
  ctx.emit(`${emptyDataField} = getelementptr inbounds %StringArray, %StringArray* ${emptyArrPtr}, i32 0, i32 0`);
  ctx.emit(`store i8** ${emptyDataPtr}, i8*** ${emptyDataField}`);

  const emptyLenField = ctx.nextTemp();
  ctx.emit(`${emptyLenField} = getelementptr inbounds %StringArray, %StringArray* ${emptyArrPtr}, i32 0, i32 1`);
  ctx.emit(`store i32 ${strLenI32}, i32* ${emptyLenField}`);

  const emptyCapField = ctx.nextTemp();
  ctx.emit(`${emptyCapField} = getelementptr inbounds %StringArray, %StringArray* ${emptyArrPtr}, i32 0, i32 2`);
  ctx.emit(`store i32 ${strLenI32}, i32* ${emptyCapField}`);

  ctx.emit(`br label %${endLabel}`);

  ctx.emit(`${normalSplitLabel}:`);

  const delimLenI64 = ctx.nextTemp();
  ctx.emit(`${delimLenI64} = zext i32 ${delimLenI32} to i64`);

  const countLabel = ctx.nextLabel('split_count');
  const countBodyLabel = ctx.nextLabel('split_count_body');
  const countCheckLabel = ctx.nextLabel('split_count_check');
  const countEndLabel = ctx.nextLabel('split_count_end');

  const partCountPtr = ctx.nextTemp();
  ctx.emit(`${partCountPtr} = alloca i32`);
  ctx.emit(`store i32 1, i32* ${partCountPtr}`);

  const scanPosPtr = ctx.nextTemp();
  ctx.emit(`${scanPosPtr} = alloca i32`);
  ctx.emit(`store i32 0, i32* ${scanPosPtr}`);

  ctx.emit(`br label %${countLabel}`);

  ctx.emit(`${countLabel}:`);
  const scanPos = ctx.nextTemp();
  ctx.emit(`${scanPos} = load i32, i32* ${scanPosPtr}`);
  const canContinue = ctx.nextTemp();
  ctx.emit(`${canContinue} = icmp slt i32 ${scanPos}, ${strLenI32}`);
  ctx.emit(`br i1 ${canContinue}, label %${countBodyLabel}, label %${countEndLabel}`);

  ctx.emit(`${countBodyLabel}:`);
  const scanPosI64 = ctx.nextTemp();
  ctx.emit(`${scanPosI64} = sext i32 ${scanPos} to i64`);
  const checkPtr = ctx.nextTemp();
  ctx.emit(`${checkPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${scanPosI64}`);
  const cmpResult = ctx.nextTemp();
  ctx.emit(`${cmpResult} = call i32 @strncmp(i8* ${checkPtr}, i8* ${delimiter}, i64 ${delimLenI64})`);
  const isMatch = ctx.nextTemp();
  ctx.emit(`${isMatch} = icmp eq i32 ${cmpResult}, 0`);

  ctx.emit(`br i1 ${isMatch}, label %${countCheckLabel}, label %${countCheckLabel}`);

  ctx.emit(`${countCheckLabel}:`);
  const partCount = ctx.nextTemp();
  ctx.emit(`${partCount} = load i32, i32* ${partCountPtr}`);
  const newPartCount = ctx.nextTemp();
  ctx.emit(`${newPartCount} = select i1 ${isMatch}, i32 ${partCount}, i32 ${partCount}`);
  const incPartCount = ctx.nextTemp();
  ctx.emit(`${incPartCount} = add i32 ${newPartCount}, 1`);
  const finalPartCount = ctx.nextTemp();
  ctx.emit(`${finalPartCount} = select i1 ${isMatch}, i32 ${incPartCount}, i32 ${newPartCount}`);
  ctx.emit(`store i32 ${finalPartCount}, i32* ${partCountPtr}`);

  const skipAmount = ctx.nextTemp();
  ctx.emit(`${skipAmount} = select i1 ${isMatch}, i32 ${delimLenI32}, i32 1`);
  const nextScanPos = ctx.nextTemp();
  ctx.emit(`${nextScanPos} = add i32 ${scanPos}, ${skipAmount}`);
  ctx.emit(`store i32 ${nextScanPos}, i32* ${scanPosPtr}`);
  ctx.emit(`br label %${countLabel}`);

  ctx.emit(`${countEndLabel}:`);
  const totalParts = ctx.nextTemp();
  ctx.emit(`${totalParts} = load i32, i32* ${partCountPtr}`);

  const arrayPtr = ctx.nextTemp();
  ctx.emit(`${arrayPtr} = alloca %StringArray`);

  const dataSize = ctx.nextTemp();
  ctx.emit(`${dataSize} = mul i32 ${totalParts}, 8`);
  const dataSizeI64 = ctx.nextTemp();
  ctx.emit(`${dataSizeI64} = zext i32 ${dataSize} to i64`);
  const dataMem = ctx.nextTemp();
  ctx.emit(`${dataMem} = call i8* @GC_malloc(i64 ${dataSizeI64})`);
  const dataPtr = ctx.nextTemp();
  ctx.emit(`${dataPtr} = bitcast i8* ${dataMem} to i8**`);

  const extractLabel = ctx.nextLabel('split_extract');
  const extractBodyLabel = ctx.nextLabel('split_extract_body');
  const extractMatchLabel = ctx.nextLabel('split_extract_match');
  const extractNoMatchLabel = ctx.nextLabel('split_extract_nomatch');
  const extractEndLabel = ctx.nextLabel('split_extract_end');

  const startPosPtr = ctx.nextTemp();
  ctx.emit(`${startPosPtr} = alloca i32`);
  ctx.emit(`store i32 0, i32* ${startPosPtr}`);

  const curPosPtr = ctx.nextTemp();
  ctx.emit(`${curPosPtr} = alloca i32`);
  ctx.emit(`store i32 0, i32* ${curPosPtr}`);

  const partIndexPtr = ctx.nextTemp();
  ctx.emit(`${partIndexPtr} = alloca i32`);
  ctx.emit(`store i32 0, i32* ${partIndexPtr}`);

  ctx.emit(`br label %${extractLabel}`);

  ctx.emit(`${extractLabel}:`);
  const curPos = ctx.nextTemp();
  ctx.emit(`${curPos} = load i32, i32* ${curPosPtr}`);
  const extractCond = ctx.nextTemp();
  ctx.emit(`${extractCond} = icmp sle i32 ${curPos}, ${strLenI32}`);
  ctx.emit(`br i1 ${extractCond}, label %${extractBodyLabel}, label %${extractEndLabel}`);

  ctx.emit(`${extractBodyLabel}:`);
  const atEnd = ctx.nextTemp();
  ctx.emit(`${atEnd} = icmp eq i32 ${curPos}, ${strLenI32}`);

  const curPosI64 = ctx.nextTemp();
  ctx.emit(`${curPosI64} = sext i32 ${curPos} to i64`);
  const extractCheckPtr = ctx.nextTemp();
  ctx.emit(`${extractCheckPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${curPosI64}`);
  const extractCmpResult = ctx.nextTemp();
  ctx.emit(`${extractCmpResult} = call i32 @strncmp(i8* ${extractCheckPtr}, i8* ${delimiter}, i64 ${delimLenI64})`);
  const extractIsMatch = ctx.nextTemp();
  ctx.emit(`${extractIsMatch} = icmp eq i32 ${extractCmpResult}, 0`);

  const shouldExtract = ctx.nextTemp();
  ctx.emit(`${shouldExtract} = or i1 ${atEnd}, ${extractIsMatch}`);

  ctx.emit(`br i1 ${shouldExtract}, label %${extractMatchLabel}, label %${extractNoMatchLabel}`);

  ctx.emit(`${extractMatchLabel}:`);
  const startPos = ctx.nextTemp();
  ctx.emit(`${startPos} = load i32, i32* ${startPosPtr}`);
  const partLen = ctx.nextTemp();
  ctx.emit(`${partLen} = sub i32 ${curPos}, ${startPos}`);

  const partStr = generateSubstr(ctx, strPtr, startPos, partLen);

  const partIndex = ctx.nextTemp();
  ctx.emit(`${partIndex} = load i32, i32* ${partIndexPtr}`);
  const partElemPtr = ctx.nextTemp();
  ctx.emit(`${partElemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${partIndex}`);
  ctx.emit(`store i8* ${partStr}, i8** ${partElemPtr}`);

  const nextPartIndex = ctx.nextTemp();
  ctx.emit(`${nextPartIndex} = add i32 ${partIndex}, 1`);
  ctx.emit(`store i32 ${nextPartIndex}, i32* ${partIndexPtr}`);

  const newStartPos = ctx.nextTemp();
  ctx.emit(`${newStartPos} = add i32 ${curPos}, ${delimLenI32}`);
  ctx.emit(`store i32 ${newStartPos}, i32* ${startPosPtr}`);

  const newCurPos = ctx.nextTemp();
  ctx.emit(`${newCurPos} = add i32 ${curPos}, ${delimLenI32}`);
  ctx.emit(`store i32 ${newCurPos}, i32* ${curPosPtr}`);
  ctx.emit(`br label %${extractLabel}`);

  ctx.emit(`${extractNoMatchLabel}:`);
  const incCurPos = ctx.nextTemp();
  ctx.emit(`${incCurPos} = add i32 ${curPos}, 1`);
  ctx.emit(`store i32 ${incCurPos}, i32* ${curPosPtr}`);
  ctx.emit(`br label %${extractLabel}`);

  ctx.emit(`${extractEndLabel}:`);

  const dataField = ctx.nextTemp();
  ctx.emit(`${dataField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
  ctx.emit(`store i8** ${dataPtr}, i8*** ${dataField}`);

  const lenField = ctx.nextTemp();
  ctx.emit(`${lenField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`);
  ctx.emit(`store i32 ${totalParts}, i32* ${lenField}`);

  const capField = ctx.nextTemp();
  ctx.emit(`${capField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 2`);
  ctx.emit(`store i32 ${totalParts}, i32* ${capField}`);

  ctx.emit(`br label %${endLabel}`);

  ctx.emit(`${endLabel}:`);
  const result = ctx.nextTemp();
  ctx.emit(`${result} = phi %StringArray* [ ${emptyArrPtr}, %${emptyLoopEndLabel} ], [ ${arrayPtr}, %${extractEndLabel} ]`);

  return result;
}
