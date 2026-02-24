// Array iteration operations: filter, forEach, reduce, map
// Exported functions accept (gen, expr, params) and handle callback resolution internally.

import { MethodCallNode, VariableNode } from "../../../../ast/types.js";
import { IGeneratorContext, loadArrayMeta, detectArrayType } from "./context.js";

interface ExprBase {
  type: string;
}

/** Build call args, prepending env pointer for inline lambdas with captures.
 *  Does NOT clear the env ptr — caller must clear after the loop completes. */
function buildIterCallArgs(gen: IGeneratorContext, baseArgs: string): string {
  const envPtr = gen.getLastInlineLambdaEnvPtr();
  if (envPtr) {
    return `i8* ${envPtr}, ${baseArgs}`;
  }
  return baseArgs;
}

// ============================================
// filter
// ============================================

export function generateArrayFilter(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length !== 1) {
    throw new Error("filter() requires exactly 1 argument (predicate function)");
  }

  const arrayPtr = gen.generateExpression(expr.object, params);
  const { isStringArray, isObjectArray } = detectArrayType(gen, expr, arrayPtr);

  const callbackArg = expr.args[0];
  let predicateFn: string;
  if (callbackArg.type === "variable") {
    predicateFn = gen.mangleUserName((callbackArg as VariableNode).name);
  } else if (callbackArg.type === "arrow_function") {
    if (isStringArray || isObjectArray) {
      gen.setExpectedCallbackParamType("string");
    }
    predicateFn = gen.generateExpression(callbackArg, params);
    gen.setExpectedCallbackParamType(null);
  } else {
    throw new Error("filter() argument must be a function name or inline function");
  }

  let result: string;
  if (isStringArray || isObjectArray) {
    result = generateStringArrayFilter(gen, arrayPtr, predicateFn);
  } else {
    result = generateNumericArrayFilter(gen, arrayPtr, predicateFn);
  }
  gen.setLastInlineLambdaEnvPtr(null);
  return result;
}

function generateNumericArrayFilter(
  gen: IGeneratorContext,
  arrayPtr: string,
  predicateFn: string,
): string {
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const length = gen.emitLoad("i32", lenPtr);

  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load double*, double** ${dataPtrField}`);

  // Create result array (allocate with same capacity as input)
  const resultArrayPtr = gen.nextTemp();
  gen.emit(`${resultArrayPtr} = alloca %Array`);

  const doubleSize = 8;
  const lengthI64 = gen.nextTemp();
  gen.emit(`${lengthI64} = zext i32 ${length} to i64`);
  const dataSizeI64 = gen.nextTemp();
  gen.emit(`${dataSizeI64} = mul i64 ${lengthI64}, ${doubleSize}`);
  const dataMem = gen.emitCall("i8*", "@GC_malloc_atomic", `i64 ${dataSizeI64}`);
  const resultDataPtr = gen.emitBitcast(dataMem, "i8*", "double*");

  const resultDataPtrField = gen.nextTemp();
  gen.emit(
    `${resultDataPtrField} = getelementptr inbounds %Array, %Array* ${resultArrayPtr}, i32 0, i32 0`,
  );
  gen.emit(`store double* ${resultDataPtr}, double** ${resultDataPtrField}`);

  // Initialize length to 0
  const resultLenField = gen.nextTemp();
  gen.emit(
    `${resultLenField} = getelementptr inbounds %Array, %Array* ${resultArrayPtr}, i32 0, i32 1`,
  );
  gen.emitStore("i32", "0", resultLenField);

  const resultCapField = gen.nextTemp();
  gen.emit(
    `${resultCapField} = getelementptr inbounds %Array, %Array* ${resultArrayPtr}, i32 0, i32 2`,
  );
  gen.emitStore("i32", length, resultCapField);

  const loopLabel = gen.nextLabel("filter_loop");
  const checkLabel = gen.nextLabel("filter_check");
  const bodyLabel = gen.nextLabel("filter_body");
  const addLabel = gen.nextLabel("filter_add");
  const endLabel = gen.nextLabel("filter_end");

  const counterPtr = gen.nextTemp();
  gen.emit(`${counterPtr} = alloca i32`);
  gen.emitStore("i32", "0", counterPtr);

  gen.emitBr(checkLabel);

  gen.emitLabel(checkLabel);
  const counter = gen.emitLoad("i32", counterPtr);
  const cond = gen.emitIcmp("slt", "i32", counter, length);
  gen.emitBrCond(cond, bodyLabel, endLabel);

  gen.emitLabel(bodyLabel);
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${counter}`);
  const elem = gen.emitLoad("double", elemPtr);

  const predicateResult = gen.emitCall(
    "double",
    `@${predicateFn}`,
    buildIterCallArgs(gen, `double ${elem}`),
  );

  const isTruthy = gen.nextTemp();
  gen.emit(`${isTruthy} = fcmp one double ${predicateResult}, 0.0`);
  gen.emitBrCond(isTruthy, addLabel, loopLabel);

  gen.emitLabel(addLabel);
  const currentLen = gen.emitLoad("i32", resultLenField);
  const resultElemPtr = gen.nextTemp();
  gen.emit(
    `${resultElemPtr} = getelementptr inbounds double, double* ${resultDataPtr}, i32 ${currentLen}`,
  );
  gen.emitStore("double", elem, resultElemPtr);
  const newLen = gen.nextTemp();
  gen.emit(`${newLen} = add i32 ${currentLen}, 1`);
  gen.emitStore("i32", newLen, resultLenField);
  gen.emitBr(loopLabel);

  gen.emitLabel(loopLabel);
  const nextCounter = gen.nextTemp();
  gen.emit(`${nextCounter} = add i32 ${counter}, 1`);
  gen.emitStore("i32", nextCounter, counterPtr);
  gen.emitBr(checkLabel);

  gen.emitLabel(endLabel);
  return resultArrayPtr;
}

function generateStringArrayFilter(
  gen: IGeneratorContext,
  arrayPtr: string,
  predicateFn: string,
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

  const resultArrayPtr = gen.nextTemp();
  gen.emit(`${resultArrayPtr} = alloca %StringArray`);

  const ptrSize = 8;
  const lengthI64 = gen.nextTemp();
  gen.emit(`${lengthI64} = zext i32 ${length} to i64`);
  const dataSizeI64 = gen.nextTemp();
  gen.emit(`${dataSizeI64} = mul i64 ${lengthI64}, ${ptrSize}`);
  const dataMem = gen.emitCall("i8*", "@GC_malloc", `i64 ${dataSizeI64}`);
  const resultDataPtr = gen.emitBitcast(dataMem, "i8*", "i8**");

  const resultDataPtrField = gen.nextTemp();
  gen.emit(
    `${resultDataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${resultArrayPtr}, i32 0, i32 0`,
  );
  gen.emit(`store i8** ${resultDataPtr}, i8*** ${resultDataPtrField}`);

  const resultLenField = gen.nextTemp();
  gen.emit(
    `${resultLenField} = getelementptr inbounds %StringArray, %StringArray* ${resultArrayPtr}, i32 0, i32 1`,
  );
  gen.emitStore("i32", "0", resultLenField);

  const resultCapField = gen.nextTemp();
  gen.emit(
    `${resultCapField} = getelementptr inbounds %StringArray, %StringArray* ${resultArrayPtr}, i32 0, i32 2`,
  );
  gen.emitStore("i32", length, resultCapField);

  const loopLabel = gen.nextLabel("filter_loop");
  const checkLabel = gen.nextLabel("filter_check");
  const bodyLabel = gen.nextLabel("filter_body");
  const addLabel = gen.nextLabel("filter_add");
  const endLabel = gen.nextLabel("filter_end");

  const counterPtr = gen.nextTemp();
  gen.emit(`${counterPtr} = alloca i32`);
  gen.emitStore("i32", "0", counterPtr);

  gen.emitBr(checkLabel);

  gen.emitLabel(checkLabel);
  const counter = gen.emitLoad("i32", counterPtr);
  const cond = gen.emitIcmp("slt", "i32", counter, length);
  gen.emitBrCond(cond, bodyLabel, endLabel);

  gen.emitLabel(bodyLabel);
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${counter}`);
  const elem = gen.nextTemp();
  gen.emit(`${elem} = load i8*, i8** ${elemPtr}`);

  const predicateResult = gen.emitCall(
    "double",
    `@${predicateFn}`,
    buildIterCallArgs(gen, `i8* ${elem}`),
  );

  const isTruthy = gen.nextTemp();
  gen.emit(`${isTruthy} = fcmp one double ${predicateResult}, 0.0`);
  gen.emitBrCond(isTruthy, addLabel, loopLabel);

  gen.emitLabel(addLabel);
  const currentLen = gen.emitLoad("i32", resultLenField);
  const resultElemPtr = gen.nextTemp();
  gen.emit(
    `${resultElemPtr} = getelementptr inbounds i8*, i8** ${resultDataPtr}, i32 ${currentLen}`,
  );
  gen.emit(`store i8* ${elem}, i8** ${resultElemPtr}`);
  const newLen = gen.nextTemp();
  gen.emit(`${newLen} = add i32 ${currentLen}, 1`);
  gen.emitStore("i32", newLen, resultLenField);
  gen.emitBr(loopLabel);

  gen.emitLabel(loopLabel);
  const nextCounter = gen.nextTemp();
  gen.emit(`${nextCounter} = add i32 ${counter}, 1`);
  gen.emitStore("i32", nextCounter, counterPtr);
  gen.emitBr(checkLabel);

  gen.emitLabel(endLabel);
  gen.setVariableType(resultArrayPtr, "%StringArray*");
  return resultArrayPtr;
}

// ============================================
// forEach
// ============================================

export function generateArrayForEach(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length !== 1) {
    throw new Error("forEach() requires exactly 1 argument (callback function)");
  }

  const arrayPtr = gen.generateExpression(expr.object, params);
  const { isStringArray, isObjectArray } = detectArrayType(gen, expr, arrayPtr);

  const callbackArg = expr.args[0];
  let callbackFn: string;
  if (callbackArg.type === "variable") {
    callbackFn = gen.mangleUserName((callbackArg as VariableNode).name);
  } else if (callbackArg.type === "arrow_function") {
    if (isStringArray || isObjectArray) {
      gen.setExpectedCallbackParamType("string");
    }
    callbackFn = gen.generateExpression(callbackArg, params);
    gen.setExpectedCallbackParamType(null);
  } else {
    throw new Error("forEach() argument must be a function name or inline function");
  }

  let result: string;
  if (isStringArray || isObjectArray) {
    result = generateStringArrayForEach(gen, arrayPtr, callbackFn);
  } else {
    result = generateNumericArrayForEach(gen, arrayPtr, callbackFn);
  }
  gen.setLastInlineLambdaEnvPtr(null);
  return result;
}

function generateNumericArrayForEach(
  gen: IGeneratorContext,
  arrayPtr: string,
  callbackFn: string,
): string {
  const arrayMeta = loadArrayMeta(gen, arrayPtr);
  const length = arrayMeta.length;
  const dataPtr = arrayMeta.dataPtr;

  const checkLabel = gen.nextLabel("foreach_check");
  const bodyLabel = gen.nextLabel("foreach_body");
  const endLabel = gen.nextLabel("foreach_end");

  const counterPtr = gen.nextTemp();
  gen.emit(`${counterPtr} = alloca i32`);
  gen.emitStore("i32", "0", counterPtr);

  gen.emitBr(checkLabel);

  gen.emitLabel(checkLabel);
  const counter = gen.emitLoad("i32", counterPtr);
  const cond = gen.emitIcmp("slt", "i32", counter, length);
  gen.emitBrCond(cond, bodyLabel, endLabel);

  gen.emitLabel(bodyLabel);
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${counter}`);
  const elem = gen.emitLoad("double", elemPtr);

  // Call callback (discard return value)
  gen.emitCall("double", `@${callbackFn}`, buildIterCallArgs(gen, `double ${elem}`));

  const nextCounter = gen.nextTemp();
  gen.emit(`${nextCounter} = add i32 ${counter}, 1`);
  gen.emitStore("i32", nextCounter, counterPtr);
  gen.emitBr(checkLabel);

  gen.emitLabel(endLabel);
  return "0";
}

function generateStringArrayForEach(
  gen: IGeneratorContext,
  arrayPtr: string,
  callbackFn: string,
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

  const checkLabel = gen.nextLabel("foreach_check");
  const bodyLabel = gen.nextLabel("foreach_body");
  const endLabel = gen.nextLabel("foreach_end");

  const counterPtr = gen.nextTemp();
  gen.emit(`${counterPtr} = alloca i32`);
  gen.emitStore("i32", "0", counterPtr);

  gen.emitBr(checkLabel);

  gen.emitLabel(checkLabel);
  const counter = gen.emitLoad("i32", counterPtr);
  const cond = gen.emitIcmp("slt", "i32", counter, length);
  gen.emitBrCond(cond, bodyLabel, endLabel);

  gen.emitLabel(bodyLabel);
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${counter}`);
  const elem = gen.nextTemp();
  gen.emit(`${elem} = load i8*, i8** ${elemPtr}`);

  gen.emitCall("double", `@${callbackFn}`, buildIterCallArgs(gen, `i8* ${elem}`));

  const nextCounter = gen.nextTemp();
  gen.emit(`${nextCounter} = add i32 ${counter}, 1`);
  gen.emitStore("i32", nextCounter, counterPtr);
  gen.emitBr(checkLabel);

  gen.emitLabel(endLabel);
  return "0";
}

// ============================================
// reduce
// ============================================

export function generateArrayReduce(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length < 1 || expr.args.length > 2) {
    throw new Error("reduce() requires 1-2 arguments (callback, optional initialValue)");
  }

  const arrayPtr = gen.generateExpression(expr.object, params);

  // reduce uses manual string detection (not detectArrayType) — only checks string, not object
  let isStringArray = false;
  const exprObjBase = expr.object as ExprBase;
  if (exprObjBase.type === "variable") {
    const varName = (expr.object as VariableNode).name;
    const varType = gen.getVariableType(varName);
    isStringArray = varType === "%StringArray*" || varType === "%StringArray";
  } else {
    const ptrType = gen.getVariableType(arrayPtr);
    isStringArray = ptrType === "%StringArray*";
  }

  const callbackArg = expr.args[0];
  let callbackFn: string;
  if (callbackArg.type === "variable") {
    callbackFn = gen.mangleUserName((callbackArg as VariableNode).name);
  } else if (callbackArg.type === "arrow_function") {
    if (isStringArray) {
      gen.setExpectedCallbackParamType("string");
    }
    callbackFn = gen.generateExpression(callbackArg, params);
    gen.setExpectedCallbackParamType(null);
  } else {
    throw new Error("reduce() argument must be a function name or inline function");
  }

  let initialValue: string | null = null;
  if (expr.args.length === 2) {
    initialValue = gen.generateExpression(expr.args[1], params);
  }

  let result: string;
  if (isStringArray) {
    result = generateStringArrayReduce(gen, arrayPtr, callbackFn, initialValue);
  } else {
    result = generateNumericArrayReduce(gen, arrayPtr, callbackFn, initialValue);
  }
  gen.setLastInlineLambdaEnvPtr(null);
  return result;
}

function generateNumericArrayReduce(
  gen: IGeneratorContext,
  arrayPtr: string,
  callbackFn: string,
  initialValue: string | null,
): string {
  const arrayMeta = loadArrayMeta(gen, arrayPtr);
  const length = arrayMeta.length;
  const dataPtr = arrayMeta.dataPtr;

  const checkLabel = gen.nextLabel("reduce_check");
  const bodyLabel = gen.nextLabel("reduce_body");
  const endLabel = gen.nextLabel("reduce_end");

  const accPtr = gen.nextTemp();
  gen.emit(`${accPtr} = alloca double`);

  const counterPtr = gen.nextTemp();
  gen.emit(`${counterPtr} = alloca i32`);

  if (initialValue !== null) {
    const dblInit = gen.ensureDouble(initialValue);
    gen.emitStore("double", dblInit, accPtr);
    gen.emitStore("i32", "0", counterPtr);
  } else {
    const firstElemPtr = gen.nextTemp();
    gen.emit(`${firstElemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 0`);
    const firstElem = gen.emitLoad("double", firstElemPtr);
    gen.emitStore("double", firstElem, accPtr);
    gen.emitStore("i32", "1", counterPtr);
  }

  gen.emitBr(checkLabel);

  gen.emitLabel(checkLabel);
  const counter = gen.emitLoad("i32", counterPtr);
  const cond = gen.emitIcmp("slt", "i32", counter, length);
  gen.emitBrCond(cond, bodyLabel, endLabel);

  gen.emitLabel(bodyLabel);
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${counter}`);
  const elem = gen.emitLoad("double", elemPtr);

  const acc = gen.emitLoad("double", accPtr);

  const newAcc = gen.emitCall(
    "double",
    `@${callbackFn}`,
    buildIterCallArgs(gen, `double ${acc}, double ${elem}`),
  );
  gen.emitStore("double", newAcc, accPtr);

  const nextCounter = gen.nextTemp();
  gen.emit(`${nextCounter} = add i32 ${counter}, 1`);
  gen.emitStore("i32", nextCounter, counterPtr);
  gen.emitBr(checkLabel);

  gen.emitLabel(endLabel);
  const finalAcc = gen.emitLoad("double", accPtr);
  return finalAcc;
}

function generateStringArrayReduce(
  gen: IGeneratorContext,
  arrayPtr: string,
  callbackFn: string,
  initialValue: string | null,
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

  const checkLabel = gen.nextLabel("reduce_check");
  const bodyLabel = gen.nextLabel("reduce_body");
  const endLabel = gen.nextLabel("reduce_end");

  const accPtr = gen.nextTemp();
  gen.emit(`${accPtr} = alloca i8*`);

  const counterPtr = gen.nextTemp();
  gen.emit(`${counterPtr} = alloca i32`);

  if (initialValue !== null) {
    gen.emit(`store i8* ${initialValue}, i8** ${accPtr}`);
    gen.emitStore("i32", "0", counterPtr);
  } else {
    const firstElemPtr = gen.nextTemp();
    gen.emit(`${firstElemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 0`);
    const firstElem = gen.nextTemp();
    gen.emit(`${firstElem} = load i8*, i8** ${firstElemPtr}`);
    gen.emit(`store i8* ${firstElem}, i8** ${accPtr}`);
    gen.emitStore("i32", "1", counterPtr);
  }

  gen.emitBr(checkLabel);

  gen.emitLabel(checkLabel);
  const counter = gen.emitLoad("i32", counterPtr);
  const cond = gen.emitIcmp("slt", "i32", counter, length);
  gen.emitBrCond(cond, bodyLabel, endLabel);

  gen.emitLabel(bodyLabel);
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${counter}`);
  const elem = gen.nextTemp();
  gen.emit(`${elem} = load i8*, i8** ${elemPtr}`);

  const acc = gen.nextTemp();
  gen.emit(`${acc} = load i8*, i8** ${accPtr}`);

  const newAcc = gen.emitCall(
    "i8*",
    `@${callbackFn}`,
    buildIterCallArgs(gen, `i8* ${acc}, i8* ${elem}`),
  );
  gen.emit(`store i8* ${newAcc}, i8** ${accPtr}`);

  const nextCounter = gen.nextTemp();
  gen.emit(`${nextCounter} = add i32 ${counter}, 1`);
  gen.emitStore("i32", nextCounter, counterPtr);
  gen.emitBr(checkLabel);

  gen.emitLabel(endLabel);
  const finalAcc = gen.nextTemp();
  gen.emit(`${finalAcc} = load i8*, i8** ${accPtr}`);
  return finalAcc;
}

// ============================================
// map
// ============================================

export function generateArrayMap(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length !== 1) {
    throw new Error("map() requires exactly 1 argument (callback function)");
  }

  const arrayPtr = gen.generateExpression(expr.object, params);
  const { isStringArray, isObjectArray } = detectArrayType(gen, expr, arrayPtr);

  const callbackArg = expr.args[0];
  let callbackFn: string;
  if (callbackArg.type === "variable") {
    callbackFn = gen.mangleUserName((callbackArg as VariableNode).name);
  } else if (callbackArg.type === "arrow_function") {
    if (isStringArray || isObjectArray) {
      gen.setExpectedCallbackParamType("string");
      gen.setExpectedCallbackReturnType("string");
    } else {
      gen.setExpectedCallbackReturnType("number");
    }
    callbackFn = gen.generateExpression(callbackArg, params);
    gen.setExpectedCallbackParamType(null);
    gen.setExpectedCallbackReturnType(null);
  } else {
    throw new Error("map() argument must be a function name or inline function");
  }

  let result: string;
  if (isStringArray || isObjectArray) {
    result = generateStringArrayMapImpl(gen, arrayPtr, callbackFn);
  } else {
    result = generateNumericArrayMap(gen, arrayPtr, callbackFn);
  }
  gen.setLastInlineLambdaEnvPtr(null);
  return result;
}

export function generateStringArrayMap(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length !== 1) {
    throw new Error("map() requires exactly 1 argument (callback function)");
  }

  const arrayPtr = gen.generateExpression(expr.object, params);

  const callbackArg = expr.args[0];
  let callbackFn: string;
  if (callbackArg.type === "variable") {
    callbackFn = gen.mangleUserName((callbackArg as VariableNode).name);
  } else if (callbackArg.type === "arrow_function") {
    gen.setExpectedCallbackParamType("string");
    gen.setExpectedCallbackReturnType("string");
    callbackFn = gen.generateExpression(callbackArg, params);
    gen.setExpectedCallbackParamType(null);
    gen.setExpectedCallbackReturnType(null);
  } else {
    throw new Error("map() argument must be a function name or inline function");
  }

  const result = generateStringArrayMapImpl(gen, arrayPtr, callbackFn);
  gen.setLastInlineLambdaEnvPtr(null);
  return result;
}

function generateNumericArrayMap(
  gen: IGeneratorContext,
  arrayPtr: string,
  callbackFn: string,
): string {
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const length = gen.emitLoad("i32", lenPtr);

  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load double*, double** ${dataPtrField}`);

  // Create result array with same length
  const resultArrayPtr = gen.nextTemp();
  gen.emit(`${resultArrayPtr} = alloca %Array`);

  const doubleSize = 8;
  const lengthI64 = gen.nextTemp();
  gen.emit(`${lengthI64} = zext i32 ${length} to i64`);
  const resultSizeI64 = gen.nextTemp();
  gen.emit(`${resultSizeI64} = mul i64 ${lengthI64}, ${doubleSize}`);
  const resultMem = gen.emitCall("i8*", "@GC_malloc_atomic", `i64 ${resultSizeI64}`);
  const resultDataPtr = gen.emitBitcast(resultMem, "i8*", "double*");

  const resultDataPtrField = gen.nextTemp();
  gen.emit(
    `${resultDataPtrField} = getelementptr inbounds %Array, %Array* ${resultArrayPtr}, i32 0, i32 0`,
  );
  gen.emit(`store double* ${resultDataPtr}, double** ${resultDataPtrField}`);

  const resultLenField = gen.nextTemp();
  gen.emit(
    `${resultLenField} = getelementptr inbounds %Array, %Array* ${resultArrayPtr}, i32 0, i32 1`,
  );
  gen.emitStore("i32", length, resultLenField);

  const resultCapField = gen.nextTemp();
  gen.emit(
    `${resultCapField} = getelementptr inbounds %Array, %Array* ${resultArrayPtr}, i32 0, i32 2`,
  );
  gen.emitStore("i32", length, resultCapField);

  const counterPtr = gen.nextTemp();
  gen.emit(`${counterPtr} = alloca i32`);
  gen.emitStore("i32", "0", counterPtr);

  const checkLabel = gen.nextLabel("map_check");
  const bodyLabel = gen.nextLabel("map_body");
  const endLabel = gen.nextLabel("map_end");

  gen.emitBr(checkLabel);

  gen.emitLabel(checkLabel);
  const counter = gen.emitLoad("i32", counterPtr);
  const cond = gen.emitIcmp("slt", "i32", counter, length);
  gen.emitBrCond(cond, bodyLabel, endLabel);

  gen.emitLabel(bodyLabel);
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${counter}`);
  const elem = gen.emitLoad("double", elemPtr);

  const result = gen.emitCall("double", `@${callbackFn}`, buildIterCallArgs(gen, `double ${elem}`));

  const resultElemPtr = gen.nextTemp();
  gen.emit(
    `${resultElemPtr} = getelementptr inbounds double, double* ${resultDataPtr}, i32 ${counter}`,
  );
  gen.emitStore("double", result, resultElemPtr);

  const nextCounter = gen.nextTemp();
  gen.emit(`${nextCounter} = add i32 ${counter}, 1`);
  gen.emitStore("i32", nextCounter, counterPtr);
  gen.emitBr(checkLabel);

  gen.emitLabel(endLabel);
  return resultArrayPtr;
}

function generateStringArrayMapImpl(
  gen: IGeneratorContext,
  arrayPtr: string,
  callbackFn: string,
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

  const resultArrayPtr = gen.nextTemp();
  gen.emit(`${resultArrayPtr} = alloca %StringArray`);

  const pointerSize = 8;
  const lengthI64 = gen.nextTemp();
  gen.emit(`${lengthI64} = zext i32 ${length} to i64`);
  const resultSizeI64 = gen.nextTemp();
  gen.emit(`${resultSizeI64} = mul i64 ${lengthI64}, ${pointerSize}`);
  const resultMem = gen.emitCall("i8*", "@GC_malloc", `i64 ${resultSizeI64}`);
  const resultDataPtr = gen.emitBitcast(resultMem, "i8*", "i8**");

  const resultDataPtrField = gen.nextTemp();
  gen.emit(
    `${resultDataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${resultArrayPtr}, i32 0, i32 0`,
  );
  gen.emit(`store i8** ${resultDataPtr}, i8*** ${resultDataPtrField}`);

  const resultLenField = gen.nextTemp();
  gen.emit(
    `${resultLenField} = getelementptr inbounds %StringArray, %StringArray* ${resultArrayPtr}, i32 0, i32 1`,
  );
  gen.emitStore("i32", length, resultLenField);

  const resultCapField = gen.nextTemp();
  gen.emit(
    `${resultCapField} = getelementptr inbounds %StringArray, %StringArray* ${resultArrayPtr}, i32 0, i32 2`,
  );
  gen.emitStore("i32", length, resultCapField);

  const counterPtr = gen.nextTemp();
  gen.emit(`${counterPtr} = alloca i32`);
  gen.emitStore("i32", "0", counterPtr);

  const checkLabel = gen.nextLabel("strmap_check");
  const bodyLabel = gen.nextLabel("strmap_body");
  const endLabel = gen.nextLabel("strmap_end");

  gen.emitBr(checkLabel);

  gen.emitLabel(checkLabel);
  const counter = gen.emitLoad("i32", counterPtr);
  const cond = gen.emitIcmp("slt", "i32", counter, length);
  gen.emitBrCond(cond, bodyLabel, endLabel);

  gen.emitLabel(bodyLabel);
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${counter}`);
  const elem = gen.nextTemp();
  gen.emit(`${elem} = load i8*, i8** ${elemPtr}`);

  const result = gen.emitCall("i8*", `@${callbackFn}`, buildIterCallArgs(gen, `i8* ${elem}`));

  const resultElemPtr = gen.nextTemp();
  gen.emit(`${resultElemPtr} = getelementptr inbounds i8*, i8** ${resultDataPtr}, i32 ${counter}`);
  gen.emit(`store i8* ${result}, i8** ${resultElemPtr}`);

  const nextCounter = gen.nextTemp();
  gen.emit(`${nextCounter} = add i32 ${counter}, 1`);
  gen.emitStore("i32", nextCounter, counterPtr);
  gen.emitBr(checkLabel);

  gen.emitLabel(endLabel);
  gen.setVariableType(resultArrayPtr, "%StringArray*");
  return resultArrayPtr;
}
