import { IGeneratorContext } from "../../../infrastructure/generator-context.js";

// ============================================
// STRING SEARCH - String search and query operations
// ============================================

export function generateStartsWith(ctx: IGeneratorContext, strPtr: string, prefix: string): string {
  const prefixLen = ctx.emitCall("i64", "@strlen", `i8* ${prefix}`);

  const cmpResult = ctx.emitCall(
    "i32",
    "@strncmp",
    `i8* ${strPtr}, i8* ${prefix}, i64 ${prefixLen}`,
  );

  const resultBool = ctx.emitIcmp("eq", "i32", cmpResult, "0");

  const resultI32 = ctx.nextTemp();
  ctx.emit(`${resultI32} = zext i1 ${resultBool} to i32`);

  const result = ctx.nextTemp();
  ctx.emit(`${result} = sitofp i32 ${resultI32} to double`);
  ctx.setVariableType(result, "double");

  return result;
}

export function generateCharAt(ctx: IGeneratorContext, strPtr: string, index: string): string {
  const strLen = ctx.emitCall("i64", "@strlen", `i8* ${strPtr}`);
  const strLenI32 = ctx.nextTemp();
  ctx.emit(`${strLenI32} = trunc i64 ${strLen} to i32`);

  const inBoundsLow = ctx.emitIcmp("sge", "i32", index, "0");
  const inBoundsHigh = ctx.emitIcmp("slt", "i32", index, strLenI32);
  const inBounds = ctx.nextTemp();
  ctx.emit(`${inBounds} = and i1 ${inBoundsLow}, ${inBoundsHigh}`);

  const validLabel = ctx.nextLabel("charat_valid");
  const oobLabel = ctx.nextLabel("charat_oob");
  const endLabel = ctx.nextLabel("charat_end");

  ctx.emitBrCond(inBounds, validLabel, oobLabel);

  ctx.emitLabel(validLabel);
  const indexI64 = ctx.nextTemp();
  ctx.emit(`${indexI64} = sext i32 ${index} to i64`);
  const charPtr = ctx.nextTemp();
  ctx.emit(`${charPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${indexI64}`);
  const charI8 = ctx.emitLoad("i8", charPtr);
  const resultPtr = ctx.emitCall("i8*", "@GC_malloc_atomic", "i64 2");
  ctx.emitStore("i8", charI8, resultPtr);
  const nullPtr = ctx.nextTemp();
  ctx.emit(`${nullPtr} = getelementptr inbounds i8, i8* ${resultPtr}, i64 1`);
  ctx.emitStore("i8", "0", nullPtr);
  ctx.emitBr(endLabel);

  ctx.emitLabel(oobLabel);
  const emptyStr = ctx.emitCall("i8*", "@GC_malloc_atomic", "i64 1");
  ctx.emitStore("i8", "0", emptyStr);
  ctx.emitBr(endLabel);

  ctx.emitLabel(endLabel);
  const result = ctx.nextTemp();
  ctx.emit(`${result} = phi i8* [${resultPtr}, %${validLabel}], [${emptyStr}, %${oobLabel}]`);
  return result;
}

export function generateStringAt(ctx: IGeneratorContext, strPtr: string, index: string): string {
  const strLen = ctx.emitCall("i64", "@strlen", `i8* ${strPtr}`);
  const strLenI32 = ctx.nextTemp();
  ctx.emit(`${strLenI32} = trunc i64 ${strLen} to i32`);

  const isNeg = ctx.emitIcmp("slt", "i32", index, "0");
  const adjusted = ctx.nextTemp();
  ctx.emit(`${adjusted} = add i32 ${index}, ${strLenI32}`);
  const resolved = ctx.nextTemp();
  ctx.emit(`${resolved} = select i1 ${isNeg}, i32 ${adjusted}, i32 ${index}`);

  const inBoundsLow = ctx.emitIcmp("sge", "i32", resolved, "0");
  const inBoundsHigh = ctx.emitIcmp("slt", "i32", resolved, strLenI32);
  const inBounds = ctx.nextTemp();
  ctx.emit(`${inBounds} = and i1 ${inBoundsLow}, ${inBoundsHigh}`);

  const validLabel = ctx.nextLabel("at_valid");
  const oobLabel = ctx.nextLabel("at_oob");
  const endLabel = ctx.nextLabel("at_end");

  ctx.emitBrCond(inBounds, validLabel, oobLabel);

  ctx.emitLabel(validLabel);
  const indexI64 = ctx.nextTemp();
  ctx.emit(`${indexI64} = sext i32 ${resolved} to i64`);
  const charPtr = ctx.nextTemp();
  ctx.emit(`${charPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${indexI64}`);
  const charI8 = ctx.emitLoad("i8", charPtr);
  const resultPtr = ctx.emitCall("i8*", "@GC_malloc_atomic", "i64 2");
  ctx.emitStore("i8", charI8, resultPtr);
  const nullPtr = ctx.nextTemp();
  ctx.emit(`${nullPtr} = getelementptr inbounds i8, i8* ${resultPtr}, i64 1`);
  ctx.emitStore("i8", "0", nullPtr);
  ctx.emitBr(endLabel);

  ctx.emitLabel(oobLabel);
  const emptyStr = ctx.emitCall("i8*", "@GC_malloc_atomic", "i64 1");
  ctx.emitStore("i8", "0", emptyStr);
  ctx.emitBr(endLabel);

  ctx.emitLabel(endLabel);
  const result = ctx.nextTemp();
  ctx.emit(`${result} = phi i8* [${resultPtr}, %${validLabel}], [${emptyStr}, %${oobLabel}]`);
  return result;
}

export function generateCharCodeAt(ctx: IGeneratorContext, strPtr: string, index: string): string {
  const strLen = ctx.emitCall("i64", "@strlen", `i8* ${strPtr}`);
  const strLenI32 = ctx.nextTemp();
  ctx.emit(`${strLenI32} = trunc i64 ${strLen} to i32`);

  const inBoundsLow = ctx.emitIcmp("sge", "i32", index, "0");
  const inBoundsHigh = ctx.emitIcmp("slt", "i32", index, strLenI32);
  const inBounds = ctx.nextTemp();
  ctx.emit(`${inBounds} = and i1 ${inBoundsLow}, ${inBoundsHigh}`);

  const validLabel = ctx.nextLabel("charcodeat_valid");
  const oobLabel = ctx.nextLabel("charcodeat_oob");
  const endLabel = ctx.nextLabel("charcodeat_end");

  ctx.emitBrCond(inBounds, validLabel, oobLabel);

  ctx.emitLabel(validLabel);
  const indexI64 = ctx.nextTemp();
  ctx.emit(`${indexI64} = sext i32 ${index} to i64`);
  const charPtr = ctx.nextTemp();
  ctx.emit(`${charPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${indexI64}`);
  const charI8 = ctx.emitLoad("i8", charPtr);
  const charI32 = ctx.nextTemp();
  ctx.emit(`${charI32} = zext i8 ${charI8} to i32`);
  const validResult = ctx.nextTemp();
  ctx.emit(`${validResult} = sitofp i32 ${charI32} to double`);
  ctx.emitBr(endLabel);

  ctx.emitLabel(oobLabel);
  ctx.emitBr(endLabel);

  ctx.emitLabel(endLabel);
  const result = ctx.nextTemp();
  ctx.emit(`${result} = phi double [${validResult}, %${validLabel}], [0.0, %${oobLabel}]`);
  ctx.setVariableType(result, "double");

  return result;
}

export function generateIndexOf(ctx: IGeneratorContext, strPtr: string, substring: string): string {
  const foundPtr = ctx.emitCall("i8*", "@strstr", `i8* ${strPtr}, i8* ${substring}`);

  const isNull = ctx.emitIcmp("eq", "i8*", foundPtr, "null");

  const notFoundLabel = ctx.nextLabel("indexof_notfound");
  const foundLabel = ctx.nextLabel("indexof_found");
  const endLabel = ctx.nextLabel("indexof_end");

  ctx.emitBrCond(isNull, notFoundLabel, foundLabel);

  ctx.emitLabel(notFoundLabel);
  ctx.emitBr(endLabel);

  ctx.emitLabel(foundLabel);
  const strPtrInt = ctx.nextTemp();
  ctx.emit(`${strPtrInt} = ptrtoint i8* ${strPtr} to i64`);
  const foundPtrInt = ctx.nextTemp();
  ctx.emit(`${foundPtrInt} = ptrtoint i8* ${foundPtr} to i64`);
  const indexI64 = ctx.nextTemp();
  ctx.emit(`${indexI64} = sub i64 ${foundPtrInt}, ${strPtrInt}`);
  const indexI32 = ctx.nextTemp();
  ctx.emit(`${indexI32} = trunc i64 ${indexI64} to i32`);
  ctx.emitBr(endLabel);

  ctx.emitLabel(endLabel);
  const resultI32 = ctx.nextTemp();
  ctx.emit(`${resultI32} = phi i32 [ -1, %${notFoundLabel} ], [ ${indexI32}, %${foundLabel} ]`);

  const result = ctx.nextTemp();
  ctx.emit(`${result} = sitofp i32 ${resultI32} to double`);
  ctx.setVariableType(result, "double");

  return result;
}

export function generateIndexOfFrom(
  ctx: IGeneratorContext,
  strPtr: string,
  substring: string,
  fromIndex: string,
): string {
  const strLen = ctx.emitCall("i64", "@strlen", `i8* ${strPtr}`);
  const strLenI32 = ctx.nextTemp();
  ctx.emit(`${strLenI32} = trunc i64 ${strLen} to i32`);

  const isNeg = ctx.emitIcmp("slt", "i32", fromIndex, "0");
  const clamped0 = ctx.nextTemp();
  ctx.emit(`${clamped0} = select i1 ${isNeg}, i32 0, i32 ${fromIndex}`);
  const pastEnd = ctx.emitIcmp("sge", "i32", clamped0, strLenI32);

  const searchLabel = ctx.nextLabel("indexof_from_search");
  const pastEndLabel = ctx.nextLabel("indexof_from_pastend");
  const endLabel = ctx.nextLabel("indexof_from_end");
  ctx.emitBrCond(pastEnd, pastEndLabel, searchLabel);

  ctx.emitLabel(pastEndLabel);
  ctx.emitBr(endLabel);

  ctx.emitLabel(searchLabel);
  const offsetI64 = ctx.nextTemp();
  ctx.emit(`${offsetI64} = zext i32 ${clamped0} to i64`);
  const offsetPtr = ctx.nextTemp();
  ctx.emit(`${offsetPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${offsetI64}`);
  const foundPtr = ctx.emitCall("i8*", "@strstr", `i8* ${offsetPtr}, i8* ${substring}`);
  const isNull = ctx.emitIcmp("eq", "i8*", foundPtr, "null");

  const notFoundLabel = ctx.nextLabel("indexof_from_notfound");
  const foundLabel = ctx.nextLabel("indexof_from_found");
  ctx.emitBrCond(isNull, notFoundLabel, foundLabel);

  ctx.emitLabel(notFoundLabel);
  ctx.emitBr(endLabel);

  ctx.emitLabel(foundLabel);
  const strPtrInt = ctx.nextTemp();
  ctx.emit(`${strPtrInt} = ptrtoint i8* ${strPtr} to i64`);
  const foundPtrInt = ctx.nextTemp();
  ctx.emit(`${foundPtrInt} = ptrtoint i8* ${foundPtr} to i64`);
  const indexI64 = ctx.nextTemp();
  ctx.emit(`${indexI64} = sub i64 ${foundPtrInt}, ${strPtrInt}`);
  const indexI32 = ctx.nextTemp();
  ctx.emit(`${indexI32} = trunc i64 ${indexI64} to i32`);
  ctx.emitBr(endLabel);

  ctx.emitLabel(endLabel);
  const resultI32 = ctx.nextTemp();
  ctx.emit(
    `${resultI32} = phi i32 [ -1, %${pastEndLabel} ], [ -1, %${notFoundLabel} ], [ ${indexI32}, %${foundLabel} ]`,
  );

  const result = ctx.nextTemp();
  ctx.emit(`${result} = sitofp i32 ${resultI32} to double`);
  ctx.setVariableType(result, "double");

  return result;
}

export function generateLastIndexOfFrom(
  ctx: IGeneratorContext,
  strPtr: string,
  substring: string,
  fromIndex: string,
): string {
  const isNeg = ctx.emitIcmp("slt", "i32", fromIndex, "0");

  const negLabel = ctx.nextLabel("lastindexof_from_neg");
  const searchLabel = ctx.nextLabel("lastindexof_from_search");
  const endAllLabel = ctx.nextLabel("lastindexof_from_endall");
  ctx.emitBrCond(isNeg, negLabel, searchLabel);

  ctx.emitLabel(negLabel);
  ctx.emitBr(endAllLabel);

  ctx.emitLabel(searchLabel);

  const lastPosPtr = ctx.nextAllocaReg("lastpos");
  ctx.emit(`${lastPosPtr} = alloca i32`);
  ctx.emitStore("i32", "-1", lastPosPtr);

  const curPtrStorage = ctx.nextAllocaReg("curptr");
  ctx.emit(`${curPtrStorage} = alloca i8*`);
  ctx.emitStore("i8*", strPtr, curPtrStorage);

  const strPtrInt = ctx.nextTemp();
  ctx.emit(`${strPtrInt} = ptrtoint i8* ${strPtr} to i64`);

  const loopLabel = ctx.nextLabel("lastindexof_from_loop");
  const foundLabel = ctx.nextLabel("lastindexof_from_found");
  const withinLabel = ctx.nextLabel("lastindexof_from_within");
  const endLabel = ctx.nextLabel("lastindexof_from_end");

  ctx.emitBr(loopLabel);

  ctx.emitLabel(loopLabel);
  const curPtr = ctx.emitLoad("i8*", curPtrStorage);
  const foundPtr = ctx.emitCall("i8*", "@strstr", `i8* ${curPtr}, i8* ${substring}`);
  const isNull = ctx.emitIcmp("eq", "i8*", foundPtr, "null");
  ctx.emitBrCond(isNull, endLabel, foundLabel);

  ctx.emitLabel(foundLabel);
  const foundPtrInt = ctx.nextTemp();
  ctx.emit(`${foundPtrInt} = ptrtoint i8* ${foundPtr} to i64`);
  const indexI64 = ctx.nextTemp();
  ctx.emit(`${indexI64} = sub i64 ${foundPtrInt}, ${strPtrInt}`);
  const indexI32 = ctx.nextTemp();
  ctx.emit(`${indexI32} = trunc i64 ${indexI64} to i32`);
  const pastLimit = ctx.emitIcmp("sgt", "i32", indexI32, fromIndex);
  ctx.emitBrCond(pastLimit, endLabel, withinLabel);

  ctx.emitLabel(withinLabel);
  ctx.emitStore("i32", indexI32, lastPosPtr);
  const advancedPtr = ctx.nextTemp();
  ctx.emit(`${advancedPtr} = getelementptr inbounds i8, i8* ${foundPtr}, i64 1`);
  ctx.emitStore("i8*", advancedPtr, curPtrStorage);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(endLabel);
  const resultI32Search = ctx.emitLoad("i32", lastPosPtr);
  ctx.emitBr(endAllLabel);

  ctx.emitLabel(endAllLabel);
  const resultI32 = ctx.nextTemp();
  ctx.emit(`${resultI32} = phi i32 [ -1, %${negLabel} ], [ ${resultI32Search}, %${endLabel} ]`);
  const result = ctx.nextTemp();
  ctx.emit(`${result} = sitofp i32 ${resultI32} to double`);
  ctx.setVariableType(result, "double");

  return result;
}

export function generateLastIndexOf(
  ctx: IGeneratorContext,
  strPtr: string,
  substring: string,
): string {
  const lastPosPtr = ctx.nextAllocaReg("lastpos");
  ctx.emit(`${lastPosPtr} = alloca i32`);
  ctx.emitStore("i32", "-1", lastPosPtr);

  const curPtrStorage = ctx.nextAllocaReg("curptr");
  ctx.emit(`${curPtrStorage} = alloca i8*`);
  ctx.emitStore("i8*", strPtr, curPtrStorage);

  const strPtrInt = ctx.nextTemp();
  ctx.emit(`${strPtrInt} = ptrtoint i8* ${strPtr} to i64`);

  const loopLabel = ctx.nextLabel("lastindexof_loop");
  const foundLabel = ctx.nextLabel("lastindexof_found");
  const endLabel = ctx.nextLabel("lastindexof_end");

  ctx.emitBr(loopLabel);

  ctx.emitLabel(loopLabel);
  const curPtr = ctx.emitLoad("i8*", curPtrStorage);
  const foundPtr = ctx.emitCall("i8*", "@strstr", `i8* ${curPtr}, i8* ${substring}`);
  const isNull = ctx.emitIcmp("eq", "i8*", foundPtr, "null");
  ctx.emitBrCond(isNull, endLabel, foundLabel);

  ctx.emitLabel(foundLabel);
  const foundPtrInt = ctx.nextTemp();
  ctx.emit(`${foundPtrInt} = ptrtoint i8* ${foundPtr} to i64`);
  const indexI64 = ctx.nextTemp();
  ctx.emit(`${indexI64} = sub i64 ${foundPtrInt}, ${strPtrInt}`);
  const indexI32 = ctx.nextTemp();
  ctx.emit(`${indexI32} = trunc i64 ${indexI64} to i32`);
  ctx.emitStore("i32", indexI32, lastPosPtr);
  const advancedPtr = ctx.nextTemp();
  ctx.emit(`${advancedPtr} = getelementptr inbounds i8, i8* ${foundPtr}, i64 1`);
  ctx.emitStore("i8*", advancedPtr, curPtrStorage);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(endLabel);
  const resultI32 = ctx.emitLoad("i32", lastPosPtr);
  const result = ctx.nextTemp();
  ctx.emit(`${result} = sitofp i32 ${resultI32} to double`);
  ctx.setVariableType(result, "double");

  return result;
}

export function generateIncludes(
  ctx: IGeneratorContext,
  strPtr: string,
  substring: string,
): string {
  const foundPtr = ctx.emitCall("i8*", "@strstr", `i8* ${strPtr}, i8* ${substring}`);

  const isNull = ctx.emitIcmp("ne", "i8*", foundPtr, "null");

  const resultI32 = ctx.nextTemp();
  ctx.emit(`${resultI32} = zext i1 ${isNull} to i32`);

  const result = ctx.nextTemp();
  ctx.emit(`${result} = sitofp i32 ${resultI32} to double`);
  ctx.setVariableType(result, "double");

  return result;
}

export function generateEndsWith(ctx: IGeneratorContext, strPtr: string, suffix: string): string {
  const strLen = ctx.emitCall("i64", "@strlen", `i8* ${strPtr}`);

  const suffixLen = ctx.emitCall("i64", "@strlen", `i8* ${suffix}`);

  const suffixLonger = ctx.emitIcmp("ugt", "i64", suffixLen, strLen);

  const checkLabel = ctx.nextLabel("endswith_check");
  const falseLabel = ctx.nextLabel("endswith_false");
  const endLabel = ctx.nextLabel("endswith_end");

  ctx.emitBrCond(suffixLonger, falseLabel, checkLabel);

  ctx.emitLabel(checkLabel);
  const offset = ctx.nextTemp();
  ctx.emit(`${offset} = sub i64 ${strLen}, ${suffixLen}`);
  const strEnd = ctx.nextTemp();
  ctx.emit(`${strEnd} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${offset}`);
  const cmpResult = ctx.emitCall("i32", "@strcmp", `i8* ${strEnd}, i8* ${suffix}`);
  const matches = ctx.emitIcmp("eq", "i32", cmpResult, "0");
  const matchesI32 = ctx.nextTemp();
  ctx.emit(`${matchesI32} = zext i1 ${matches} to i32`);
  const matchesDouble = ctx.nextTemp();
  ctx.emit(`${matchesDouble} = sitofp i32 ${matchesI32} to double`);
  ctx.emitBr(endLabel);

  ctx.emitLabel(falseLabel);
  ctx.emitBr(endLabel);

  ctx.emitLabel(endLabel);
  const result = ctx.nextTemp();
  ctx.emit(`${result} = phi double [ ${matchesDouble}, %${checkLabel} ], [ 0.0, %${falseLabel} ]`);
  ctx.setVariableType(result, "double");

  return result;
}

export function generateIncludesFrom(
  ctx: IGeneratorContext,
  strPtr: string,
  substring: string,
  fromIndex: string,
): string {
  const strLen = ctx.emitCall("i64", "@strlen", `i8* ${strPtr}`);
  const strLenI32 = ctx.nextTemp();
  ctx.emit(`${strLenI32} = trunc i64 ${strLen} to i32`);

  const isNeg = ctx.emitIcmp("slt", "i32", fromIndex, "0");
  const clamped0 = ctx.nextTemp();
  ctx.emit(`${clamped0} = select i1 ${isNeg}, i32 0, i32 ${fromIndex}`);
  const pastEnd = ctx.emitIcmp("sge", "i32", clamped0, strLenI32);

  const searchLabel = ctx.nextLabel("includes_from_search");
  const pastEndLabel = ctx.nextLabel("includes_from_pastend");
  const endLabel = ctx.nextLabel("includes_from_end");
  ctx.emitBrCond(pastEnd, pastEndLabel, searchLabel);

  ctx.emitLabel(pastEndLabel);
  ctx.emitBr(endLabel);

  ctx.emitLabel(searchLabel);
  const offsetI64 = ctx.nextTemp();
  ctx.emit(`${offsetI64} = zext i32 ${clamped0} to i64`);
  const offsetPtr = ctx.nextTemp();
  ctx.emit(`${offsetPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${offsetI64}`);
  const foundPtr = ctx.emitCall("i8*", "@strstr", `i8* ${offsetPtr}, i8* ${substring}`);
  const isNotNull = ctx.emitIcmp("ne", "i8*", foundPtr, "null");
  const foundI32 = ctx.nextTemp();
  ctx.emit(`${foundI32} = zext i1 ${isNotNull} to i32`);
  ctx.emitBr(endLabel);

  ctx.emitLabel(endLabel);
  const resultI32 = ctx.nextTemp();
  ctx.emit(
    `${resultI32} = phi i32 [ 0, %${pastEndLabel} ], [ ${foundI32}, %${searchLabel} ]`,
  );

  const result = ctx.nextTemp();
  ctx.emit(`${result} = sitofp i32 ${resultI32} to double`);
  ctx.setVariableType(result, "double");

  return result;
}

export function generateEndsWithPosition(
  ctx: IGeneratorContext,
  strPtr: string,
  suffix: string,
  endPosition: string,
): string {
  const strLen = ctx.emitCall("i64", "@strlen", `i8* ${strPtr}`);
  const strLenI32 = ctx.nextTemp();
  ctx.emit(`${strLenI32} = trunc i64 ${strLen} to i32`);

  const isNeg = ctx.emitIcmp("slt", "i32", endPosition, "0");
  const clamped0 = ctx.nextTemp();
  ctx.emit(`${clamped0} = select i1 ${isNeg}, i32 0, i32 ${endPosition}`);
  const pastEnd = ctx.emitIcmp("sgt", "i32", clamped0, strLenI32);
  const clampedEnd = ctx.nextTemp();
  ctx.emit(`${clampedEnd} = select i1 ${pastEnd}, i32 ${strLenI32}, i32 ${clamped0}`);

  const suffixLen = ctx.emitCall("i64", "@strlen", `i8* ${suffix}`);
  const suffixLenI32 = ctx.nextTemp();
  ctx.emit(`${suffixLenI32} = trunc i64 ${suffixLen} to i32`);

  const suffixLonger = ctx.emitIcmp("sgt", "i32", suffixLenI32, clampedEnd);

  const checkLabel = ctx.nextLabel("endswith_pos_check");
  const falseLabel = ctx.nextLabel("endswith_pos_false");
  const endLabel = ctx.nextLabel("endswith_pos_end");
  ctx.emitBrCond(suffixLonger, falseLabel, checkLabel);

  ctx.emitLabel(checkLabel);
  const startIdx = ctx.nextTemp();
  ctx.emit(`${startIdx} = sub i32 ${clampedEnd}, ${suffixLenI32}`);
  const startI64 = ctx.nextTemp();
  ctx.emit(`${startI64} = zext i32 ${startIdx} to i64`);
  const startPtr = ctx.nextTemp();
  ctx.emit(`${startPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${startI64}`);
  const suffixLenI64 = ctx.nextTemp();
  ctx.emit(`${suffixLenI64} = zext i32 ${suffixLenI32} to i64`);
  const cmpResult = ctx.emitCall("i32", "@strncmp", `i8* ${startPtr}, i8* ${suffix}, i64 ${suffixLenI64}`);
  const matches = ctx.emitIcmp("eq", "i32", cmpResult, "0");
  const matchesI32 = ctx.nextTemp();
  ctx.emit(`${matchesI32} = zext i1 ${matches} to i32`);
  const matchesDouble = ctx.nextTemp();
  ctx.emit(`${matchesDouble} = sitofp i32 ${matchesI32} to double`);
  ctx.emitBr(endLabel);

  ctx.emitLabel(falseLabel);
  ctx.emitBr(endLabel);

  ctx.emitLabel(endLabel);
  const resultEnd = ctx.nextTemp();
  ctx.emit(`${resultEnd} = phi double [ ${matchesDouble}, %${checkLabel} ], [ 0.0, %${falseLabel} ]`);
  ctx.setVariableType(resultEnd, "double");

  return resultEnd;
}
