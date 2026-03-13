// Array iteration operations: filter, forEach, reduce, map
// Exported functions accept (gen, expr, params) and handle callback resolution internally.

import { MethodCallNode, VariableNode, ArrowFunctionNode } from "../../../../ast/types.js";
import { IGeneratorContext, loadArrayMeta, detectArrayType } from "./context.js";

interface ExprBase {
  type: string;
}

function getCallbackParamCount(callbackArg: ExprBase): number {
  if (callbackArg.type === "arrow_function") {
    const arrowFn = callbackArg as unknown as ArrowFunctionNode;
    return arrowFn.params ? arrowFn.params.length : 1;
  }
  return 1;
}

function buildIterCallArgs(gen: IGeneratorContext, baseArgs: string): string {
  const envPtr = gen.getLastInlineLambdaEnvPtr();
  if (envPtr) {
    return `i8* ${envPtr}, ${baseArgs}`;
  }
  return baseArgs;
}

function buildIterCallArgsWithIndex(
  gen: IGeneratorContext,
  baseArgs: string,
  counter: string,
  paramCount: number,
): string {
  let args = baseArgs;
  if (paramCount >= 2) {
    const indexAsDouble = gen.nextTemp();
    gen.emit(`${indexAsDouble} = sitofp i32 ${counter} to double`);
    args = `${args}, double ${indexAsDouble}`;
  }
  const envPtr = gen.getLastInlineLambdaEnvPtr();
  if (envPtr) {
    return `i8* ${envPtr}, ${args}`;
  }
  return args;
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
    return gen.emitError("filter() requires exactly 1 argument (predicate function)", expr.loc);
  }

  const arrayPtr = gen.generateExpression(expr.object, params);
  const { isStringArray, isObjectArray } = detectArrayType(gen, expr, arrayPtr);

  const callbackArg = expr.args[0];
  const paramCount = getCallbackParamCount(callbackArg as ExprBase);
  let predicateFn: string;
  if (callbackArg.type === "variable") {
    predicateFn = gen.mangleUserName((callbackArg as VariableNode).name);
  } else if (callbackArg.type === "arrow_function") {
    if (isStringArray || isObjectArray) {
      if (paramCount >= 2) {
        gen.setExpectedCallbackParamTypes(["string", "number"]);
      } else {
        gen.setExpectedCallbackParamType("string");
      }
    } else if (paramCount >= 2) {
      gen.setExpectedCallbackParamTypes(["number", "number"]);
    }
    predicateFn = gen.generateExpression(callbackArg, params);
    gen.setExpectedCallbackParamType(null);
    gen.setExpectedCallbackParamTypes(null);
  } else {
    return gen.emitError("filter() argument must be a function name or inline function", expr.loc);
  }

  let result: string;
  if (isStringArray || isObjectArray) {
    result = generateStringArrayFilter(gen, arrayPtr, predicateFn, paramCount);
  } else {
    result = generateNumericArrayFilter(gen, arrayPtr, predicateFn, paramCount);
  }
  gen.setLastInlineLambdaEnvPtr(null);
  return result;
}

function generateNumericArrayFilter(
  gen: IGeneratorContext,
  arrayPtr: string,
  predicateFn: string,
  paramCount: number = 1,
): string {
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const length = gen.emitLoad("i32", lenPtr);

  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load double*, double** ${dataPtrField}`);

  // Create result array (heap-allocate so pointer survives if stored in class fields)
  const resultArrayMem = gen.emitCall("i8*", "@GC_malloc", "i64 24");
  const resultArrayPtr = gen.emitBitcast(resultArrayMem, "i8*", "%Array*");

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
    buildIterCallArgsWithIndex(gen, `double ${elem}`, counter, paramCount),
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
  gen.setVariableType(resultArrayPtr, "%Array*");
  return resultArrayPtr;
}

function generateStringArrayFilter(
  gen: IGeneratorContext,
  arrayPtr: string,
  predicateFn: string,
  paramCount: number = 1,
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

  const resultArrayMem = gen.emitCall("i8*", "@GC_malloc", "i64 24");
  const resultArrayPtr = gen.emitBitcast(resultArrayMem, "i8*", "%StringArray*");

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
    buildIterCallArgsWithIndex(gen, `i8* ${elem}`, counter, paramCount),
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
    return gen.emitError("forEach() requires exactly 1 argument (callback function)", expr.loc);
  }

  const arrayPtr = gen.generateExpression(expr.object, params);
  const { isStringArray, isObjectArray } = detectArrayType(gen, expr, arrayPtr);

  const callbackArg = expr.args[0];
  const paramCount = getCallbackParamCount(callbackArg as ExprBase);
  let callbackFn: string;
  if (callbackArg.type === "variable") {
    callbackFn = gen.mangleUserName((callbackArg as VariableNode).name);
  } else if (callbackArg.type === "arrow_function") {
    if (isStringArray || isObjectArray) {
      if (paramCount >= 2) {
        gen.setExpectedCallbackParamTypes(["string", "number"]);
      } else {
        gen.setExpectedCallbackParamType("string");
      }
    } else if (paramCount >= 2) {
      gen.setExpectedCallbackParamTypes(["number", "number"]);
    }
    callbackFn = gen.generateExpression(callbackArg, params);
    gen.setExpectedCallbackParamType(null);
    gen.setExpectedCallbackParamTypes(null);
  } else {
    return gen.emitError("forEach() argument must be a function name or inline function", expr.loc);
  }

  let result: string;
  if (isStringArray || isObjectArray) {
    result = generateStringArrayForEach(gen, arrayPtr, callbackFn, paramCount);
  } else {
    result = generateNumericArrayForEach(gen, arrayPtr, callbackFn, paramCount);
  }
  gen.setLastInlineLambdaEnvPtr(null);
  return result;
}

function generateNumericArrayForEach(
  gen: IGeneratorContext,
  arrayPtr: string,
  callbackFn: string,
  paramCount: number = 1,
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

  gen.emitCall("double", `@${callbackFn}`, buildIterCallArgsWithIndex(gen, `double ${elem}`, counter, paramCount));

  const nextCounter = gen.nextTemp();
  gen.emit(`${nextCounter} = add i32 ${counter}, 1`);
  gen.emitStore("i32", nextCounter, counterPtr);
  gen.emitBr(checkLabel);

  gen.emitLabel(endLabel);
  return "0.0";
}

function generateStringArrayForEach(
  gen: IGeneratorContext,
  arrayPtr: string,
  callbackFn: string,
  paramCount: number = 1,
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

  gen.emitCall("double", `@${callbackFn}`, buildIterCallArgsWithIndex(gen, `i8* ${elem}`, counter, paramCount));

  const nextCounter = gen.nextTemp();
  gen.emit(`${nextCounter} = add i32 ${counter}, 1`);
  gen.emitStore("i32", nextCounter, counterPtr);
  gen.emitBr(checkLabel);

  gen.emitLabel(endLabel);
  return "0.0";
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
    return gen.emitError(
      "reduce() requires 1-2 arguments (callback, optional initialValue)",
      expr.loc,
    );
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
    return gen.emitError("reduce() argument must be a function name or inline function", expr.loc);
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
    const isEmpty = gen.emitIcmp("eq", "i32", length, "0");
    const emptyLabel = gen.nextLabel("reduce_empty");
    const okLabel = gen.nextLabel("reduce_has_elems");
    gen.emitBrCond(isEmpty, emptyLabel, okLabel);
    gen.emitLabel(emptyLabel);
    const stderrPtr = gen.nextTemp();
    gen.emit(`${stderrPtr} = load i8*, i8** @stderr`);
    const fmtStr = gen.createStringConstant("Error: reduce of empty array with no initial value\n");
    const fprintfResult = gen.nextTemp();
    gen.emit(
      `${fprintfResult} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, i8* ${fmtStr})`,
    );
    gen.emit("call void @exit(i32 1)");
    gen.emit("unreachable");
    gen.emitLabel(okLabel);
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
  gen.setVariableType(finalAcc, "double");
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
    const isEmpty = gen.emitIcmp("eq", "i32", length, "0");
    const emptyLabel = gen.nextLabel("reduce_empty");
    const okLabel = gen.nextLabel("reduce_has_elems");
    gen.emitBrCond(isEmpty, emptyLabel, okLabel);
    gen.emitLabel(emptyLabel);
    const stderrPtr = gen.nextTemp();
    gen.emit(`${stderrPtr} = load i8*, i8** @stderr`);
    const fmtStr = gen.createStringConstant("Error: reduce of empty array with no initial value\n");
    const fprintfResult = gen.nextTemp();
    gen.emit(
      `${fprintfResult} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, i8* ${fmtStr})`,
    );
    gen.emit("call void @exit(i32 1)");
    gen.emit("unreachable");
    gen.emitLabel(okLabel);
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
  const finalAcc = gen.emitLoad("i8*", accPtr);
  gen.setVariableType(finalAcc, "i8*");
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
    return gen.emitError("map() requires exactly 1 argument (callback function)", expr.loc);
  }

  const arrayPtr = gen.generateExpression(expr.object, params);
  const { isStringArray, isObjectArray } = detectArrayType(gen, expr, arrayPtr);

  const callbackArg = expr.args[0];
  const paramCount = getCallbackParamCount(callbackArg as ExprBase);
  let callbackFn: string;
  if (callbackArg.type === "variable") {
    callbackFn = gen.mangleUserName((callbackArg as VariableNode).name);
  } else if (callbackArg.type === "arrow_function") {
    if (isStringArray || isObjectArray) {
      if (paramCount >= 2) {
        gen.setExpectedCallbackParamTypes(["string", "number"]);
      } else {
        gen.setExpectedCallbackParamType("string");
      }
      gen.setExpectedCallbackReturnType("string");
    } else {
      if (paramCount >= 2) {
        gen.setExpectedCallbackParamTypes(["number", "number"]);
      }
      gen.setExpectedCallbackReturnType("number");
    }
    callbackFn = gen.generateExpression(callbackArg, params);
    gen.setExpectedCallbackParamType(null);
    gen.setExpectedCallbackParamTypes(null);
    gen.setExpectedCallbackReturnType(null);
  } else {
    return gen.emitError("map() argument must be a function name or inline function", expr.loc);
  }

  let result: string;
  if (isStringArray || isObjectArray) {
    result = generateStringArrayMapImpl(gen, arrayPtr, callbackFn, paramCount);
  } else {
    result = generateNumericArrayMap(gen, arrayPtr, callbackFn, paramCount);
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
    return gen.emitError("map() requires exactly 1 argument (callback function)", expr.loc);
  }

  const arrayPtr = gen.generateExpression(expr.object, params);

  const callbackArg = expr.args[0];
  const paramCount = getCallbackParamCount(callbackArg as ExprBase);
  let callbackFn: string;
  if (callbackArg.type === "variable") {
    callbackFn = gen.mangleUserName((callbackArg as VariableNode).name);
  } else if (callbackArg.type === "arrow_function") {
    if (paramCount >= 2) {
      gen.setExpectedCallbackParamTypes(["string", "number"]);
    } else {
      gen.setExpectedCallbackParamType("string");
    }
    gen.setExpectedCallbackReturnType("string");
    callbackFn = gen.generateExpression(callbackArg, params);
    gen.setExpectedCallbackParamType(null);
    gen.setExpectedCallbackParamTypes(null);
    gen.setExpectedCallbackReturnType(null);
  } else {
    return gen.emitError("map() argument must be a function name or inline function", expr.loc);
  }

  const result = generateStringArrayMapImpl(gen, arrayPtr, callbackFn, paramCount);
  gen.setLastInlineLambdaEnvPtr(null);
  return result;
}

function generateNumericArrayMap(
  gen: IGeneratorContext,
  arrayPtr: string,
  callbackFn: string,
  paramCount: number = 1,
): string {
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const length = gen.emitLoad("i32", lenPtr);

  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load double*, double** ${dataPtrField}`);

  // Create result array with same length (heap-allocate for safety)
  const resultArrayMem = gen.emitCall("i8*", "@GC_malloc", "i64 24");
  const resultArrayPtr = gen.emitBitcast(resultArrayMem, "i8*", "%Array*");

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

  const result = gen.emitCall("double", `@${callbackFn}`, buildIterCallArgsWithIndex(gen, `double ${elem}`, counter, paramCount));

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
  gen.setVariableType(resultArrayPtr, "%Array*");
  return resultArrayPtr;
}

function generateStringArrayMapImpl(
  gen: IGeneratorContext,
  arrayPtr: string,
  callbackFn: string,
  paramCount: number = 1,
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

  const resultArrayMem = gen.emitCall("i8*", "@GC_malloc", "i64 24");
  const resultArrayPtr = gen.emitBitcast(resultArrayMem, "i8*", "%StringArray*");

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

  const result = gen.emitCall("i8*", `@${callbackFn}`, buildIterCallArgsWithIndex(gen, `i8* ${elem}`, counter, paramCount));

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

// ============================================
// reduceRight
// ============================================

export function generateArrayReduceRight(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length < 1 || expr.args.length > 2) {
    return gen.emitError(
      "reduceRight() requires 1-2 arguments (callback, optional initialValue)",
      expr.loc,
    );
  }

  const arrayPtr = gen.generateExpression(expr.object, params);

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
    return gen.emitError(
      "reduceRight() argument must be a function name or inline function",
      expr.loc,
    );
  }

  let initialValue: string | null = null;
  if (expr.args.length === 2) {
    initialValue = gen.generateExpression(expr.args[1], params);
  }

  let result: string;
  if (isStringArray) {
    result = generateStringArrayReduceRight(gen, arrayPtr, callbackFn, initialValue);
  } else {
    result = generateNumericArrayReduceRight(gen, arrayPtr, callbackFn, initialValue);
  }
  gen.setLastInlineLambdaEnvPtr(null);
  return result;
}

function generateNumericArrayReduceRight(
  gen: IGeneratorContext,
  arrayPtr: string,
  callbackFn: string,
  initialValue: string | null,
): string {
  const arrayMeta = loadArrayMeta(gen, arrayPtr);
  const length = arrayMeta.length;
  const dataPtr = arrayMeta.dataPtr;

  const checkLabel = gen.nextLabel("reduceright_check");
  const bodyLabel = gen.nextLabel("reduceright_body");
  const endLabel = gen.nextLabel("reduceright_end");

  const accPtr = gen.nextTemp();
  gen.emit(`${accPtr} = alloca double`);

  const counterPtr = gen.nextTemp();
  gen.emit(`${counterPtr} = alloca i32`);

  if (initialValue !== null) {
    const dblInit = gen.ensureDouble(initialValue);
    gen.emitStore("double", dblInit, accPtr);
    const lastIdx = gen.nextTemp();
    gen.emit(`${lastIdx} = sub i32 ${length}, 1`);
    gen.emitStore("i32", lastIdx, counterPtr);
  } else {
    const isEmpty = gen.emitIcmp("eq", "i32", length, "0");
    const emptyLabel = gen.nextLabel("reduceright_empty");
    const okLabel = gen.nextLabel("reduceright_has_elems");
    gen.emitBrCond(isEmpty, emptyLabel, okLabel);
    gen.emitLabel(emptyLabel);
    const stderrPtr = gen.nextTemp();
    gen.emit(`${stderrPtr} = load i8*, i8** @stderr`);
    const fmtStr = gen.createStringConstant(
      "Error: reduceRight of empty array with no initial value\n",
    );
    const fprintfResult = gen.nextTemp();
    gen.emit(
      `${fprintfResult} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, i8* ${fmtStr})`,
    );
    gen.emit("call void @exit(i32 1)");
    gen.emit("unreachable");
    gen.emitLabel(okLabel);
    const lastIdx = gen.nextTemp();
    gen.emit(`${lastIdx} = sub i32 ${length}, 1`);
    const lastElemPtr = gen.nextTemp();
    gen.emit(`${lastElemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${lastIdx}`);
    const lastElem = gen.emitLoad("double", lastElemPtr);
    gen.emitStore("double", lastElem, accPtr);
    const startIdx = gen.nextTemp();
    gen.emit(`${startIdx} = sub i32 ${length}, 2`);
    gen.emitStore("i32", startIdx, counterPtr);
  }

  gen.emitBr(checkLabel);

  gen.emitLabel(checkLabel);
  const counter = gen.emitLoad("i32", counterPtr);
  const cond = gen.emitIcmp("sge", "i32", counter, "0");
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
  gen.emit(`${nextCounter} = sub i32 ${counter}, 1`);
  gen.emitStore("i32", nextCounter, counterPtr);
  gen.emitBr(checkLabel);

  gen.emitLabel(endLabel);
  const finalAcc = gen.emitLoad("double", accPtr);
  gen.setVariableType(finalAcc, "double");
  return finalAcc;
}

function generateStringArrayReduceRight(
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

  const checkLabel = gen.nextLabel("reduceright_check");
  const bodyLabel = gen.nextLabel("reduceright_body");
  const endLabel = gen.nextLabel("reduceright_end");

  const accPtr = gen.nextTemp();
  gen.emit(`${accPtr} = alloca i8*`);

  const counterPtr = gen.nextTemp();
  gen.emit(`${counterPtr} = alloca i32`);

  if (initialValue !== null) {
    gen.emit(`store i8* ${initialValue}, i8** ${accPtr}`);
    const lastIdx = gen.nextTemp();
    gen.emit(`${lastIdx} = sub i32 ${length}, 1`);
    gen.emitStore("i32", lastIdx, counterPtr);
  } else {
    const isEmpty = gen.emitIcmp("eq", "i32", length, "0");
    const emptyLabel = gen.nextLabel("reduceright_empty");
    const okLabel = gen.nextLabel("reduceright_has_elems");
    gen.emitBrCond(isEmpty, emptyLabel, okLabel);
    gen.emitLabel(emptyLabel);
    const stderrPtr = gen.nextTemp();
    gen.emit(`${stderrPtr} = load i8*, i8** @stderr`);
    const fmtStr = gen.createStringConstant(
      "Error: reduceRight of empty array with no initial value\n",
    );
    const fprintfResult = gen.nextTemp();
    gen.emit(
      `${fprintfResult} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, i8* ${fmtStr})`,
    );
    gen.emit("call void @exit(i32 1)");
    gen.emit("unreachable");
    gen.emitLabel(okLabel);
    const lastIdx = gen.nextTemp();
    gen.emit(`${lastIdx} = sub i32 ${length}, 1`);
    const lastElemPtr = gen.nextTemp();
    gen.emit(`${lastElemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${lastIdx}`);
    const lastElem = gen.nextTemp();
    gen.emit(`${lastElem} = load i8*, i8** ${lastElemPtr}`);
    gen.emit(`store i8* ${lastElem}, i8** ${accPtr}`);
    const startIdx = gen.nextTemp();
    gen.emit(`${startIdx} = sub i32 ${length}, 2`);
    gen.emitStore("i32", startIdx, counterPtr);
  }

  gen.emitBr(checkLabel);

  gen.emitLabel(checkLabel);
  const counter = gen.emitLoad("i32", counterPtr);
  const cond = gen.emitIcmp("sge", "i32", counter, "0");
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
  gen.emit(`${nextCounter} = sub i32 ${counter}, 1`);
  gen.emitStore("i32", nextCounter, counterPtr);
  gen.emitBr(checkLabel);

  gen.emitLabel(endLabel);
  const finalAcc = gen.emitLoad("i8*", accPtr);
  gen.setVariableType(finalAcc, "i8*");
  return finalAcc;
}
