import { Expression, MethodCallNode, VariableNode } from "../../../../ast/types.js";

interface ExprBase {
  type: string;
}

interface ArraySpliceContext {
  nextTemp(): string;
  nextLabel(prefix: string): string;
  emit(instruction: string): void;
  getVariableType(name: string): string | undefined;
  setVariableType(name: string, type: string): void;
  generateExpression(expr: Expression, params: string[]): string;
  ensureDouble(value: string): string;
}

export function generateArraySplice(
  gen: ArraySpliceContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length < 1 || expr.args.length > 2) {
    throw new Error("splice() requires 1 or 2 arguments (start, deleteCount)");
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
  const length = gen.nextTemp();
  gen.emit(`${length} = load i32, i32* ${lenPtr}`);

  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load double*, double** ${dataPtrField}, !tbaa !5`);

  const startNeg = gen.nextTemp();
  gen.emit(`${startNeg} = icmp slt i32 ${startRaw}, 0`);
  const startFromEnd = gen.nextTemp();
  gen.emit(`${startFromEnd} = add i32 ${length}, ${startRaw}`);
  const startClamped = gen.nextTemp();
  gen.emit(`${startClamped} = select i1 ${startNeg}, i32 ${startFromEnd}, i32 ${startRaw}`);
  const startTooLow = gen.nextTemp();
  gen.emit(`${startTooLow} = icmp slt i32 ${startClamped}, 0`);
  const start = gen.nextTemp();
  gen.emit(`${start} = select i1 ${startTooLow}, i32 0, i32 ${startClamped}`);

  let deleteCount: string;
  if (expr.args.length >= 2) {
    const dcExpr = gen.generateExpression(expr.args[1], params);
    const dcDouble = gen.ensureDouble(dcExpr);
    const dcRaw = gen.nextTemp();
    gen.emit(`${dcRaw} = fptosi double ${dcDouble} to i32`);
    const remaining = gen.nextTemp();
    gen.emit(`${remaining} = sub i32 ${length}, ${start}`);
    const dcTooMany = gen.nextTemp();
    gen.emit(`${dcTooMany} = icmp sgt i32 ${dcRaw}, ${remaining}`);
    deleteCount = gen.nextTemp();
    gen.emit(`${deleteCount} = select i1 ${dcTooMany}, i32 ${remaining}, i32 ${dcRaw}`);
  } else {
    deleteCount = gen.nextTemp();
    gen.emit(`${deleteCount} = sub i32 ${length}, ${start}`);
  }

  const resultArray = gen.nextTemp();
  gen.emit(`${resultArray} = call i8* @GC_malloc(i64 24)`);
  const resultArrayTyped = gen.nextTemp();
  gen.emit(`${resultArrayTyped} = bitcast i8* ${resultArray} to %Array*`);

  const dcI64 = gen.nextTemp();
  gen.emit(`${dcI64} = zext i32 ${deleteCount} to i64`);
  const resultDataSize = gen.nextTemp();
  gen.emit(`${resultDataSize} = mul i64 ${dcI64}, 8`);
  const resultDataMem = gen.nextTemp();
  gen.emit(`${resultDataMem} = call i8* @GC_malloc_atomic(i64 ${resultDataSize})`);
  const resultDataPtr = gen.nextTemp();
  gen.emit(`${resultDataPtr} = bitcast i8* ${resultDataMem} to double*`);

  const srcOffset = gen.nextTemp();
  gen.emit(`${srcOffset} = getelementptr inbounds double, double* ${dataPtr}, i32 ${start}`);
  const srcI8 = gen.nextTemp();
  gen.emit(`${srcI8} = bitcast double* ${srcOffset} to i8*`);
  gen.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${resultDataMem}, i8* ${srcI8}, i64 ${resultDataSize}, i1 false)`,
  );

  const resultDataField = gen.nextTemp();
  gen.emit(
    `${resultDataField} = getelementptr inbounds %Array, %Array* ${resultArrayTyped}, i32 0, i32 0`,
  );
  gen.emit(`store double* ${resultDataPtr}, double** ${resultDataField}`);
  const resultLenField = gen.nextTemp();
  gen.emit(
    `${resultLenField} = getelementptr inbounds %Array, %Array* ${resultArrayTyped}, i32 0, i32 1`,
  );
  gen.emit(`store i32 ${deleteCount}, i32* ${resultLenField}`);
  const resultCapField = gen.nextTemp();
  gen.emit(
    `${resultCapField} = getelementptr inbounds %Array, %Array* ${resultArrayTyped}, i32 0, i32 2`,
  );
  gen.emit(`store i32 ${deleteCount}, i32* ${resultCapField}`);

  const afterStart = gen.nextTemp();
  gen.emit(`${afterStart} = add i32 ${start}, ${deleteCount}`);
  const elemsAfter = gen.nextTemp();
  gen.emit(`${elemsAfter} = sub i32 ${length}, ${afterStart}`);

  const destOffset = gen.nextTemp();
  gen.emit(`${destOffset} = getelementptr inbounds double, double* ${dataPtr}, i32 ${start}`);
  const destI8 = gen.nextTemp();
  gen.emit(`${destI8} = bitcast double* ${destOffset} to i8*`);
  const moveSrc = gen.nextTemp();
  gen.emit(`${moveSrc} = getelementptr inbounds double, double* ${dataPtr}, i32 ${afterStart}`);
  const moveSrcI8 = gen.nextTemp();
  gen.emit(`${moveSrcI8} = bitcast double* ${moveSrc} to i8*`);
  const moveI64 = gen.nextTemp();
  gen.emit(`${moveI64} = zext i32 ${elemsAfter} to i64`);
  const moveBytes = gen.nextTemp();
  gen.emit(`${moveBytes} = mul i64 ${moveI64}, 8`);
  gen.emit(
    `call void @llvm.memmove.p0i8.p0i8.i64(i8* ${destI8}, i8* ${moveSrcI8}, i64 ${moveBytes}, i1 false)`,
  );

  const newLen = gen.nextTemp();
  gen.emit(`${newLen} = sub i32 ${length}, ${deleteCount}`);
  gen.emit(`store i32 ${newLen}, i32* ${lenPtr}`);

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
  const length = gen.nextTemp();
  gen.emit(`${length} = load i32, i32* ${lenPtr}`);

  const dataPtrField = gen.nextTemp();
  gen.emit(
    `${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
  );
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField}, !tbaa !5`);

  const startNeg = gen.nextTemp();
  gen.emit(`${startNeg} = icmp slt i32 ${startRaw}, 0`);
  const startFromEnd = gen.nextTemp();
  gen.emit(`${startFromEnd} = add i32 ${length}, ${startRaw}`);
  const startClamped = gen.nextTemp();
  gen.emit(`${startClamped} = select i1 ${startNeg}, i32 ${startFromEnd}, i32 ${startRaw}`);
  const startTooLow = gen.nextTemp();
  gen.emit(`${startTooLow} = icmp slt i32 ${startClamped}, 0`);
  const start = gen.nextTemp();
  gen.emit(`${start} = select i1 ${startTooLow}, i32 0, i32 ${startClamped}`);

  let deleteCount: string;
  if (expr.args.length >= 2) {
    const dcExpr = gen.generateExpression(expr.args[1], params);
    const dcDouble = gen.ensureDouble(dcExpr);
    const dcRaw = gen.nextTemp();
    gen.emit(`${dcRaw} = fptosi double ${dcDouble} to i32`);
    const remaining = gen.nextTemp();
    gen.emit(`${remaining} = sub i32 ${length}, ${start}`);
    const dcTooMany = gen.nextTemp();
    gen.emit(`${dcTooMany} = icmp sgt i32 ${dcRaw}, ${remaining}`);
    deleteCount = gen.nextTemp();
    gen.emit(`${deleteCount} = select i1 ${dcTooMany}, i32 ${remaining}, i32 ${dcRaw}`);
  } else {
    deleteCount = gen.nextTemp();
    gen.emit(`${deleteCount} = sub i32 ${length}, ${start}`);
  }

  const resultArray = gen.nextTemp();
  gen.emit(`${resultArray} = call i8* @GC_malloc(i64 24)`);
  const resultArrayTyped = gen.nextTemp();
  gen.emit(`${resultArrayTyped} = bitcast i8* ${resultArray} to %StringArray*`);

  const dcI64 = gen.nextTemp();
  gen.emit(`${dcI64} = zext i32 ${deleteCount} to i64`);
  const resultDataSize = gen.nextTemp();
  gen.emit(`${resultDataSize} = mul i64 ${dcI64}, 8`);
  const resultDataMem = gen.nextTemp();
  gen.emit(`${resultDataMem} = call i8* @GC_malloc(i64 ${resultDataSize})`);
  const resultDataPtr = gen.nextTemp();
  gen.emit(`${resultDataPtr} = bitcast i8* ${resultDataMem} to i8**`);

  const srcOffset = gen.nextTemp();
  gen.emit(`${srcOffset} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${start}`);
  const srcI8 = gen.nextTemp();
  gen.emit(`${srcI8} = bitcast i8** ${srcOffset} to i8*`);
  gen.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${resultDataMem}, i8* ${srcI8}, i64 ${resultDataSize}, i1 false)`,
  );

  const resultDataField = gen.nextTemp();
  gen.emit(
    `${resultDataField} = getelementptr inbounds %StringArray, %StringArray* ${resultArrayTyped}, i32 0, i32 0`,
  );
  gen.emit(`store i8** ${resultDataPtr}, i8*** ${resultDataField}`);
  const resultLenField = gen.nextTemp();
  gen.emit(
    `${resultLenField} = getelementptr inbounds %StringArray, %StringArray* ${resultArrayTyped}, i32 0, i32 1`,
  );
  gen.emit(`store i32 ${deleteCount}, i32* ${resultLenField}`);
  const resultCapField = gen.nextTemp();
  gen.emit(
    `${resultCapField} = getelementptr inbounds %StringArray, %StringArray* ${resultArrayTyped}, i32 0, i32 2`,
  );
  gen.emit(`store i32 ${deleteCount}, i32* ${resultCapField}`);

  const afterStart = gen.nextTemp();
  gen.emit(`${afterStart} = add i32 ${start}, ${deleteCount}`);
  const elemsAfter = gen.nextTemp();
  gen.emit(`${elemsAfter} = sub i32 ${length}, ${afterStart}`);

  const destOffset = gen.nextTemp();
  gen.emit(`${destOffset} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${start}`);
  const destI8 = gen.nextTemp();
  gen.emit(`${destI8} = bitcast i8** ${destOffset} to i8*`);
  const moveSrc = gen.nextTemp();
  gen.emit(`${moveSrc} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${afterStart}`);
  const moveSrcI8 = gen.nextTemp();
  gen.emit(`${moveSrcI8} = bitcast i8** ${moveSrc} to i8*`);
  const moveI64 = gen.nextTemp();
  gen.emit(`${moveI64} = zext i32 ${elemsAfter} to i64`);
  const moveBytes = gen.nextTemp();
  gen.emit(`${moveBytes} = mul i64 ${moveI64}, 8`);
  gen.emit(
    `call void @llvm.memmove.p0i8.p0i8.i64(i8* ${destI8}, i8* ${moveSrcI8}, i64 ${moveBytes}, i1 false)`,
  );

  const newLen = gen.nextTemp();
  gen.emit(`${newLen} = sub i32 ${length}, ${deleteCount}`);
  gen.emit(`store i32 ${newLen}, i32* ${lenPtr}`);

  gen.setVariableType(resultArrayTyped, "%StringArray*");
  return resultArrayTyped;
}
