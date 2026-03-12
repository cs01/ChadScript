import { Expression, MethodCallNode, SourceLocation, VariableNode } from "../../../../ast/types.js";

interface ExprBase {
  type: string;
}

interface ArraySpliceContext {
  nextTemp(): string;
  nextLabel(prefix: string): string;
  emit(instruction: string): void;
  emitStore(type: string, value: string, ptr: string): void;
  emitLoad(type: string, ptr: string): string;
  emitCall(retType: string, func: string, args: string): string;
  emitCallVoid(func: string, args: string): void;
  emitBitcast(value: string, fromType: string, toType: string): string;
  emitIcmp(pred: string, type: string, lhs: string, rhs: string): string;
  getVariableType(name: string): string | undefined;
  setVariableType(name: string, type: string): void;
  generateExpression(expr: Expression, params: string[]): string;
  ensureDouble(value: string): string;
  emitError(message: string, loc?: SourceLocation, suggestion?: string): never;
}

export function generateArraySplice(
  gen: ArraySpliceContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length < 1 || expr.args.length > 2) {
    return gen.emitError("splice() requires 1 or 2 arguments (start, deleteCount)", expr.loc);
  }

  const arrayPtr = gen.generateExpression(expr.object, params);
  const startExpr = gen.generateExpression(expr.args[0], params);
  const startDouble = gen.ensureDouble(startExpr);
  const startRaw = gen.nextTemp();
  gen.emit(`${startRaw} = fptosi double ${startDouble} to i32`);

  let isStringArray = false;
  const exprObjBase = expr.object as ExprBase;
  if (exprObjBase.type === "variable") {
    const varName = (expr.object as VariableNode).name;
    const varType = gen.getVariableType(varName);
    isStringArray = varType === "%StringArray*" || varType === "%StringArray";
  }
  if (!isStringArray) {
    const ptrType = gen.getVariableType(arrayPtr);
    if (ptrType === "%StringArray*" || ptrType === "%StringArray") isStringArray = true;
  }

  if (isStringArray) {
    return generateStringArraySplice(gen, expr, params, arrayPtr, startRaw);
  }
  return generateNumericArraySplice(gen, expr, params, arrayPtr, startRaw);
}

function generateNumericArraySplice(
  gen: ArraySpliceContext,
  expr: MethodCallNode,
  params: string[],
  arrayPtr: string,
  startRaw: string,
): string {
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const length = gen.emitLoad("i32", lenPtr);

  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load double*, double** ${dataPtrField}`);

  const startNeg = gen.emitIcmp("slt", "i32", startRaw, "0");
  const startFromEnd = gen.nextTemp();
  gen.emit(`${startFromEnd} = add i32 ${length}, ${startRaw}`);
  const startClamped = gen.nextTemp();
  gen.emit(`${startClamped} = select i1 ${startNeg}, i32 ${startFromEnd}, i32 ${startRaw}`);
  const startTooLow = gen.emitIcmp("slt", "i32", startClamped, "0");
  const start = gen.nextTemp();
  gen.emit(`${start} = select i1 ${startTooLow}, i32 0, i32 ${startClamped}`);

  let deleteCount: string;
  if (expr.args.length >= 2) {
    const dcExpr = gen.generateExpression(expr.args[1], params);
    const dcDouble = gen.ensureDouble(dcExpr);
    const dcRaw = gen.nextTemp();
    gen.emit(`${dcRaw} = fptosi double ${dcDouble} to i32`);
    const dcNeg = gen.emitIcmp("slt", "i32", dcRaw, "0");
    const dcClamped = gen.nextTemp();
    gen.emit(`${dcClamped} = select i1 ${dcNeg}, i32 0, i32 ${dcRaw}`);
    const remaining = gen.nextTemp();
    gen.emit(`${remaining} = sub i32 ${length}, ${start}`);
    const dcTooMany = gen.emitIcmp("sgt", "i32", dcClamped, remaining);
    deleteCount = gen.nextTemp();
    gen.emit(`${deleteCount} = select i1 ${dcTooMany}, i32 ${remaining}, i32 ${dcClamped}`);
  } else {
    deleteCount = gen.nextTemp();
    gen.emit(`${deleteCount} = sub i32 ${length}, ${start}`);
  }

  const resultArray = gen.emitCall("i8*", "@GC_malloc", "i64 24");
  const resultArrayTyped = gen.emitBitcast(resultArray, "i8*", "%Array*");

  const dcI64 = gen.nextTemp();
  gen.emit(`${dcI64} = zext i32 ${deleteCount} to i64`);
  const resultDataSize = gen.nextTemp();
  gen.emit(`${resultDataSize} = mul i64 ${dcI64}, 8`);
  const resultDataMem = gen.emitCall("i8*", "@GC_malloc_atomic", `i64 ${resultDataSize}`);
  const resultDataPtr = gen.emitBitcast(resultDataMem, "i8*", "double*");

  const srcOffset = gen.nextTemp();
  gen.emit(`${srcOffset} = getelementptr inbounds double, double* ${dataPtr}, i32 ${start}`);
  const srcI8 = gen.emitBitcast(srcOffset, "double*", "i8*");
  gen.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${resultDataMem}, i8* ${srcI8}, i64 ${resultDataSize}, i1 false)`,
  );

  const resultDataField = gen.nextTemp();
  gen.emit(
    `${resultDataField} = getelementptr inbounds %Array, %Array* ${resultArrayTyped}, i32 0, i32 0`,
  );
  gen.emitStore("double*", resultDataPtr, resultDataField);
  const resultLenField = gen.nextTemp();
  gen.emit(
    `${resultLenField} = getelementptr inbounds %Array, %Array* ${resultArrayTyped}, i32 0, i32 1`,
  );
  gen.emitStore("i32", deleteCount, resultLenField);
  const resultCapField = gen.nextTemp();
  gen.emit(
    `${resultCapField} = getelementptr inbounds %Array, %Array* ${resultArrayTyped}, i32 0, i32 2`,
  );
  gen.emitStore("i32", deleteCount, resultCapField);

  const afterStart = gen.nextTemp();
  gen.emit(`${afterStart} = add i32 ${start}, ${deleteCount}`);
  const elemsAfter = gen.nextTemp();
  gen.emit(`${elemsAfter} = sub i32 ${length}, ${afterStart}`);

  const destOffset = gen.nextTemp();
  gen.emit(`${destOffset} = getelementptr inbounds double, double* ${dataPtr}, i32 ${start}`);
  const destI8 = gen.emitBitcast(destOffset, "double*", "i8*");
  const moveSrc = gen.nextTemp();
  gen.emit(`${moveSrc} = getelementptr inbounds double, double* ${dataPtr}, i32 ${afterStart}`);
  const moveSrcI8 = gen.emitBitcast(moveSrc, "double*", "i8*");
  const moveI64 = gen.nextTemp();
  gen.emit(`${moveI64} = zext i32 ${elemsAfter} to i64`);
  const moveBytes = gen.nextTemp();
  gen.emit(`${moveBytes} = mul i64 ${moveI64}, 8`);
  gen.emit(
    `call void @llvm.memmove.p0i8.p0i8.i64(i8* ${destI8}, i8* ${moveSrcI8}, i64 ${moveBytes}, i1 false)`,
  );

  const newLen = gen.nextTemp();
  gen.emit(`${newLen} = sub i32 ${length}, ${deleteCount}`);
  gen.emitStore("i32", newLen, lenPtr);

  gen.setVariableType(resultArrayTyped, "%Array*");
  return resultArrayTyped;
}

function generateStringArraySplice(
  gen: ArraySpliceContext,
  expr: MethodCallNode,
  params: string[],
  arrayPtr: string,
  startRaw: string,
): string {
  const lenPtr = gen.nextTemp();
  gen.emit(
    `${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`,
  );
  const length = gen.emitLoad("i32", lenPtr);

  const dataPtrField = gen.nextTemp();
  gen.emit(
    `${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
  );
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField}`);

  const startNeg = gen.emitIcmp("slt", "i32", startRaw, "0");
  const startFromEnd = gen.nextTemp();
  gen.emit(`${startFromEnd} = add i32 ${length}, ${startRaw}`);
  const startClamped = gen.nextTemp();
  gen.emit(`${startClamped} = select i1 ${startNeg}, i32 ${startFromEnd}, i32 ${startRaw}`);
  const startTooLow = gen.emitIcmp("slt", "i32", startClamped, "0");
  const start = gen.nextTemp();
  gen.emit(`${start} = select i1 ${startTooLow}, i32 0, i32 ${startClamped}`);

  let deleteCount: string;
  if (expr.args.length >= 2) {
    const dcExpr = gen.generateExpression(expr.args[1], params);
    const dcDouble = gen.ensureDouble(dcExpr);
    const dcRaw = gen.nextTemp();
    gen.emit(`${dcRaw} = fptosi double ${dcDouble} to i32`);
    const dcNeg = gen.emitIcmp("slt", "i32", dcRaw, "0");
    const dcClamped = gen.nextTemp();
    gen.emit(`${dcClamped} = select i1 ${dcNeg}, i32 0, i32 ${dcRaw}`);
    const remaining = gen.nextTemp();
    gen.emit(`${remaining} = sub i32 ${length}, ${start}`);
    const dcTooMany = gen.emitIcmp("sgt", "i32", dcClamped, remaining);
    deleteCount = gen.nextTemp();
    gen.emit(`${deleteCount} = select i1 ${dcTooMany}, i32 ${remaining}, i32 ${dcClamped}`);
  } else {
    deleteCount = gen.nextTemp();
    gen.emit(`${deleteCount} = sub i32 ${length}, ${start}`);
  }

  const resultArray = gen.emitCall("i8*", "@GC_malloc", "i64 24");
  const resultArrayTyped = gen.emitBitcast(resultArray, "i8*", "%StringArray*");

  const dcI64 = gen.nextTemp();
  gen.emit(`${dcI64} = zext i32 ${deleteCount} to i64`);
  const resultDataSize = gen.nextTemp();
  gen.emit(`${resultDataSize} = mul i64 ${dcI64}, 8`);
  const resultDataMem = gen.emitCall("i8*", "@GC_malloc", `i64 ${resultDataSize}`);
  const resultDataPtr = gen.emitBitcast(resultDataMem, "i8*", "i8**");

  const srcOffset = gen.nextTemp();
  gen.emit(`${srcOffset} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${start}`);
  const srcI8 = gen.emitBitcast(srcOffset, "i8**", "i8*");
  gen.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${resultDataMem}, i8* ${srcI8}, i64 ${resultDataSize}, i1 false)`,
  );

  const resultDataField = gen.nextTemp();
  gen.emit(
    `${resultDataField} = getelementptr inbounds %StringArray, %StringArray* ${resultArrayTyped}, i32 0, i32 0`,
  );
  gen.emitStore("i8**", resultDataPtr, resultDataField);
  const resultLenField = gen.nextTemp();
  gen.emit(
    `${resultLenField} = getelementptr inbounds %StringArray, %StringArray* ${resultArrayTyped}, i32 0, i32 1`,
  );
  gen.emitStore("i32", deleteCount, resultLenField);
  const resultCapField = gen.nextTemp();
  gen.emit(
    `${resultCapField} = getelementptr inbounds %StringArray, %StringArray* ${resultArrayTyped}, i32 0, i32 2`,
  );
  gen.emitStore("i32", deleteCount, resultCapField);

  const afterStart = gen.nextTemp();
  gen.emit(`${afterStart} = add i32 ${start}, ${deleteCount}`);
  const elemsAfter = gen.nextTemp();
  gen.emit(`${elemsAfter} = sub i32 ${length}, ${afterStart}`);

  const destOffset = gen.nextTemp();
  gen.emit(`${destOffset} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${start}`);
  const destI8 = gen.emitBitcast(destOffset, "i8**", "i8*");
  const moveSrc = gen.nextTemp();
  gen.emit(`${moveSrc} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${afterStart}`);
  const moveSrcI8 = gen.emitBitcast(moveSrc, "i8**", "i8*");
  const moveI64 = gen.nextTemp();
  gen.emit(`${moveI64} = zext i32 ${elemsAfter} to i64`);
  const moveBytes = gen.nextTemp();
  gen.emit(`${moveBytes} = mul i64 ${moveI64}, 8`);
  gen.emit(
    `call void @llvm.memmove.p0i8.p0i8.i64(i8* ${destI8}, i8* ${moveSrcI8}, i64 ${moveBytes}, i1 false)`,
  );

  const newLen = gen.nextTemp();
  gen.emit(`${newLen} = sub i32 ${length}, ${deleteCount}`);
  gen.emitStore("i32", newLen, lenPtr);

  gen.setVariableType(resultArrayTyped, "%StringArray*");
  return resultArrayTyped;
}
