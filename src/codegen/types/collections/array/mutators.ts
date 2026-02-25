// Array mutator operations: push, pop.
// Uses structured IR builders where possible; raw emit() for inbounds GEP, intrinsics, etc.

import { MethodCallNode, VariableNode } from "../../../../ast/types.js";
import { IGeneratorContext } from "./context.js";

interface ExprBase {
  type: string;
}

/**
 * Array mutator operations (push, pop)
 */

export function generateArrayPush(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  // arr.push(value) - adds value to array and returns new length
  if (expr.args.length !== 1) {
    throw new Error("push() requires exactly 1 argument");
  }

  const arrayPtr = gen.generateExpression(expr.object, params);
  const value = gen.generateExpression(expr.args[0], params);

  // Determine array type from the array variable/expression
  let isStringArray = false;
  let isObjectArray = false;
  const exprObjBase = expr.object as ExprBase;
  if (exprObjBase.type === "variable") {
    const varNode = expr.object as VariableNode;
    const varName = varNode.name;
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
    return generateStringArrayPush(gen, arrayPtr, value);
  }

  if (isObjectArray) {
    const valueType = gen.getVariableType(value) || "i8*";
    return generateObjectArrayPush(gen, arrayPtr, value, valueType);
  }

  const valueType = gen.getVariableType(value);
  if (valueType === "i8*") {
    return generateStringArrayPush(gen, arrayPtr, value);
  }
  if (valueType && valueType.endsWith("*") && valueType !== "double*") {
    return generateObjectArrayPush(gen, arrayPtr, value, valueType);
  }

  return generateIntArrayPush(gen, arrayPtr, value);
}

export function generateArrayPop(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  // arr.pop() - removes and returns last element
  if (expr.args.length !== 0) {
    throw new Error("pop() requires 0 arguments");
  }

  const arrayPtr = gen.generateExpression(expr.object, params);

  // Determine array type
  let isStringArray = false;
  let isPointerArray = false;
  const exprObjBase2 = expr.object as ExprBase;
  if (exprObjBase2.type === "variable") {
    const varNode = expr.object as VariableNode;
    const varName = varNode.name;
    const varType = gen.getVariableType(varName);
    isStringArray = varType === "%StringArray*" || varType === "%StringArray";
    isPointerArray = varType === "i8*";
  }
  if (!isStringArray && !isPointerArray) {
    const ptrType = gen.getVariableType(arrayPtr);
    if (ptrType === "%StringArray*" || ptrType === "%StringArray") isStringArray = true;
    else if (ptrType === "i8*") isPointerArray = true;
  }

  if (isStringArray) {
    return generateStringArrayPop(gen, arrayPtr);
  } else if (isPointerArray) {
    return generatePointerArrayPop(gen, arrayPtr);
  } else {
    return generateIntArrayPop(gen, arrayPtr);
  }
}

function generateIntArrayPop(gen: IGeneratorContext, arrayPtr: string): string {
  // Pop from %Array (int/boolean array)

  // Load current length
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const currentLen = gen.nextTemp();
  gen.emit(`${currentLen} = load i32, i32* ${lenPtr}`);

  // Check if array is empty
  const isEmpty = gen.emitIcmp("eq", "i32", currentLen, "0");

  const emptyLabel = gen.nextLabel("pop_empty");
  const notEmptyLabel = gen.nextLabel("pop_notempty");
  const endLabel = gen.nextLabel("pop_end");

  gen.emitBrCond(isEmpty, emptyLabel, notEmptyLabel);

  // Empty case - return 0.0
  gen.emitLabel(emptyLabel);
  gen.emitBr(endLabel);

  // Not empty - pop element
  gen.emitLabel(notEmptyLabel);

  // Calculate index of last element (length - 1)
  const lastIndex = gen.nextTemp();
  gen.emit(`${lastIndex} = sub i32 ${currentLen}, 1`);

  // Get data pointer
  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load double*, double** ${dataPtrField}`);

  // Load last element
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${lastIndex}`);
  const lastElem = gen.nextTemp();
  gen.emit(`${lastElem} = load double, double* ${elemPtr}`);

  // Decrement length
  gen.emitStore("i32", lastIndex, lenPtr);

  gen.emitBr(endLabel);

  // End - phi node to select result
  gen.emitLabel(endLabel);
  const result = gen.nextTemp();
  gen.emit(`${result} = phi double [ 0.0, %${emptyLabel} ], [ ${lastElem}, %${notEmptyLabel} ]`);

  return result;
}

function generateStringArrayPop(gen: IGeneratorContext, arrayPtr: string): string {
  // Pop from %StringArray (string array)

  // Load current length
  const lenPtr = gen.nextTemp();
  gen.emit(
    `${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`,
  );
  const currentLen = gen.nextTemp();
  gen.emit(`${currentLen} = load i32, i32* ${lenPtr}`);

  // Check if array is empty
  const isEmpty = gen.emitIcmp("eq", "i32", currentLen, "0");

  const emptyLabel = gen.nextLabel("pop_empty");
  const notEmptyLabel = gen.nextLabel("pop_notempty");
  const endLabel = gen.nextLabel("pop_end");

  gen.emitBrCond(isEmpty, emptyLabel, notEmptyLabel);

  // Empty case - return empty string
  gen.emitLabel(emptyLabel);
  const emptyStr = gen.emitCall("i8*", "@GC_malloc_atomic", "i64 1");
  gen.emitStore("i8", "0", emptyStr);
  gen.emitBr(endLabel);

  // Not empty - pop element
  gen.emitLabel(notEmptyLabel);

  // Calculate index of last element (length - 1)
  const lastIndex = gen.nextTemp();
  gen.emit(`${lastIndex} = sub i32 ${currentLen}, 1`);

  // Get data pointer
  const dataPtrField = gen.nextTemp();
  gen.emit(
    `${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
  );
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField}`);

  // Load last element
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${lastIndex}`);
  const lastElem = gen.nextTemp();
  gen.emit(`${lastElem} = load i8*, i8** ${elemPtr}`);

  // Decrement length
  gen.emitStore("i32", lastIndex, lenPtr);

  gen.emitBr(endLabel);

  // End - phi node to select result
  gen.emitLabel(endLabel);
  const result = gen.nextTemp();
  gen.emit(
    `${result} = phi i8* [ ${emptyStr}, %${emptyLabel} ], [ ${lastElem}, %${notEmptyLabel} ]`,
  );
  gen.setVariableType(result, "i8*");

  return result;
}

function generatePointerArrayPop(gen: IGeneratorContext, arrayPtr: string): string {
  const castPtr = gen.emitBitcast(arrayPtr, "i8*", "%Array*");

  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${castPtr}, i32 0, i32 1`);
  const currentLen = gen.nextTemp();
  gen.emit(`${currentLen} = load i32, i32* ${lenPtr}`);

  const isEmpty = gen.emitIcmp("eq", "i32", currentLen, "0");

  const emptyLabel = gen.nextLabel("pop_empty");
  const notEmptyLabel = gen.nextLabel("pop_notempty");
  const endLabel = gen.nextLabel("pop_end");

  gen.emitBrCond(isEmpty, emptyLabel, notEmptyLabel);

  gen.emitLabel(emptyLabel);
  const nullPtr = gen.nextTemp();
  gen.emit(`${nullPtr} = inttoptr i64 0 to i8*`);
  gen.emitBr(endLabel);

  gen.emitLabel(notEmptyLabel);

  const lastIndex = gen.nextTemp();
  gen.emit(`${lastIndex} = sub i32 ${currentLen}, 1`);

  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${castPtr}, i32 0, i32 0`);
  const dataPtrRaw = gen.nextTemp();
  gen.emit(`${dataPtrRaw} = load double*, double** ${dataPtrField}`);
  const dataPtr = gen.emitBitcast(dataPtrRaw, "double*", "i8**");

  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${lastIndex}`);
  const lastElem = gen.nextTemp();
  gen.emit(`${lastElem} = load i8*, i8** ${elemPtr}`);

  gen.emitStore("i32", lastIndex, lenPtr);

  gen.emitBr(endLabel);

  gen.emitLabel(endLabel);
  const result = gen.nextTemp();
  gen.emit(
    `${result} = phi i8* [ ${nullPtr}, %${emptyLabel} ], [ ${lastElem}, %${notEmptyLabel} ]`,
  );
  gen.setVariableType(result, "i8*");

  return result;
}

function generateIntArrayPush(gen: IGeneratorContext, arrayPtr: string, value: string): string {
  // Push to %Array (int/boolean array)

  // Load current length
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const currentLen = gen.nextTemp();
  gen.emit(`${currentLen} = load i32, i32* ${lenPtr}`);

  // Load current capacity
  const capPtr = gen.nextTemp();
  gen.emit(`${capPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
  const currentCap = gen.nextTemp();
  gen.emit(`${currentCap} = load i32, i32* ${capPtr}`);

  // Check if we need to resize (length == capacity)
  const needResize = gen.emitIcmp("eq", "i32", currentLen, currentCap);

  // Create labels for resize and continue paths
  const resizeLabel = gen.nextLabel("resize");
  const continueLabel = gen.nextLabel("continue");

  gen.emitBrCond(needResize, resizeLabel, continueLabel);

  // Resize block
  gen.emitLabel(resizeLabel);
  // Handle case where currentCap is 0 - set to 2, otherwise double it
  const isZero = gen.emitIcmp("eq", "i32", currentCap, "0");
  const doubled = gen.nextTemp();
  gen.emit(`${doubled} = mul i32 ${currentCap}, 2`);
  const newCap = gen.nextTemp();
  gen.emit(`${newCap} = select i1 ${isZero}, i32 2, i32 ${doubled}`);

  // Allocate new data array with GC_malloc_atomic for zero-initialized numeric memory
  const newCapI64 = gen.nextTemp();
  gen.emit(`${newCapI64} = zext i32 ${newCap} to i64`);
  const newMemSize = gen.nextTemp();
  gen.emit(`${newMemSize} = mul i64 ${newCapI64}, 8`);
  const newMem = gen.emitCall("i8*", "@GC_malloc_atomic", `i64 ${newMemSize}`);
  const newDataPtr = gen.emitBitcast(newMem, "i8*", "double*");

  // Copy old data to new array
  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const oldDataPtr = gen.emitLoad("double*", dataPtrField);

  const oldDataI8 = gen.emitBitcast(oldDataPtr, "double*", "i8*");
  const newDataI8 = gen.emitBitcast(newDataPtr, "double*", "i8*");
  // Compute copy size dynamically based on double size
  const doubleSize = gen.getDoubleSize();
  const currentLenI64 = gen.nextTemp();
  gen.emit(`${currentLenI64} = zext i32 ${currentLen} to i64`);
  const copySizeI64 = gen.nextTemp();
  gen.emit(`${copySizeI64} = mul i64 ${currentLenI64}, ${doubleSize}`);
  gen.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newDataI8}, i8* ${oldDataI8}, i64 ${copySizeI64}, i1 false)`,
  );

  // Update pointer (GC will free old data)
  gen.emitStore("double*", newDataPtr, dataPtrField);

  // Update capacity
  gen.emitStore("i32", newCap, capPtr);

  gen.emitBr(continueLabel);

  // Continue block
  gen.emitLabel(continueLabel);

  // Get current data pointer (may have been updated)
  const dataPtrField2 = gen.nextTemp();
  gen.emit(`${dataPtrField2} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load double*, double** ${dataPtrField2}`);

  // Store value at current length index
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${currentLen}`);
  const dblValue = gen.ensureDouble(value);
  gen.emit(`store double ${dblValue}, double* ${elemPtr}`);

  // Increment length
  const newLen = gen.nextTemp();
  gen.emit(`${newLen} = add i32 ${currentLen}, 1`);
  gen.emitStore("i32", newLen, lenPtr);

  // Return new length as double (JavaScript semantics)
  const newLenDouble = gen.nextTemp();
  gen.emit(`${newLenDouble} = sitofp i32 ${newLen} to double`);
  gen.setVariableType(newLenDouble, "double");
  return newLenDouble;
}

function generateStringArrayPush(gen: IGeneratorContext, arrayPtr: string, value: string): string {
  // Push to %StringArray (string array)

  // Load current length
  const lenPtr = gen.nextTemp();
  gen.emit(
    `${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`,
  );
  const currentLen = gen.nextTemp();
  gen.emit(`${currentLen} = load i32, i32* ${lenPtr}`);

  // Load current capacity
  const capPtr = gen.nextTemp();
  gen.emit(
    `${capPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 2`,
  );
  const currentCap = gen.nextTemp();
  gen.emit(`${currentCap} = load i32, i32* ${capPtr}`);

  // Check if we need to resize (length == capacity)
  const needResize = gen.emitIcmp("eq", "i32", currentLen, currentCap);

  // Create labels for resize and continue paths
  const resizeLabel = gen.nextLabel("resize");
  const continueLabel = gen.nextLabel("continue");

  gen.emitBrCond(needResize, resizeLabel, continueLabel);

  // Resize block
  gen.emitLabel(resizeLabel);
  // Handle case where currentCap is 0 - set to 2, otherwise double it
  const isZero = gen.emitIcmp("eq", "i32", currentCap, "0");
  const doubled = gen.nextTemp();
  gen.emit(`${doubled} = mul i32 ${currentCap}, 2`);
  const newCap = gen.nextTemp();
  gen.emit(`${newCap} = select i1 ${isZero}, i32 2, i32 ${doubled}`);

  // Allocate new data array (i8** - array of string pointers) with GC_malloc (contains pointers)
  const newCapI64 = gen.nextTemp();
  gen.emit(`${newCapI64} = zext i32 ${newCap} to i64`);
  const newMemSize = gen.nextTemp();
  gen.emit(`${newMemSize} = mul i64 ${newCapI64}, 8`);
  const newMem = gen.emitCall("i8*", "@GC_malloc", `i64 ${newMemSize}`);
  const newDataPtr = gen.emitBitcast(newMem, "i8*", "i8**");

  // Copy old data to new array
  const dataPtrField = gen.nextTemp();
  gen.emit(
    `${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
  );
  const oldDataPtr = gen.emitLoad("i8**", dataPtrField);

  const oldDataI8 = gen.emitBitcast(oldDataPtr, "i8**", "i8*");
  const newDataI8 = gen.emitBitcast(newDataPtr, "i8**", "i8*");
  const copySize = gen.nextTemp();
  gen.emit(`${copySize} = mul i32 ${currentLen}, 8`); // 8 bytes per pointer
  const copySizeI64 = gen.nextTemp();
  gen.emit(`${copySizeI64} = zext i32 ${copySize} to i64`);
  gen.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newDataI8}, i8* ${oldDataI8}, i64 ${copySizeI64}, i1 false)`,
  );

  // Update pointer (GC will free old data)
  gen.emitStore("i8**", newDataPtr, dataPtrField);

  // Update capacity
  gen.emitStore("i32", newCap, capPtr);

  gen.emitBr(continueLabel);

  // Continue block
  gen.emitLabel(continueLabel);

  // Get current data pointer (may have been updated)
  const dataPtrField2 = gen.nextTemp();
  gen.emit(
    `${dataPtrField2} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
  );
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField2}`);

  // Store value at current length index
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${currentLen}`);
  gen.emit(`store i8* ${value}, i8** ${elemPtr}`);

  // Increment length
  const newLen = gen.nextTemp();
  gen.emit(`${newLen} = add i32 ${currentLen}, 1`);
  gen.emitStore("i32", newLen, lenPtr);

  // Return new length as double (JavaScript semantics)
  const newLenDouble = gen.nextTemp();
  gen.emit(`${newLenDouble} = sitofp i32 ${newLen} to double`);
  gen.setVariableType(newLenDouble, "double");
  return newLenDouble;
}

function generatePointerArrayPush(
  gen: IGeneratorContext,
  arrayPtr: string,
  value: string,
  valueType: string,
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

  const resizeLabel = gen.nextLabel("resize");
  const continueLabel = gen.nextLabel("continue");

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
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const oldDataPtrRaw = gen.emitLoad("double*", dataPtrField);
  const oldDataPtr = gen.emitBitcast(oldDataPtrRaw, "double*", "i8**");

  const oldDataI8 = gen.emitBitcast(oldDataPtr, "i8**", "i8*");
  const newDataI8 = gen.emitBitcast(newDataPtr, "i8**", "i8*");
  const copySize = gen.nextTemp();
  gen.emit(`${copySize} = mul i32 ${currentLen}, 8`);
  const copySizeI64 = gen.nextTemp();
  gen.emit(`${copySizeI64} = zext i32 ${copySize} to i64`);
  gen.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newDataI8}, i8* ${oldDataI8}, i64 ${copySizeI64}, i1 false)`,
  );

  const newDataPtrAsDouble = gen.emitBitcast(newDataPtr, "i8**", "double*");
  gen.emitStore("double*", newDataPtrAsDouble, dataPtrField);

  gen.emitStore("i32", newCap, capPtr);

  gen.emitBr(continueLabel);

  gen.emitLabel(continueLabel);

  const dataPtrField2 = gen.nextTemp();
  gen.emit(`${dataPtrField2} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtrRaw = gen.nextTemp();
  gen.emit(`${dataPtrRaw} = load double*, double** ${dataPtrField2}`);
  const dataPtr = gen.emitBitcast(dataPtrRaw, "double*", "i8**");

  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${currentLen}`);
  const valueAsI8 = gen.emitBitcast(value, valueType, "i8*");
  gen.emit(`store i8* ${valueAsI8}, i8** ${elemPtr}`);

  const newLen = gen.nextTemp();
  gen.emit(`${newLen} = add i32 ${currentLen}, 1`);
  gen.emitStore("i32", newLen, lenPtr);

  const newLenDouble = gen.nextTemp();
  gen.emit(`${newLenDouble} = sitofp i32 ${newLen} to double`);
  gen.setVariableType(newLenDouble, "double");
  return newLenDouble;
}

function generateObjectArrayPush(
  gen: IGeneratorContext,
  arrayPtr: string,
  value: string,
  valueType: string,
): string {
  const lenPtr = gen.nextTemp();
  gen.emit(
    `${lenPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 1`,
  );
  const currentLen = gen.nextTemp();
  gen.emit(`${currentLen} = load i32, i32* ${lenPtr}`);

  const capPtr = gen.nextTemp();
  gen.emit(
    `${capPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 2`,
  );
  const currentCap = gen.nextTemp();
  gen.emit(`${currentCap} = load i32, i32* ${capPtr}`);

  const needResize = gen.emitIcmp("eq", "i32", currentLen, currentCap);

  const resizeLabel = gen.nextLabel("resize");
  const continueLabel = gen.nextLabel("continue");

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
    `${dataPtrField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`,
  );
  const oldDataPtrRaw = gen.emitLoad("i8*", dataPtrField);
  const oldDataPtr = gen.emitBitcast(oldDataPtrRaw, "i8*", "i8**");

  const oldDataI8 = gen.emitBitcast(oldDataPtr, "i8**", "i8*");
  const newDataI8 = gen.emitBitcast(newDataPtr, "i8**", "i8*");
  const copySize = gen.nextTemp();
  gen.emit(`${copySize} = mul i32 ${currentLen}, 8`);
  const copySizeI64 = gen.nextTemp();
  gen.emit(`${copySizeI64} = zext i32 ${copySize} to i64`);
  gen.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newDataI8}, i8* ${oldDataI8}, i64 ${copySizeI64}, i1 false)`,
  );

  const newDataPtrAsI8 = gen.emitBitcast(newDataPtr, "i8**", "i8*");
  gen.emitStore("i8*", newDataPtrAsI8, dataPtrField);

  gen.emitStore("i32", newCap, capPtr);

  gen.emitBr(continueLabel);

  gen.emitLabel(continueLabel);

  const dataPtrField2 = gen.nextTemp();
  gen.emit(
    `${dataPtrField2} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`,
  );
  const dataPtrRaw = gen.nextTemp();
  gen.emit(`${dataPtrRaw} = load i8*, i8** ${dataPtrField2}`);
  const dataPtr = gen.emitBitcast(dataPtrRaw, "i8*", "i8**");

  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${currentLen}`);
  const valueAsI8 = gen.emitBitcast(value, valueType, "i8*");
  gen.emit(`store i8* ${valueAsI8}, i8** ${elemPtr}`);

  const newLen = gen.nextTemp();
  gen.emit(`${newLen} = add i32 ${currentLen}, 1`);
  gen.emitStore("i32", newLen, lenPtr);

  const newLenDouble = gen.nextTemp();
  gen.emit(`${newLenDouble} = sitofp i32 ${newLen} to double`);
  gen.setVariableType(newLenDouble, "double");
  return newLenDouble;
}
