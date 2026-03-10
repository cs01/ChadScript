// Array reorder operations: reverse, shift, unshift.
// Uses structured IR builders where possible; raw emit() for inbounds GEP, intrinsics, etc.

import { MethodCallNode, VariableNode } from "../../../../ast/types.js";
import { IGeneratorContext } from "./context.js";

interface ExprBase {
  type: string;
}

export function generateArrayReverse(
  gen: IGeneratorContext,
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

function generateNumericArrayReverseInPlace(gen: IGeneratorContext, arrayPtr: string): string {
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const length = gen.nextTemp();
  gen.emit(`${length} = load i32, i32* ${lenPtr}`);

  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load double*, double** ${dataPtrField}`);

  const half = gen.nextTemp();
  gen.emit(`${half} = sdiv i32 ${length}, 2`);
  const lastIdx = gen.nextTemp();
  gen.emit(`${lastIdx} = sub i32 ${length}, 1`);

  const loopPtr = gen.nextTemp();
  gen.emit(`${loopPtr} = alloca i32`);
  gen.emitStore("i32", "0", loopPtr);

  const checkLabel = gen.nextLabel("rev_check");
  const bodyLabel = gen.nextLabel("rev_body");
  const endLabel = gen.nextLabel("rev_end");

  gen.emitBr(checkLabel);

  gen.emitLabel(checkLabel);
  const i = gen.emitLoad("i32", loopPtr);
  const cond = gen.emitIcmp("slt", "i32", i, half);
  gen.emitBrCond(cond, bodyLabel, endLabel);

  gen.emitLabel(bodyLabel);
  const j = gen.nextTemp();
  gen.emit(`${j} = sub i32 ${lastIdx}, ${i}`);

  const ptrI = gen.nextTemp();
  gen.emit(`${ptrI} = getelementptr inbounds double, double* ${dataPtr}, i32 ${i}`);
  const valI = gen.emitLoad("double", ptrI);

  const ptrJ = gen.nextTemp();
  gen.emit(`${ptrJ} = getelementptr inbounds double, double* ${dataPtr}, i32 ${j}`);
  const valJ = gen.emitLoad("double", ptrJ);

  gen.emitStore("double", valJ, ptrI);
  gen.emitStore("double", valI, ptrJ);

  const nextI = gen.nextTemp();
  gen.emit(`${nextI} = add i32 ${i}, 1`);
  gen.emitStore("i32", nextI, loopPtr);
  gen.emitBr(checkLabel);

  gen.emitLabel(endLabel);

  gen.setVariableType(arrayPtr, "%Array*");
  return arrayPtr;
}

function generateStringArrayReverseInPlace(gen: IGeneratorContext, arrayPtr: string): string {
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
  gen.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField}`);

  const half = gen.nextTemp();
  gen.emit(`${half} = sdiv i32 ${length}, 2`);
  const lastIdx = gen.nextTemp();
  gen.emit(`${lastIdx} = sub i32 ${length}, 1`);

  const loopPtr = gen.nextTemp();
  gen.emit(`${loopPtr} = alloca i32`);
  gen.emitStore("i32", "0", loopPtr);

  const checkLabel = gen.nextLabel("rev_check");
  const bodyLabel = gen.nextLabel("rev_body");
  const endLabel = gen.nextLabel("rev_end");

  gen.emitBr(checkLabel);

  gen.emitLabel(checkLabel);
  const i = gen.emitLoad("i32", loopPtr);
  const cond = gen.emitIcmp("slt", "i32", i, half);
  gen.emitBrCond(cond, bodyLabel, endLabel);

  gen.emitLabel(bodyLabel);
  const j = gen.nextTemp();
  gen.emit(`${j} = sub i32 ${lastIdx}, ${i}`);

  const ptrI = gen.nextTemp();
  gen.emit(`${ptrI} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${i}`);
  const valI = gen.emitLoad("i8*", ptrI);

  const ptrJ = gen.nextTemp();
  gen.emit(`${ptrJ} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${j}`);
  const valJ = gen.emitLoad("i8*", ptrJ);

  gen.emitStore("i8*", valJ, ptrI);
  gen.emitStore("i8*", valI, ptrJ);

  const nextI = gen.nextTemp();
  gen.emit(`${nextI} = add i32 ${i}, 1`);
  gen.emitStore("i32", nextI, loopPtr);
  gen.emitBr(checkLabel);

  gen.emitLabel(endLabel);

  gen.setVariableType(arrayPtr, "%StringArray*");
  return arrayPtr;
}

export function generateArrayShift(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length !== 0) {
    throw new Error("shift() requires 0 arguments");
  }

  const arrayPtr = gen.generateExpression(expr.object, params);

  let isStringArray = false;
  let isObjectArray = false;
  const exprObjBase = expr.object as ExprBase;
  if (exprObjBase.type === "variable") {
    const varName = (expr.object as VariableNode).name;
    const varType = gen.getVariableType(varName);
    isStringArray = varType === "%StringArray*" || varType === "%StringArray";
    isObjectArray = varType === "%ObjectArray*" || varType === "%ObjectArray";
  }
  if (!isStringArray && !isObjectArray) {
    const ptrType = gen.getVariableType(arrayPtr);
    if (ptrType === "%StringArray*" || ptrType === "%StringArray") isStringArray = true;
    else if (ptrType === "%ObjectArray*" || ptrType === "%ObjectArray") isObjectArray = true;
  }

  if (isStringArray) {
    return generateStringArrayShift(gen, arrayPtr);
  }
  if (isObjectArray) {
    return generateObjectArrayShift(gen, arrayPtr);
  }
  return generateNumericArrayShift(gen, arrayPtr);
}

function generateNumericArrayShift(gen: IGeneratorContext, arrayPtr: string): string {
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const currentLen = gen.nextTemp();
  gen.emit(`${currentLen} = load i32, i32* ${lenPtr}`);

  const isEmpty = gen.emitIcmp("eq", "i32", currentLen, "0");

  const emptyLabel = gen.nextLabel("shift_empty");
  const notEmptyLabel = gen.nextLabel("shift_notempty");
  const endLabel = gen.nextLabel("shift_end");

  gen.emitBrCond(isEmpty, emptyLabel, notEmptyLabel);

  gen.emitLabel(emptyLabel);
  gen.emitBr(endLabel);

  gen.emitLabel(notEmptyLabel);
  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load double*, double** ${dataPtrField}`);

  const firstElem = gen.emitLoad("double", dataPtr);

  const newLen = gen.nextTemp();
  gen.emit(`${newLen} = sub i32 ${currentLen}, 1`);

  const destI8 = gen.emitBitcast(dataPtr, "double*", "i8*");
  const srcPtr = gen.nextTemp();
  gen.emit(`${srcPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 1`);
  const srcI8 = gen.emitBitcast(srcPtr, "double*", "i8*");
  const moveLen = gen.nextTemp();
  gen.emit(`${moveLen} = zext i32 ${newLen} to i64`);
  const moveBytes = gen.nextTemp();
  gen.emit(`${moveBytes} = mul i64 ${moveLen}, 8`);
  gen.emit(
    `call void @llvm.memmove.p0i8.p0i8.i64(i8* ${destI8}, i8* ${srcI8}, i64 ${moveBytes}, i1 false)`,
  );

  gen.emitStore("i32", newLen, lenPtr);
  gen.emitBr(endLabel);

  gen.emitLabel(endLabel);
  const result = gen.nextTemp();
  gen.emit(`${result} = phi double [ 0.0, %${emptyLabel} ], [ ${firstElem}, %${notEmptyLabel} ]`);
  gen.setVariableType(result, "double");
  return result;
}

function generateStringArrayShift(gen: IGeneratorContext, arrayPtr: string): string {
  const lenPtr = gen.nextTemp();
  gen.emit(
    `${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`,
  );
  const currentLen = gen.nextTemp();
  gen.emit(`${currentLen} = load i32, i32* ${lenPtr}`);

  const isEmpty = gen.emitIcmp("eq", "i32", currentLen, "0");

  const emptyLabel = gen.nextLabel("shift_empty");
  const notEmptyLabel = gen.nextLabel("shift_notempty");
  const endLabel = gen.nextLabel("shift_end");

  gen.emitBrCond(isEmpty, emptyLabel, notEmptyLabel);

  gen.emitLabel(emptyLabel);
  const emptyStr = gen.emitCall("i8*", "@GC_malloc_atomic", "i64 1");
  gen.emitStore("i8", "0", emptyStr);
  gen.emitBr(endLabel);

  gen.emitLabel(notEmptyLabel);
  const dataPtrField = gen.nextTemp();
  gen.emit(
    `${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
  );
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField}`);

  const firstElem = gen.emitLoad("i8*", dataPtr);

  const newLen = gen.nextTemp();
  gen.emit(`${newLen} = sub i32 ${currentLen}, 1`);

  const destI8 = gen.emitBitcast(dataPtr, "i8**", "i8*");
  const srcPtr = gen.nextTemp();
  gen.emit(`${srcPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 1`);
  // srcPtr is i8* (GEP result of i8** → i8*), cast to i8* for memmove
  const srcI8 = gen.emitBitcast(srcPtr, "i8*", "i8*");
  const moveLen = gen.nextTemp();
  gen.emit(`${moveLen} = zext i32 ${newLen} to i64`);
  const moveBytes = gen.nextTemp();
  gen.emit(`${moveBytes} = mul i64 ${moveLen}, 8`);
  gen.emit(
    `call void @llvm.memmove.p0i8.p0i8.i64(i8* ${destI8}, i8* ${srcI8}, i64 ${moveBytes}, i1 false)`,
  );

  gen.emitStore("i32", newLen, lenPtr);
  gen.emitBr(endLabel);

  gen.emitLabel(endLabel);
  const result = gen.nextTemp();
  gen.emit(
    `${result} = phi i8* [ ${emptyStr}, %${emptyLabel} ], [ ${firstElem}, %${notEmptyLabel} ]`,
  );
  gen.setVariableType(result, "i8*");
  return result;
}

function generateObjectArrayShift(gen: IGeneratorContext, arrayPtr: string): string {
  const lenPtr = gen.nextTemp();
  gen.emit(
    `${lenPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 1`,
  );
  const currentLen = gen.nextTemp();
  gen.emit(`${currentLen} = load i32, i32* ${lenPtr}`);

  const isEmpty = gen.emitIcmp("eq", "i32", currentLen, "0");

  const emptyLabel = gen.nextLabel("shift_empty");
  const notEmptyLabel = gen.nextLabel("shift_notempty");
  const endLabel = gen.nextLabel("shift_end");

  gen.emitBrCond(isEmpty, emptyLabel, notEmptyLabel);

  gen.emitLabel(emptyLabel);
  const nullPtr = gen.nextTemp();
  gen.emit(`${nullPtr} = inttoptr i64 0 to i8*`);
  gen.emitBr(endLabel);

  gen.emitLabel(notEmptyLabel);
  const dataPtrField = gen.nextTemp();
  gen.emit(
    `${dataPtrField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`,
  );
  const dataPtrRaw = gen.emitLoad("i8*", dataPtrField);
  const dataPtr = gen.emitBitcast(dataPtrRaw, "i8*", "i8**");

  const firstElem = gen.emitLoad("i8*", dataPtr);

  const newLen = gen.nextTemp();
  gen.emit(`${newLen} = sub i32 ${currentLen}, 1`);

  const destI8 = gen.emitBitcast(dataPtr, "i8**", "i8*");
  const srcPtr = gen.nextTemp();
  gen.emit(`${srcPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 1`);
  const srcI8 = gen.emitBitcast(srcPtr, "i8*", "i8*");
  const moveLen = gen.nextTemp();
  gen.emit(`${moveLen} = zext i32 ${newLen} to i64`);
  const moveBytes = gen.nextTemp();
  gen.emit(`${moveBytes} = mul i64 ${moveLen}, 8`);
  gen.emit(
    `call void @llvm.memmove.p0i8.p0i8.i64(i8* ${destI8}, i8* ${srcI8}, i64 ${moveBytes}, i1 false)`,
  );

  gen.emitStore("i32", newLen, lenPtr);
  gen.emitBr(endLabel);

  gen.emitLabel(endLabel);
  const result = gen.nextTemp();
  gen.emit(
    `${result} = phi i8* [ ${nullPtr}, %${emptyLabel} ], [ ${firstElem}, %${notEmptyLabel} ]`,
  );
  gen.setVariableType(result, "i8*");
  return result;
}

export function generateArrayUnshift(
  gen: IGeneratorContext,
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
  gen: IGeneratorContext,
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

  const needResize = gen.emitIcmp("eq", "i32", currentLen, currentCap);

  const resizeLabel = gen.nextLabel("unshift_resize");
  const continueLabel = gen.nextLabel("unshift_continue");

  gen.emitBrCond(needResize, resizeLabel, continueLabel);

  gen.emitLabel(resizeLabel);
  const isZero = gen.emitIcmp("eq", "i32", currentCap, "0");
  const doubled = gen.nextTemp();
  gen.emit(`${doubled} = mul i32 ${currentCap}, 2`);
  const newCap = gen.nextTemp();
  gen.emit(`${newCap} = select i1 ${isZero}, i32 2, i32 ${doubled}`);

  const newCapI64 = gen.nextTemp();
  gen.emit(`${newCapI64} = zext i32 ${newCap} to i64`);
  const newMemSize = gen.nextTemp();
  gen.emit(`${newMemSize} = mul i64 ${newCapI64}, 8`);
  const newMem = gen.emitCall("i8*", "@GC_malloc_atomic", `i64 ${newMemSize}`);
  const newDataPtr = gen.emitBitcast(newMem, "i8*", "double*");

  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const oldDataPtr = gen.emitLoad("double*", dataPtrField);
  const oldDataI8 = gen.emitBitcast(oldDataPtr, "double*", "i8*");
  const newDataI8 = gen.emitBitcast(newDataPtr, "double*", "i8*");
  const currentLenI64 = gen.nextTemp();
  gen.emit(`${currentLenI64} = zext i32 ${currentLen} to i64`);
  const copySize = gen.nextTemp();
  gen.emit(`${copySize} = mul i64 ${currentLenI64}, 8`);
  gen.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newDataI8}, i8* ${oldDataI8}, i64 ${copySize}, i1 false)`,
  );

  gen.emitStore("double*", newDataPtr, dataPtrField);
  gen.emitStore("i32", newCap, capPtr);
  gen.emitBr(continueLabel);

  gen.emitLabel(continueLabel);

  const dataPtrField2 = gen.nextTemp();
  gen.emit(`${dataPtrField2} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load double*, double** ${dataPtrField2}`);

  const destPtr = gen.nextTemp();
  gen.emit(`${destPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 1`);
  const destI8 = gen.emitBitcast(destPtr, "double*", "i8*");
  const srcI8 = gen.emitBitcast(dataPtr, "double*", "i8*");
  const moveLenI64 = gen.nextTemp();
  gen.emit(`${moveLenI64} = zext i32 ${currentLen} to i64`);
  const moveBytes = gen.nextTemp();
  gen.emit(`${moveBytes} = mul i64 ${moveLenI64}, 8`);
  gen.emit(
    `call void @llvm.memmove.p0i8.p0i8.i64(i8* ${destI8}, i8* ${srcI8}, i64 ${moveBytes}, i1 false)`,
  );

  const dblValue = gen.ensureDouble(value);
  gen.emit(`store double ${dblValue}, double* ${dataPtr}`);

  const newLen = gen.nextTemp();
  gen.emit(`${newLen} = add i32 ${currentLen}, 1`);
  gen.emitStore("i32", newLen, lenPtr);

  const newLenDouble = gen.nextTemp();
  gen.emit(`${newLenDouble} = sitofp i32 ${newLen} to double`);
  gen.setVariableType(newLenDouble, "double");
  return newLenDouble;
}

function generateStringArrayUnshift(
  gen: IGeneratorContext,
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

  const needResize = gen.emitIcmp("eq", "i32", currentLen, currentCap);

  const resizeLabel = gen.nextLabel("unshift_resize");
  const continueLabel = gen.nextLabel("unshift_continue");

  gen.emitBrCond(needResize, resizeLabel, continueLabel);

  gen.emitLabel(resizeLabel);
  const isZero = gen.emitIcmp("eq", "i32", currentCap, "0");
  const doubled = gen.nextTemp();
  gen.emit(`${doubled} = mul i32 ${currentCap}, 2`);
  const newCap = gen.nextTemp();
  gen.emit(`${newCap} = select i1 ${isZero}, i32 2, i32 ${doubled}`);

  const newCapI64 = gen.nextTemp();
  gen.emit(`${newCapI64} = zext i32 ${newCap} to i64`);
  const newMemSize = gen.nextTemp();
  gen.emit(`${newMemSize} = mul i64 ${newCapI64}, 8`);
  const newMem = gen.emitCall("i8*", "@GC_malloc", `i64 ${newMemSize}`);
  const newDataPtr = gen.emitBitcast(newMem, "i8*", "i8**");

  const dataPtrField = gen.nextTemp();
  gen.emit(
    `${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
  );
  const oldDataPtr = gen.emitLoad("i8**", dataPtrField);
  const oldDataI8 = gen.emitBitcast(oldDataPtr, "i8**", "i8*");
  const newDataI8 = gen.emitBitcast(newDataPtr, "i8**", "i8*");
  const currentLenI64 = gen.nextTemp();
  gen.emit(`${currentLenI64} = zext i32 ${currentLen} to i64`);
  const copySize = gen.nextTemp();
  gen.emit(`${copySize} = mul i64 ${currentLenI64}, 8`);
  gen.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newDataI8}, i8* ${oldDataI8}, i64 ${copySize}, i1 false)`,
  );

  gen.emitStore("i8**", newDataPtr, dataPtrField);
  gen.emitStore("i32", newCap, capPtr);
  gen.emitBr(continueLabel);

  gen.emitLabel(continueLabel);

  const dataPtrField2 = gen.nextTemp();
  gen.emit(
    `${dataPtrField2} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
  );
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField2}`);

  const destPtr = gen.nextTemp();
  gen.emit(`${destPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 1`);
  // destPtr GEP result type is i8*, needs cast to i8* for memmove (identity cast, keeps IR identical)
  const destI8 = gen.emitBitcast(destPtr, "i8*", "i8*");
  const srcI8 = gen.emitBitcast(dataPtr, "i8**", "i8*");
  const moveLenI64 = gen.nextTemp();
  gen.emit(`${moveLenI64} = zext i32 ${currentLen} to i64`);
  const moveBytes = gen.nextTemp();
  gen.emit(`${moveBytes} = mul i64 ${moveLenI64}, 8`);
  gen.emit(
    `call void @llvm.memmove.p0i8.p0i8.i64(i8* ${destI8}, i8* ${srcI8}, i64 ${moveBytes}, i1 false)`,
  );

  gen.emit(`store i8* ${value}, i8** ${dataPtr}`);

  const newLen = gen.nextTemp();
  gen.emit(`${newLen} = add i32 ${currentLen}, 1`);
  gen.emitStore("i32", newLen, lenPtr);

  const newLenDouble = gen.nextTemp();
  gen.emit(`${newLenDouble} = sitofp i32 ${newLen} to double`);
  gen.setVariableType(newLenDouble, "double");
  return newLenDouble;
}
