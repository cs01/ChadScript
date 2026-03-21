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
    return gen.emitError("push() requires exactly 1 argument", expr.loc);
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

  let isUint8Array = false;
  if (exprObjBase.type === "variable") {
    const varName = (expr.object as VariableNode).name;
    const varType = gen.getVariableType(varName);
    if (varType === "%Uint8Array*" || varType === "%Uint8Array") isUint8Array = true;
  }
  if (!isUint8Array) {
    const ptrType = gen.getVariableType(arrayPtr);
    if (ptrType === "%Uint8Array*" || ptrType === "%Uint8Array") isUint8Array = true;
  }

  if (isUint8Array) {
    return generateUint8ArrayPush(gen, arrayPtr, value);
  }

  if (isStringArray) {
    return generateStringArrayPush(gen, arrayPtr, value);
  }

  if (isObjectArray) {
    const valueType = gen.getVariableType(value) || "i8*";
    let stride = 0;
    if (exprObjBase.type === "variable") {
      const varName = (expr.object as VariableNode).name;
      const numFields = gen.symbolTable.getContiguousFieldCount(varName);
      if (numFields > 0) stride = numFields * 8;
    }
    return generateObjectArrayPush(gen, arrayPtr, value, valueType, stride);
  }

  const valueType = gen.getVariableType(value);
  if (valueType === "i8*") {
    return generateStringArrayPush(gen, arrayPtr, value);
  }
  if (valueType && valueType.endsWith("*") && valueType !== "double*") {
    return generateObjectArrayPush(gen, arrayPtr, value, valueType, 0);
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
    return gen.emitError("pop() requires 0 arguments", expr.loc);
  }

  const arrayPtr = gen.generateExpression(expr.object, params);

  // Determine array type
  let isStringArray = false;
  let isObjectArray = false;
  let isPointerArray = false;
  const exprObjBase2 = expr.object as ExprBase;
  if (exprObjBase2.type === "variable") {
    const varNode = expr.object as VariableNode;
    const varName = varNode.name;
    const varType = gen.getVariableType(varName);
    isStringArray = varType === "%StringArray*" || varType === "%StringArray";
    isObjectArray = varType === "%ObjectArray*" || varType === "%ObjectArray";
    isPointerArray = varType === "i8*";
  }
  if (!isStringArray && !isObjectArray && !isPointerArray) {
    const ptrType = gen.getVariableType(arrayPtr);
    if (ptrType === "%StringArray*" || ptrType === "%StringArray") isStringArray = true;
    else if (ptrType === "%ObjectArray*" || ptrType === "%ObjectArray") isObjectArray = true;
    else if (ptrType === "i8*") isPointerArray = true;
  }

  if (isStringArray) {
    return generateStringArrayPop(gen, arrayPtr);
  } else if (isObjectArray) {
    return generateObjectArrayPop(gen, arrayPtr);
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
  gen.setVariableType(result, "double");

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
  const emptyStr = gen.emitCall("i8*", "@cs_arena_alloc", "i64 1");
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

function generateObjectArrayPop(gen: IGeneratorContext, arrayPtr: string): string {
  const lenPtr = gen.nextTemp();
  gen.emit(
    `${lenPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 1`,
  );
  const currentLen = gen.nextTemp();
  gen.emit(`${currentLen} = load i32, i32* ${lenPtr}`);

  const isEmpty = gen.emitIcmp("eq", "i32", currentLen, "0");

  const emptyLabel = gen.nextLabel("pop_empty");
  const notEmptyLabel = gen.nextLabel("pop_notempty");
  const endLabel = gen.nextLabel("pop_end");

  gen.emitBrCond(isEmpty, emptyLabel, notEmptyLabel);

  gen.emitLabel(emptyLabel);
  gen.emitBr(endLabel);

  gen.emitLabel(notEmptyLabel);

  const lastIndex = gen.nextTemp();
  gen.emit(`${lastIndex} = sub i32 ${currentLen}, 1`);

  const dataPtrField = gen.nextTemp();
  gen.emit(
    `${dataPtrField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`,
  );
  const dataPtrRaw = gen.emitLoad("i8*", dataPtrField);
  const dataPtr = gen.emitBitcast(dataPtrRaw, "i8*", "i8**");

  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${lastIndex}`);
  const lastElem = gen.nextTemp();
  gen.emit(`${lastElem} = load i8*, i8** ${elemPtr}`);

  gen.emitStore("i32", lastIndex, lenPtr);

  gen.emitBr(endLabel);

  gen.emitLabel(endLabel);
  const result = gen.nextTemp();
  gen.emit(`${result} = phi i8* [ null, %${emptyLabel} ], [ ${lastElem}, %${notEmptyLabel} ]`);
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
  gen.emit(`${result} = phi i8* [ null, %${emptyLabel} ], [ ${lastElem}, %${notEmptyLabel} ]`);
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
  const newMem = gen.emitCall("i8*", "@cs_arena_alloc", `i64 ${newMemSize}`);
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

function generateUint8ArrayPush(gen: IGeneratorContext, arrayPtr: string, value: string): string {
  const lenPtr = gen.nextTemp();
  gen.emit(
    `${lenPtr} = getelementptr inbounds %Uint8Array, %Uint8Array* ${arrayPtr}, i32 0, i32 1`,
  );
  const currentLen = gen.nextTemp();
  gen.emit(`${currentLen} = load i32, i32* ${lenPtr}`);

  const capPtr = gen.nextTemp();
  gen.emit(
    `${capPtr} = getelementptr inbounds %Uint8Array, %Uint8Array* ${arrayPtr}, i32 0, i32 2`,
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
  const newMem = gen.emitCall("i8*", "@cs_arena_alloc", `i64 ${newCapI64}`);

  const dataPtrField = gen.nextTemp();
  gen.emit(
    `${dataPtrField} = getelementptr inbounds %Uint8Array, %Uint8Array* ${arrayPtr}, i32 0, i32 0`,
  );
  const oldDataPtr = gen.emitLoad("i8*", dataPtrField);

  const currentLenI64 = gen.nextTemp();
  gen.emit(`${currentLenI64} = zext i32 ${currentLen} to i64`);
  gen.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newMem}, i8* ${oldDataPtr}, i64 ${currentLenI64}, i1 false)`,
  );

  gen.emitStore("i8*", newMem, dataPtrField);
  gen.emitStore("i32", newCap, capPtr);

  gen.emitBr(continueLabel);

  gen.emitLabel(continueLabel);

  const dataPtrField2 = gen.nextTemp();
  gen.emit(
    `${dataPtrField2} = getelementptr inbounds %Uint8Array, %Uint8Array* ${arrayPtr}, i32 0, i32 0`,
  );
  const dataPtr = gen.emitLoad("i8*", dataPtrField2);

  const valueType = gen.getVariableType(value);
  let i8Val: string;
  if (valueType === "i1") {
    i8Val = gen.nextTemp();
    gen.emit(`${i8Val} = zext i1 ${value} to i8`);
  } else {
    const dblValue = gen.ensureDouble(value);
    const rawI8 = gen.nextTemp();
    gen.emit(`${rawI8} = fptosi double ${dblValue} to i8`);
    i8Val = gen.nextTemp();
    gen.emit(`${i8Val} = and i8 ${rawI8}, 1`);
  }

  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds i8, i8* ${dataPtr}, i32 ${currentLen}`);
  gen.emitStore("i8", i8Val, elemPtr);

  const newLen = gen.nextTemp();
  gen.emit(`${newLen} = add i32 ${currentLen}, 1`);
  gen.emitStore("i32", newLen, lenPtr);

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
  const currentLenI64 = gen.nextTemp();
  gen.emit(`${currentLenI64} = zext i32 ${currentLen} to i64`);
  const copySizeI64 = gen.nextTemp();
  gen.emit(`${copySizeI64} = mul i64 ${currentLenI64}, 8`);
  gen.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newDataI8}, i8* ${oldDataI8}, i64 ${copySizeI64}, i1 false)`,
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
  const currentLenI64 = gen.nextTemp();
  gen.emit(`${currentLenI64} = zext i32 ${currentLen} to i64`);
  const copySizeI64 = gen.nextTemp();
  gen.emit(`${copySizeI64} = mul i64 ${currentLenI64}, 8`);
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
  contiguousStride: number,
): string {
  const elemSize = contiguousStride > 0 ? contiguousStride : 8;
  const allocFn = contiguousStride > 0 ? "@GC_malloc_atomic" : "@GC_malloc";

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
  gen.emit(`${newMemSize} = mul i64 ${newCapI64}, ${elemSize}`);
  const newMem = gen.emitCall("i8*", allocFn, `i64 ${newMemSize}`);

  const dataPtrField = gen.nextTemp();
  gen.emit(
    `${dataPtrField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`,
  );
  const oldDataPtrRaw = gen.emitLoad("i8*", dataPtrField);

  const currentLenI64 = gen.nextTemp();
  gen.emit(`${currentLenI64} = zext i32 ${currentLen} to i64`);
  const copySizeI64 = gen.nextTemp();
  gen.emit(`${copySizeI64} = mul i64 ${currentLenI64}, ${elemSize}`);
  gen.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newMem}, i8* ${oldDataPtrRaw}, i64 ${copySizeI64}, i1 false)`,
  );

  gen.emitStore("i8*", newMem, dataPtrField);
  gen.emitStore("i32", newCap, capPtr);

  gen.emitBr(continueLabel);

  gen.emitLabel(continueLabel);

  const dataPtrField2 = gen.nextTemp();
  gen.emit(
    `${dataPtrField2} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`,
  );
  const dataPtrRaw = gen.nextTemp();
  gen.emit(`${dataPtrRaw} = load i8*, i8** ${dataPtrField2}`);

  if (contiguousStride > 0) {
    const currentLenI642 = gen.nextTemp();
    gen.emit(`${currentLenI642} = zext i32 ${currentLen} to i64`);
    const offsetI64 = gen.nextTemp();
    gen.emit(`${offsetI64} = mul i64 ${currentLenI642}, ${contiguousStride}`);
    const dest = gen.nextTemp();
    gen.emit(`${dest} = getelementptr inbounds i8, i8* ${dataPtrRaw}, i64 ${offsetI64}`);
    const valueAsI8 = gen.emitBitcast(value, valueType, "i8*");
    gen.emit(
      `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${dest}, i8* ${valueAsI8}, i64 ${contiguousStride}, i1 false)`,
    );
  } else {
    const dataPtr = gen.emitBitcast(dataPtrRaw, "i8*", "i8**");
    const elemPtr = gen.nextTemp();
    gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${currentLen}`);
    const valueAsI8 = gen.emitBitcast(value, valueType, "i8*");
    gen.emit(`store i8* ${valueAsI8}, i8** ${elemPtr}`);
  }

  const newLen = gen.nextTemp();
  gen.emit(`${newLen} = add i32 ${currentLen}, 1`);
  gen.emitStore("i32", newLen, lenPtr);

  const newLenDouble = gen.nextTemp();
  gen.emit(`${newLenDouble} = sitofp i32 ${newLen} to double`);
  gen.setVariableType(newLenDouble, "double");
  return newLenDouble;
}

export function generateArrayFill(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length < 1 || expr.args.length > 3) {
    return gen.emitError("fill() requires 1-3 arguments", expr.loc);
  }

  const arrayPtr = gen.generateExpression(expr.object, params);
  const fillValue = gen.generateExpression(expr.args[0], params);

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
    return generateStringArrayFillImpl(gen, expr, params, arrayPtr, fillValue);
  }
  return generateNumericArrayFillImpl(gen, expr, params, arrayPtr, fillValue);
}

function resolveArrayIndex(gen: IGeneratorContext, rawDouble: string, length: string): string {
  const dbl = gen.ensureDouble(rawDouble);
  const i32Val = gen.nextTemp();
  gen.emit(`${i32Val} = fptosi double ${dbl} to i32`);
  const isNeg = gen.emitIcmp("slt", "i32", i32Val, "0");
  const resolved = gen.nextTemp();
  gen.emit(`${resolved} = add i32 ${i32Val}, ${length}`);
  const resolvedNeg = gen.emitIcmp("slt", "i32", resolved, "0");
  const zeroClamp = gen.nextTemp();
  gen.emit(`${zeroClamp} = select i1 ${resolvedNeg}, i32 0, i32 ${resolved}`);
  const fromNeg = gen.nextTemp();
  gen.emit(`${fromNeg} = select i1 ${isNeg}, i32 ${zeroClamp}, i32 ${i32Val}`);
  const tooHigh = gen.emitIcmp("sgt", "i32", fromNeg, length);
  const result = gen.nextTemp();
  gen.emit(`${result} = select i1 ${tooHigh}, i32 ${length}, i32 ${fromNeg}`);
  return result;
}

function clampFillIndex(gen: IGeneratorContext, rawDouble: string, length: string): string {
  return resolveArrayIndex(gen, rawDouble, length);
}

function generateNumericArrayFillImpl(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
  arrayPtr: string,
  fillValue: string,
): string {
  const dblValue = gen.ensureDouble(fillValue);

  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const length = gen.emitLoad("i32", lenPtr);

  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.emitLoad("double*", dataPtrField);

  const startVal =
    expr.args.length >= 2
      ? clampFillIndex(gen, gen.generateExpression(expr.args[1], params), length)
      : "0";
  const endVal =
    expr.args.length >= 3
      ? clampFillIndex(gen, gen.generateExpression(expr.args[2], params), length)
      : length;

  const counterPtr = gen.nextTemp();
  gen.emit(`${counterPtr} = alloca i32`);
  gen.emitStore("i32", startVal, counterPtr);

  const loopLabel = gen.nextLabel("fill_loop");
  const bodyLabel = gen.nextLabel("fill_body");
  const endLabel = gen.nextLabel("fill_end");

  gen.emitBr(loopLabel);
  gen.emitLabel(loopLabel);
  const counter = gen.emitLoad("i32", counterPtr);
  const cond = gen.emitIcmp("slt", "i32", counter, endVal);
  gen.emitBrCond(cond, bodyLabel, endLabel);

  gen.emitLabel(bodyLabel);
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${counter}`);
  gen.emitStore("double", dblValue, elemPtr);
  const next = gen.nextTemp();
  gen.emit(`${next} = add i32 ${counter}, 1`);
  gen.emitStore("i32", next, counterPtr);
  gen.emitBr(loopLabel);

  gen.emitLabel(endLabel);
  gen.setVariableType(arrayPtr, "%Array*");
  return arrayPtr;
}

function generateStringArrayFillImpl(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
  arrayPtr: string,
  fillValue: string,
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
  const dataPtr = gen.emitLoad("i8**", dataPtrField);

  const startVal =
    expr.args.length >= 2
      ? clampFillIndex(gen, gen.generateExpression(expr.args[1], params), length)
      : "0";
  const endVal =
    expr.args.length >= 3
      ? clampFillIndex(gen, gen.generateExpression(expr.args[2], params), length)
      : length;

  const counterPtr = gen.nextTemp();
  gen.emit(`${counterPtr} = alloca i32`);
  gen.emitStore("i32", startVal, counterPtr);

  const loopLabel = gen.nextLabel("fill_loop");
  const bodyLabel = gen.nextLabel("fill_body");
  const endLabel = gen.nextLabel("fill_end");

  gen.emitBr(loopLabel);
  gen.emitLabel(loopLabel);
  const counter = gen.emitLoad("i32", counterPtr);
  const cond = gen.emitIcmp("slt", "i32", counter, endVal);
  gen.emitBrCond(cond, bodyLabel, endLabel);

  gen.emitLabel(bodyLabel);
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${counter}`);
  gen.emitStore("i8*", fillValue, elemPtr);
  const next = gen.nextTemp();
  gen.emit(`${next} = add i32 ${counter}, 1`);
  gen.emitStore("i32", next, counterPtr);
  gen.emitBr(loopLabel);

  gen.emitLabel(endLabel);
  gen.setVariableType(arrayPtr, "%StringArray*");
  return arrayPtr;
}

export function generateArrayCopyWithin(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length < 2 || expr.args.length > 3) {
    return gen.emitError("copyWithin() requires 2-3 arguments (target, start, end?)", expr.loc);
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
    return generateStringArrayCopyWithinImpl(gen, expr, params, arrayPtr);
  }
  return generateNumericArrayCopyWithinImpl(gen, expr, params, arrayPtr);
}

function generateNumericArrayCopyWithinImpl(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
  arrayPtr: string,
): string {
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const length = gen.emitLoad("i32", lenPtr);

  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.emitLoad("double*", dataPtrField);

  const target = resolveArrayIndex(gen, gen.generateExpression(expr.args[0], params), length);
  const start = resolveArrayIndex(gen, gen.generateExpression(expr.args[1], params), length);
  const end =
    expr.args.length >= 3
      ? resolveArrayIndex(gen, gen.generateExpression(expr.args[2], params), length)
      : length;

  const count = gen.nextTemp();
  gen.emit(`${count} = sub i32 ${end}, ${start}`);
  const remaining = gen.nextTemp();
  gen.emit(`${remaining} = sub i32 ${length}, ${target}`);
  const useCount = gen.emitIcmp("slt", "i32", count, remaining);
  const actualCount = gen.nextTemp();
  gen.emit(`${actualCount} = select i1 ${useCount}, i32 ${count}, i32 ${remaining}`);
  const isPos = gen.emitIcmp("sgt", "i32", actualCount, "0");
  const finalCount = gen.nextTemp();
  gen.emit(`${finalCount} = select i1 ${isPos}, i32 ${actualCount}, i32 0`);

  const srcPtr = gen.nextTemp();
  gen.emit(`${srcPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${start}`);
  const dstPtr = gen.nextTemp();
  gen.emit(`${dstPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${target}`);

  const srcI8 = gen.emitBitcast(srcPtr, "double*", "i8*");
  const dstI8 = gen.emitBitcast(dstPtr, "double*", "i8*");

  const byteCount = gen.nextTemp();
  gen.emit(`${byteCount} = mul i32 ${finalCount}, 8`);
  const byteCount64 = gen.nextTemp();
  gen.emit(`${byteCount64} = zext i32 ${byteCount} to i64`);
  gen.emit(
    `call void @llvm.memmove.p0i8.p0i8.i64(i8* ${dstI8}, i8* ${srcI8}, i64 ${byteCount64}, i1 false)`,
  );

  gen.setVariableType(arrayPtr, "%Array*");
  return arrayPtr;
}

function generateStringArrayCopyWithinImpl(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
  arrayPtr: string,
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
  const dataPtr = gen.emitLoad("i8**", dataPtrField);

  const target = resolveArrayIndex(gen, gen.generateExpression(expr.args[0], params), length);
  const start = resolveArrayIndex(gen, gen.generateExpression(expr.args[1], params), length);
  const end =
    expr.args.length >= 3
      ? resolveArrayIndex(gen, gen.generateExpression(expr.args[2], params), length)
      : length;

  const count = gen.nextTemp();
  gen.emit(`${count} = sub i32 ${end}, ${start}`);
  const remaining = gen.nextTemp();
  gen.emit(`${remaining} = sub i32 ${length}, ${target}`);
  const useCount = gen.emitIcmp("slt", "i32", count, remaining);
  const actualCount = gen.nextTemp();
  gen.emit(`${actualCount} = select i1 ${useCount}, i32 ${count}, i32 ${remaining}`);
  const isPos = gen.emitIcmp("sgt", "i32", actualCount, "0");
  const finalCount = gen.nextTemp();
  gen.emit(`${finalCount} = select i1 ${isPos}, i32 ${actualCount}, i32 0`);

  const srcPtr = gen.nextTemp();
  gen.emit(`${srcPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${start}`);
  const dstPtr = gen.nextTemp();
  gen.emit(`${dstPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${target}`);

  const srcI8 = gen.emitBitcast(srcPtr, "i8**", "i8*");
  const dstI8 = gen.emitBitcast(dstPtr, "i8**", "i8*");

  const byteCount = gen.nextTemp();
  gen.emit(`${byteCount} = mul i32 ${finalCount}, 8`);
  const byteCount64 = gen.nextTemp();
  gen.emit(`${byteCount64} = zext i32 ${byteCount} to i64`);
  gen.emit(
    `call void @llvm.memmove.p0i8.p0i8.i64(i8* ${dstI8}, i8* ${srcI8}, i64 ${byteCount64}, i1 false)`,
  );

  gen.setVariableType(arrayPtr, "%StringArray*");
  return arrayPtr;
}
