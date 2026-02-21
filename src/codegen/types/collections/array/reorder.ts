import { Expression, MethodCallNode, VariableNode } from "../../../../ast/types.js";

interface ExprBase {
  type: string;
}

interface ArrayReorderContext {
  nextTemp(): string;
  nextLabel(prefix: string): string;
  emit(instruction: string): void;
  getVariableType(name: string): string | undefined;
  setVariableType(name: string, type: string): void;
  generateExpression(expr: Expression, params: string[]): string;
  ensureDouble(value: string): string;
}

export function generateArrayReverse(
  gen: ArrayReorderContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length !== 0) {
    throw new Error("reverse() requires 0 arguments");
  }

  const arrayPtr = gen.generateExpression(expr.object, params);

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
    return generateStringArrayReverseInPlace(gen, arrayPtr);
  }
  return generateNumericArrayReverseInPlace(gen, arrayPtr);
}

function generateNumericArrayReverseInPlace(gen: ArrayReorderContext, arrayPtr: string): string {
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const length = gen.nextTemp();
  gen.emit(`${length} = load i32, i32* ${lenPtr}`);

  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load double*, double** ${dataPtrField}, !tbaa !5`);

  const half = gen.nextTemp();
  gen.emit(`${half} = sdiv i32 ${length}, 2`);
  const lastIdx = gen.nextTemp();
  gen.emit(`${lastIdx} = sub i32 ${length}, 1`);

  const loopPtr = gen.nextTemp();
  gen.emit(`${loopPtr} = alloca i32`);
  gen.emit(`store i32 0, i32* ${loopPtr}`);

  const checkLabel = gen.nextLabel("rev_check");
  const bodyLabel = gen.nextLabel("rev_body");
  const endLabel = gen.nextLabel("rev_end");

  gen.emit(`br label %${checkLabel}`);

  gen.emit(`${checkLabel}:`);
  const i = gen.nextTemp();
  gen.emit(`${i} = load i32, i32* ${loopPtr}`);
  const cond = gen.nextTemp();
  gen.emit(`${cond} = icmp slt i32 ${i}, ${half}`);
  gen.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

  gen.emit(`${bodyLabel}:`);
  const j = gen.nextTemp();
  gen.emit(`${j} = sub i32 ${lastIdx}, ${i}`);

  const ptrI = gen.nextTemp();
  gen.emit(`${ptrI} = getelementptr inbounds double, double* ${dataPtr}, i32 ${i}`);
  const valI = gen.nextTemp();
  gen.emit(`${valI} = load double, double* ${ptrI}`);

  const ptrJ = gen.nextTemp();
  gen.emit(`${ptrJ} = getelementptr inbounds double, double* ${dataPtr}, i32 ${j}`);
  const valJ = gen.nextTemp();
  gen.emit(`${valJ} = load double, double* ${ptrJ}`);

  gen.emit(`store double ${valJ}, double* ${ptrI}`);
  gen.emit(`store double ${valI}, double* ${ptrJ}`);

  const nextI = gen.nextTemp();
  gen.emit(`${nextI} = add i32 ${i}, 1`);
  gen.emit(`store i32 ${nextI}, i32* ${loopPtr}`);
  gen.emit(`br label %${checkLabel}`);

  gen.emit(`${endLabel}:`);

  gen.setVariableType(arrayPtr, "%Array*");
  return arrayPtr;
}

function generateStringArrayReverseInPlace(gen: ArrayReorderContext, arrayPtr: string): string {
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

  const half = gen.nextTemp();
  gen.emit(`${half} = sdiv i32 ${length}, 2`);
  const lastIdx = gen.nextTemp();
  gen.emit(`${lastIdx} = sub i32 ${length}, 1`);

  const loopPtr = gen.nextTemp();
  gen.emit(`${loopPtr} = alloca i32`);
  gen.emit(`store i32 0, i32* ${loopPtr}`);

  const checkLabel = gen.nextLabel("rev_check");
  const bodyLabel = gen.nextLabel("rev_body");
  const endLabel = gen.nextLabel("rev_end");

  gen.emit(`br label %${checkLabel}`);

  gen.emit(`${checkLabel}:`);
  const i = gen.nextTemp();
  gen.emit(`${i} = load i32, i32* ${loopPtr}`);
  const cond = gen.nextTemp();
  gen.emit(`${cond} = icmp slt i32 ${i}, ${half}`);
  gen.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

  gen.emit(`${bodyLabel}:`);
  const j = gen.nextTemp();
  gen.emit(`${j} = sub i32 ${lastIdx}, ${i}`);

  const ptrI = gen.nextTemp();
  gen.emit(`${ptrI} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${i}`);
  const valI = gen.nextTemp();
  gen.emit(`${valI} = load i8*, i8** ${ptrI}`);

  const ptrJ = gen.nextTemp();
  gen.emit(`${ptrJ} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${j}`);
  const valJ = gen.nextTemp();
  gen.emit(`${valJ} = load i8*, i8** ${ptrJ}`);

  gen.emit(`store i8* ${valJ}, i8** ${ptrI}`);
  gen.emit(`store i8* ${valI}, i8** ${ptrJ}`);

  const nextI = gen.nextTemp();
  gen.emit(`${nextI} = add i32 ${i}, 1`);
  gen.emit(`store i32 ${nextI}, i32* ${loopPtr}`);
  gen.emit(`br label %${checkLabel}`);

  gen.emit(`${endLabel}:`);

  gen.setVariableType(arrayPtr, "%StringArray*");
  return arrayPtr;
}

export function generateArrayShift(
  gen: ArrayReorderContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length !== 0) {
    throw new Error("shift() requires 0 arguments");
  }

  const arrayPtr = gen.generateExpression(expr.object, params);

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
    return generateStringArrayShift(gen, arrayPtr);
  }
  return generateNumericArrayShift(gen, arrayPtr);
}

function generateNumericArrayShift(gen: ArrayReorderContext, arrayPtr: string): string {
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const currentLen = gen.nextTemp();
  gen.emit(`${currentLen} = load i32, i32* ${lenPtr}`);

  const isEmpty = gen.nextTemp();
  gen.emit(`${isEmpty} = icmp eq i32 ${currentLen}, 0`);

  const emptyLabel = gen.nextLabel("shift_empty");
  const notEmptyLabel = gen.nextLabel("shift_notempty");
  const endLabel = gen.nextLabel("shift_end");

  gen.emit(`br i1 ${isEmpty}, label %${emptyLabel}, label %${notEmptyLabel}`);

  gen.emit(`${emptyLabel}:`);
  gen.emit(`br label %${endLabel}`);

  gen.emit(`${notEmptyLabel}:`);
  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load double*, double** ${dataPtrField}, !tbaa !5`);

  const firstElem = gen.nextTemp();
  gen.emit(`${firstElem} = load double, double* ${dataPtr}`);

  const newLen = gen.nextTemp();
  gen.emit(`${newLen} = sub i32 ${currentLen}, 1`);

  const destI8 = gen.nextTemp();
  gen.emit(`${destI8} = bitcast double* ${dataPtr} to i8*`);
  const srcPtr = gen.nextTemp();
  gen.emit(`${srcPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 1`);
  const srcI8 = gen.nextTemp();
  gen.emit(`${srcI8} = bitcast double* ${srcPtr} to i8*`);
  const moveLen = gen.nextTemp();
  gen.emit(`${moveLen} = zext i32 ${newLen} to i64`);
  const moveBytes = gen.nextTemp();
  gen.emit(`${moveBytes} = mul i64 ${moveLen}, 8`);
  gen.emit(
    `call void @llvm.memmove.p0i8.p0i8.i64(i8* ${destI8}, i8* ${srcI8}, i64 ${moveBytes}, i1 false)`,
  );

  gen.emit(`store i32 ${newLen}, i32* ${lenPtr}`);
  gen.emit(`br label %${endLabel}`);

  gen.emit(`${endLabel}:`);
  const result = gen.nextTemp();
  gen.emit(`${result} = phi double [ 0.0, %${emptyLabel} ], [ ${firstElem}, %${notEmptyLabel} ]`);
  return result;
}

function generateStringArrayShift(gen: ArrayReorderContext, arrayPtr: string): string {
  const lenPtr = gen.nextTemp();
  gen.emit(
    `${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`,
  );
  const currentLen = gen.nextTemp();
  gen.emit(`${currentLen} = load i32, i32* ${lenPtr}`);

  const isEmpty = gen.nextTemp();
  gen.emit(`${isEmpty} = icmp eq i32 ${currentLen}, 0`);

  const emptyLabel = gen.nextLabel("shift_empty");
  const notEmptyLabel = gen.nextLabel("shift_notempty");
  const endLabel = gen.nextLabel("shift_end");

  gen.emit(`br i1 ${isEmpty}, label %${emptyLabel}, label %${notEmptyLabel}`);

  gen.emit(`${emptyLabel}:`);
  const emptyStr = gen.nextTemp();
  gen.emit(`${emptyStr} = call i8* @GC_malloc_atomic(i64 1)`);
  gen.emit(`store i8 0, i8* ${emptyStr}`);
  gen.emit(`br label %${endLabel}`);

  gen.emit(`${notEmptyLabel}:`);
  const dataPtrField = gen.nextTemp();
  gen.emit(
    `${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
  );
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField}, !tbaa !5`);

  const firstElem = gen.nextTemp();
  gen.emit(`${firstElem} = load i8*, i8** ${dataPtr}`);

  const newLen = gen.nextTemp();
  gen.emit(`${newLen} = sub i32 ${currentLen}, 1`);

  const destI8 = gen.nextTemp();
  gen.emit(`${destI8} = bitcast i8** ${dataPtr} to i8*`);
  const srcPtr = gen.nextTemp();
  gen.emit(`${srcPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 1`);
  const srcI8 = gen.nextTemp();
  gen.emit(`${srcI8} = bitcast i8* ${srcPtr} to i8*`);
  const moveLen = gen.nextTemp();
  gen.emit(`${moveLen} = zext i32 ${newLen} to i64`);
  const moveBytes = gen.nextTemp();
  gen.emit(`${moveBytes} = mul i64 ${moveLen}, 8`);
  gen.emit(
    `call void @llvm.memmove.p0i8.p0i8.i64(i8* ${destI8}, i8* ${srcI8}, i64 ${moveBytes}, i1 false)`,
  );

  gen.emit(`store i32 ${newLen}, i32* ${lenPtr}`);
  gen.emit(`br label %${endLabel}`);

  gen.emit(`${endLabel}:`);
  const result = gen.nextTemp();
  gen.emit(
    `${result} = phi i8* [ ${emptyStr}, %${emptyLabel} ], [ ${firstElem}, %${notEmptyLabel} ]`,
  );
  gen.setVariableType(result, "i8*");
  return result;
}

export function generateArrayUnshift(
  gen: ArrayReorderContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length !== 1) {
    throw new Error("unshift() requires exactly 1 argument");
  }

  const arrayPtr = gen.generateExpression(expr.object, params);
  const value = gen.generateExpression(expr.args[0], params);

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
    return generateStringArrayUnshift(gen, arrayPtr, value);
  }
  return generateNumericArrayUnshift(gen, arrayPtr, value);
}

function generateNumericArrayUnshift(
  gen: ArrayReorderContext,
  arrayPtr: string,
  value: string,
): string {
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const currentLen = gen.nextTemp();
  gen.emit(`${currentLen} = load i32, i32* ${lenPtr}`);

  const capPtr = gen.nextTemp();
  gen.emit(`${capPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
  const currentCap = gen.nextTemp();
  gen.emit(`${currentCap} = load i32, i32* ${capPtr}`);

  const needResize = gen.nextTemp();
  gen.emit(`${needResize} = icmp eq i32 ${currentLen}, ${currentCap}`);

  const resizeLabel = gen.nextLabel("unshift_resize");
  const continueLabel = gen.nextLabel("unshift_continue");

  gen.emit(`br i1 ${needResize}, label %${resizeLabel}, label %${continueLabel}`);

  gen.emit(`${resizeLabel}:`);
  const isZero = gen.nextTemp();
  gen.emit(`${isZero} = icmp eq i32 ${currentCap}, 0`);
  const doubled = gen.nextTemp();
  gen.emit(`${doubled} = mul i32 ${currentCap}, 2`);
  const newCap = gen.nextTemp();
  gen.emit(`${newCap} = select i1 ${isZero}, i32 2, i32 ${doubled}`);

  const newCapI64 = gen.nextTemp();
  gen.emit(`${newCapI64} = zext i32 ${newCap} to i64`);
  const newMemSize = gen.nextTemp();
  gen.emit(`${newMemSize} = mul i64 ${newCapI64}, 8`);
  const newMem = gen.nextTemp();
  gen.emit(`${newMem} = call i8* @GC_malloc_atomic(i64 ${newMemSize})`);
  const newDataPtr = gen.nextTemp();
  gen.emit(`${newDataPtr} = bitcast i8* ${newMem} to double*`);

  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const oldDataPtr = gen.nextTemp();
  gen.emit(`${oldDataPtr} = load double*, double** ${dataPtrField}`);
  const oldDataI8 = gen.nextTemp();
  gen.emit(`${oldDataI8} = bitcast double* ${oldDataPtr} to i8*`);
  const newDataI8 = gen.nextTemp();
  gen.emit(`${newDataI8} = bitcast double* ${newDataPtr} to i8*`);
  const currentLenI64 = gen.nextTemp();
  gen.emit(`${currentLenI64} = zext i32 ${currentLen} to i64`);
  const copySize = gen.nextTemp();
  gen.emit(`${copySize} = mul i64 ${currentLenI64}, 8`);
  gen.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newDataI8}, i8* ${oldDataI8}, i64 ${copySize}, i1 false)`,
  );

  gen.emit(`store double* ${newDataPtr}, double** ${dataPtrField}`);
  gen.emit(`store i32 ${newCap}, i32* ${capPtr}`);
  gen.emit(`br label %${continueLabel}`);

  gen.emit(`${continueLabel}:`);

  const dataPtrField2 = gen.nextTemp();
  gen.emit(`${dataPtrField2} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load double*, double** ${dataPtrField2}, !tbaa !5`);

  const destPtr = gen.nextTemp();
  gen.emit(`${destPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 1`);
  const destI8 = gen.nextTemp();
  gen.emit(`${destI8} = bitcast double* ${destPtr} to i8*`);
  const srcI8 = gen.nextTemp();
  gen.emit(`${srcI8} = bitcast double* ${dataPtr} to i8*`);
  const moveLenI64 = gen.nextTemp();
  gen.emit(`${moveLenI64} = zext i32 ${currentLen} to i64`);
  const moveBytes = gen.nextTemp();
  gen.emit(`${moveBytes} = mul i64 ${moveLenI64}, 8`);
  gen.emit(
    `call void @llvm.memmove.p0i8.p0i8.i64(i8* ${destI8}, i8* ${srcI8}, i64 ${moveBytes}, i1 false)`,
  );

  const dblValue = gen.ensureDouble(value);
  gen.emit(`store double ${dblValue}, double* ${dataPtr}, !tbaa !4`);

  const newLen = gen.nextTemp();
  gen.emit(`${newLen} = add i32 ${currentLen}, 1`);
  gen.emit(`store i32 ${newLen}, i32* ${lenPtr}`);

  const newLenDouble = gen.nextTemp();
  gen.emit(`${newLenDouble} = sitofp i32 ${newLen} to double`);
  gen.setVariableType(newLenDouble, "double");
  return newLenDouble;
}

function generateStringArrayUnshift(
  gen: ArrayReorderContext,
  arrayPtr: string,
  value: string,
): string {
  const lenPtr = gen.nextTemp();
  gen.emit(
    `${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`,
  );
  const currentLen = gen.nextTemp();
  gen.emit(`${currentLen} = load i32, i32* ${lenPtr}`);

  const capPtr = gen.nextTemp();
  gen.emit(
    `${capPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 2`,
  );
  const currentCap = gen.nextTemp();
  gen.emit(`${currentCap} = load i32, i32* ${capPtr}`);

  const needResize = gen.nextTemp();
  gen.emit(`${needResize} = icmp eq i32 ${currentLen}, ${currentCap}`);

  const resizeLabel = gen.nextLabel("unshift_resize");
  const continueLabel = gen.nextLabel("unshift_continue");

  gen.emit(`br i1 ${needResize}, label %${resizeLabel}, label %${continueLabel}`);

  gen.emit(`${resizeLabel}:`);
  const isZero = gen.nextTemp();
  gen.emit(`${isZero} = icmp eq i32 ${currentCap}, 0`);
  const doubled = gen.nextTemp();
  gen.emit(`${doubled} = mul i32 ${currentCap}, 2`);
  const newCap = gen.nextTemp();
  gen.emit(`${newCap} = select i1 ${isZero}, i32 2, i32 ${doubled}`);

  const newCapI64 = gen.nextTemp();
  gen.emit(`${newCapI64} = zext i32 ${newCap} to i64`);
  const newMemSize = gen.nextTemp();
  gen.emit(`${newMemSize} = mul i64 ${newCapI64}, 8`);
  const newMem = gen.nextTemp();
  gen.emit(`${newMem} = call i8* @GC_malloc(i64 ${newMemSize})`);
  const newDataPtr = gen.nextTemp();
  gen.emit(`${newDataPtr} = bitcast i8* ${newMem} to i8**`);

  const dataPtrField = gen.nextTemp();
  gen.emit(
    `${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
  );
  const oldDataPtr = gen.nextTemp();
  gen.emit(`${oldDataPtr} = load i8**, i8*** ${dataPtrField}`);
  const oldDataI8 = gen.nextTemp();
  gen.emit(`${oldDataI8} = bitcast i8** ${oldDataPtr} to i8*`);
  const newDataI8 = gen.nextTemp();
  gen.emit(`${newDataI8} = bitcast i8** ${newDataPtr} to i8*`);
  const currentLenI64 = gen.nextTemp();
  gen.emit(`${currentLenI64} = zext i32 ${currentLen} to i64`);
  const copySize = gen.nextTemp();
  gen.emit(`${copySize} = mul i64 ${currentLenI64}, 8`);
  gen.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newDataI8}, i8* ${oldDataI8}, i64 ${copySize}, i1 false)`,
  );

  gen.emit(`store i8** ${newDataPtr}, i8*** ${dataPtrField}`);
  gen.emit(`store i32 ${newCap}, i32* ${capPtr}`);
  gen.emit(`br label %${continueLabel}`);

  gen.emit(`${continueLabel}:`);

  const dataPtrField2 = gen.nextTemp();
  gen.emit(
    `${dataPtrField2} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
  );
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField2}, !tbaa !5`);

  const destPtr = gen.nextTemp();
  gen.emit(`${destPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 1`);
  const destI8 = gen.nextTemp();
  gen.emit(`${destI8} = bitcast i8* ${destPtr} to i8*`);
  const srcI8 = gen.nextTemp();
  gen.emit(`${srcI8} = bitcast i8** ${dataPtr} to i8*`);
  const moveLenI64 = gen.nextTemp();
  gen.emit(`${moveLenI64} = zext i32 ${currentLen} to i64`);
  const moveBytes = gen.nextTemp();
  gen.emit(`${moveBytes} = mul i64 ${moveLenI64}, 8`);
  gen.emit(
    `call void @llvm.memmove.p0i8.p0i8.i64(i8* ${destI8}, i8* ${srcI8}, i64 ${moveBytes}, i1 false)`,
  );

  gen.emit(`store i8* ${value}, i8** ${dataPtr}, !tbaa !5`);

  const newLen = gen.nextTemp();
  gen.emit(`${newLen} = add i32 ${currentLen}, 1`);
  gen.emit(`store i32 ${newLen}, i32* ${lenPtr}`);

  const newLenDouble = gen.nextTemp();
  gen.emit(`${newLenDouble} = sitofp i32 ${newLen} to double`);
  gen.setVariableType(newLenDouble, "double");
  return newLenDouble;
}
