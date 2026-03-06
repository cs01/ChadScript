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

  return result;
}

export function generateCharAt(ctx: IGeneratorContext, strPtr: string, index: string): string {
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

  return resultPtr;
}

export function generateCharCodeAt(ctx: IGeneratorContext, strPtr: string, index: string): string {
  const indexI64 = ctx.nextTemp();
  ctx.emit(`${indexI64} = sext i32 ${index} to i64`);

  const charPtr = ctx.nextTemp();
  ctx.emit(`${charPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${indexI64}`);

  const charI8 = ctx.emitLoad("i8", charPtr);

  const charI32 = ctx.nextTemp();
  ctx.emit(`${charI32} = zext i8 ${charI8} to i32`);

  const result = ctx.nextTemp();
  ctx.emit(`${result} = sitofp i32 ${charI32} to double`);
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

  return result;
}
