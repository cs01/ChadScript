// Array search-predicate operations: find, some, every, includes
// Exported functions accept (gen, expr, params) and handle predicate resolution internally.

import { MethodCallNode, VariableNode } from "../../../../ast/types.js";
import { IGeneratorContext, loadArrayMeta, detectArrayType } from "./context.js";

interface ExprBase {
  type: string;
}

// ============================================
// find
// ============================================

export function generateArrayFind(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length !== 1) {
    throw new Error("find() requires exactly 1 argument (predicate function)");
  }

  const arrayPtr = gen.generateExpression(expr.object, params);
  const { isStringArray, isObjectArray } = detectArrayType(gen, expr, arrayPtr);

  const predicateArg = expr.args[0];
  let predicateFn: string;
  if (predicateArg.type === "variable") {
    predicateFn = gen.mangleUserName((predicateArg as VariableNode).name);
  } else if (predicateArg.type === "arrow_function") {
    if (isStringArray || isObjectArray) {
      gen.setExpectedCallbackParamType("string");
    }
    predicateFn = gen.generateExpression(predicateArg, params);
    gen.setExpectedCallbackParamType(null);
  } else {
    throw new Error("find() argument must be a function name or inline function");
  }

  if (isStringArray || isObjectArray) {
    return generateStringArrayFind(gen, arrayPtr, predicateFn);
  }
  return generateNumericArrayFind(gen, arrayPtr, predicateFn);
}

function generateNumericArrayFind(
  gen: IGeneratorContext,
  arrayPtr: string,
  predicateFn: string,
): string {
  const arrayMeta = loadArrayMeta(gen, arrayPtr);
  const length = arrayMeta.length;
  const dataPtr = arrayMeta.dataPtr;

  const loopLabel = gen.nextLabel("find_loop");
  const checkLabel = gen.nextLabel("find_check");
  const bodyLabel = gen.nextLabel("find_body");
  const foundLabel = gen.nextLabel("find_found");
  const endLabel = gen.nextLabel("find_end");

  const counterPtr = gen.nextTemp();
  gen.emit(`${counterPtr} = alloca i32`);
  gen.emitStore("i32", "0", counterPtr);

  const resultPtr = gen.nextTemp();
  gen.emit(`${resultPtr} = alloca double`);
  gen.emitStore("double", "0.0", resultPtr);

  gen.emitBr(checkLabel);

  gen.emitLabel(checkLabel);
  const counter = gen.emitLoad("i32", counterPtr);
  const cond = gen.emitIcmp("slt", "i32", counter, length);
  gen.emitBrCond(cond, bodyLabel, endLabel);

  gen.emitLabel(bodyLabel);
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${counter}`);
  const elem = gen.emitLoad("double", elemPtr);

  const predicateResult = gen.emitCall("double", `@${predicateFn}`, `double ${elem}`);

  const isTruthy = gen.nextTemp();
  gen.emit(`${isTruthy} = fcmp one double ${predicateResult}, 0.0`);
  gen.emitBrCond(isTruthy, foundLabel, loopLabel);

  gen.emitLabel(foundLabel);
  gen.emitStore("double", elem, resultPtr);
  gen.emitBr(endLabel);

  gen.emitLabel(loopLabel);
  const nextCounter = gen.nextTemp();
  gen.emit(`${nextCounter} = add i32 ${counter}, 1`);
  gen.emitStore("i32", nextCounter, counterPtr);
  gen.emitBr(checkLabel);

  gen.emitLabel(endLabel);
  const result = gen.emitLoad("double", resultPtr);
  return result;
}

function generateStringArrayFind(
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

  const loopLabel = gen.nextLabel("find_loop");
  const checkLabel = gen.nextLabel("find_check");
  const bodyLabel = gen.nextLabel("find_body");
  const foundLabel = gen.nextLabel("find_found");
  const endLabel = gen.nextLabel("find_end");

  const counterPtr = gen.nextTemp();
  gen.emit(`${counterPtr} = alloca i32`);
  gen.emitStore("i32", "0", counterPtr);

  const resultPtr = gen.nextTemp();
  gen.emit(`${resultPtr} = alloca i8*`);
  gen.emit(`store i8* null, i8** ${resultPtr}`);

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

  const predicateResult = gen.emitCall("double", `@${predicateFn}`, `i8* ${elem}`);

  const isTruthy = gen.nextTemp();
  gen.emit(`${isTruthy} = fcmp one double ${predicateResult}, 0.0`);
  gen.emitBrCond(isTruthy, foundLabel, loopLabel);

  gen.emitLabel(foundLabel);
  gen.emit(`store i8* ${elem}, i8** ${resultPtr}`);
  gen.emitBr(endLabel);

  gen.emitLabel(loopLabel);
  const nextCounter = gen.nextTemp();
  gen.emit(`${nextCounter} = add i32 ${counter}, 1`);
  gen.emitStore("i32", nextCounter, counterPtr);
  gen.emitBr(checkLabel);

  gen.emitLabel(endLabel);
  const result = gen.nextTemp();
  gen.emit(`${result} = load i8*, i8** ${resultPtr}`);
  gen.setVariableType(result, "i8*");
  return result;
}

// ============================================
// some
// ============================================

export function generateArraySome(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length !== 1) {
    throw new Error("some() requires exactly 1 argument (predicate function)");
  }

  const arrayPtr = gen.generateExpression(expr.object, params);
  const { isStringArray, isObjectArray } = detectArrayType(gen, expr, arrayPtr);

  const predicateArg = expr.args[0];
  let predicateFn: string;
  if (predicateArg.type === "variable") {
    predicateFn = gen.mangleUserName((predicateArg as VariableNode).name);
  } else if (predicateArg.type === "arrow_function") {
    if (isStringArray || isObjectArray) {
      gen.setExpectedCallbackParamType("string");
    }
    predicateFn = gen.generateExpression(predicateArg, params);
    gen.setExpectedCallbackParamType(null);
  } else {
    throw new Error("some() argument must be a function name or inline function");
  }

  if (isStringArray || isObjectArray) {
    return generateStringArraySome(gen, arrayPtr, predicateFn);
  }
  return generateNumericArraySome(gen, arrayPtr, predicateFn);
}

function generateNumericArraySome(
  gen: IGeneratorContext,
  arrayPtr: string,
  predicateFn: string,
): string {
  const arrayMeta = loadArrayMeta(gen, arrayPtr);
  const length = arrayMeta.length;
  const dataPtr = arrayMeta.dataPtr;

  const loopLabel = gen.nextLabel("some_loop");
  const checkLabel = gen.nextLabel("some_check");
  const bodyLabel = gen.nextLabel("some_body");
  const foundLabel = gen.nextLabel("some_found");
  const endLabel = gen.nextLabel("some_end");

  const counterPtr = gen.nextTemp();
  gen.emit(`${counterPtr} = alloca i32`);
  gen.emitStore("i32", "0", counterPtr);

  const resultPtr = gen.nextTemp();
  gen.emit(`${resultPtr} = alloca i32`);
  gen.emitStore("i32", "0", resultPtr);

  gen.emitBr(checkLabel);

  gen.emitLabel(checkLabel);
  const counter = gen.emitLoad("i32", counterPtr);
  const cond = gen.emitIcmp("slt", "i32", counter, length);
  gen.emitBrCond(cond, bodyLabel, endLabel);

  gen.emitLabel(bodyLabel);
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${counter}`);
  const elem = gen.emitLoad("double", elemPtr);

  const predicateResult = gen.emitCall("double", `@${predicateFn}`, `double ${elem}`);

  const isTruthy = gen.nextTemp();
  gen.emit(`${isTruthy} = fcmp one double ${predicateResult}, 0.0`);
  gen.emitBrCond(isTruthy, foundLabel, loopLabel);

  gen.emitLabel(foundLabel);
  gen.emitStore("i32", "1", resultPtr);
  gen.emitBr(endLabel);

  gen.emitLabel(loopLabel);
  const nextCounter = gen.nextTemp();
  gen.emit(`${nextCounter} = add i32 ${counter}, 1`);
  gen.emitStore("i32", nextCounter, counterPtr);
  gen.emitBr(checkLabel);

  gen.emitLabel(endLabel);
  const resultI32 = gen.emitLoad("i32", resultPtr);
  const result = gen.nextTemp();
  gen.emit(`${result} = sitofp i32 ${resultI32} to double`);
  return result;
}

function generateStringArraySome(
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

  const loopLabel = gen.nextLabel("some_loop");
  const checkLabel = gen.nextLabel("some_check");
  const bodyLabel = gen.nextLabel("some_body");
  const foundLabel = gen.nextLabel("some_found");
  const endLabel = gen.nextLabel("some_end");

  const counterPtr = gen.nextTemp();
  gen.emit(`${counterPtr} = alloca i32`);
  gen.emitStore("i32", "0", counterPtr);

  const resultPtr = gen.nextTemp();
  gen.emit(`${resultPtr} = alloca i32`);
  gen.emitStore("i32", "0", resultPtr);

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

  const predicateResult = gen.emitCall("double", `@${predicateFn}`, `i8* ${elem}`);

  const isTruthy = gen.nextTemp();
  gen.emit(`${isTruthy} = fcmp one double ${predicateResult}, 0.0`);
  gen.emitBrCond(isTruthy, foundLabel, loopLabel);

  gen.emitLabel(foundLabel);
  gen.emitStore("i32", "1", resultPtr);
  gen.emitBr(endLabel);

  gen.emitLabel(loopLabel);
  const nextCounter = gen.nextTemp();
  gen.emit(`${nextCounter} = add i32 ${counter}, 1`);
  gen.emitStore("i32", nextCounter, counterPtr);
  gen.emitBr(checkLabel);

  gen.emitLabel(endLabel);
  const resultI32 = gen.emitLoad("i32", resultPtr);
  const result = gen.nextTemp();
  gen.emit(`${result} = sitofp i32 ${resultI32} to double`);
  return result;
}

// ============================================
// every
// ============================================

export function generateArrayEvery(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length !== 1) {
    throw new Error("every() requires exactly 1 argument (predicate function)");
  }

  const arrayPtr = gen.generateExpression(expr.object, params);
  const { isStringArray, isObjectArray } = detectArrayType(gen, expr, arrayPtr);

  const predicateArg = expr.args[0];
  let predicateFn: string;
  if (predicateArg.type === "variable") {
    predicateFn = gen.mangleUserName((predicateArg as VariableNode).name);
  } else if (predicateArg.type === "arrow_function") {
    if (isStringArray || isObjectArray) {
      gen.setExpectedCallbackParamType("string");
    }
    predicateFn = gen.generateExpression(predicateArg, params);
    gen.setExpectedCallbackParamType(null);
  } else {
    throw new Error("every() argument must be a function name or inline function");
  }

  if (isStringArray || isObjectArray) {
    return generateStringArrayEvery(gen, arrayPtr, predicateFn);
  }
  return generateNumericArrayEvery(gen, arrayPtr, predicateFn);
}

function generateNumericArrayEvery(
  gen: IGeneratorContext,
  arrayPtr: string,
  predicateFn: string,
): string {
  const arrayMeta = loadArrayMeta(gen, arrayPtr);
  const length = arrayMeta.length;
  const dataPtr = arrayMeta.dataPtr;

  const loopLabel = gen.nextLabel("every_loop");
  const checkLabel = gen.nextLabel("every_check");
  const bodyLabel = gen.nextLabel("every_body");
  const failedLabel = gen.nextLabel("every_failed");
  const endLabel = gen.nextLabel("every_end");

  const counterPtr = gen.nextTemp();
  gen.emit(`${counterPtr} = alloca i32`);
  gen.emitStore("i32", "0", counterPtr);

  const resultPtr = gen.nextTemp();
  gen.emit(`${resultPtr} = alloca i32`);
  gen.emitStore("i32", "1", resultPtr);

  gen.emitBr(checkLabel);

  gen.emitLabel(checkLabel);
  const counter = gen.emitLoad("i32", counterPtr);
  const cond = gen.emitIcmp("slt", "i32", counter, length);
  gen.emitBrCond(cond, bodyLabel, endLabel);

  gen.emitLabel(bodyLabel);
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${counter}`);
  const elem = gen.emitLoad("double", elemPtr);

  const predicateResult = gen.emitCall("double", `@${predicateFn}`, `double ${elem}`);

  const isFalsy = gen.nextTemp();
  gen.emit(`${isFalsy} = fcmp oeq double ${predicateResult}, 0.0`);
  gen.emitBrCond(isFalsy, failedLabel, loopLabel);

  gen.emitLabel(failedLabel);
  gen.emitStore("i32", "0", resultPtr);
  gen.emitBr(endLabel);

  gen.emitLabel(loopLabel);
  const nextCounter = gen.nextTemp();
  gen.emit(`${nextCounter} = add i32 ${counter}, 1`);
  gen.emitStore("i32", nextCounter, counterPtr);
  gen.emitBr(checkLabel);

  gen.emitLabel(endLabel);
  const resultI32 = gen.emitLoad("i32", resultPtr);
  const result = gen.nextTemp();
  gen.emit(`${result} = sitofp i32 ${resultI32} to double`);
  return result;
}

function generateStringArrayEvery(
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

  const loopLabel = gen.nextLabel("every_loop");
  const checkLabel = gen.nextLabel("every_check");
  const bodyLabel = gen.nextLabel("every_body");
  const failedLabel = gen.nextLabel("every_failed");
  const endLabel = gen.nextLabel("every_end");

  const counterPtr = gen.nextTemp();
  gen.emit(`${counterPtr} = alloca i32`);
  gen.emitStore("i32", "0", counterPtr);

  const resultPtr = gen.nextTemp();
  gen.emit(`${resultPtr} = alloca i32`);
  gen.emitStore("i32", "1", resultPtr);

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

  const predicateResult = gen.emitCall("double", `@${predicateFn}`, `i8* ${elem}`);

  const isFalsy = gen.nextTemp();
  gen.emit(`${isFalsy} = fcmp oeq double ${predicateResult}, 0.0`);
  gen.emitBrCond(isFalsy, failedLabel, loopLabel);

  gen.emitLabel(failedLabel);
  gen.emitStore("i32", "0", resultPtr);
  gen.emitBr(endLabel);

  gen.emitLabel(loopLabel);
  const nextCounter = gen.nextTemp();
  gen.emit(`${nextCounter} = add i32 ${counter}, 1`);
  gen.emitStore("i32", nextCounter, counterPtr);
  gen.emitBr(checkLabel);

  gen.emitLabel(endLabel);
  const resultI32 = gen.emitLoad("i32", resultPtr);
  const result = gen.nextTemp();
  gen.emit(`${result} = sitofp i32 ${resultI32} to double`);
  return result;
}

// ============================================
// includes
// ============================================

export function generateArrayIncludes(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length !== 1) {
    throw new Error("includes() requires exactly 1 argument");
  }

  const arrayPtr = gen.generateExpression(expr.object, params);
  const searchValue = gen.generateExpression(expr.args[0], params);

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

  if (isStringArray) {
    return generateStringArrayIncludes(gen, arrayPtr, searchValue);
  } else {
    return generateIntArrayIncludes(gen, arrayPtr, searchValue);
  }
}

function generateIntArrayIncludes(
  gen: IGeneratorContext,
  arrayPtr: string,
  searchValue: string,
): string {
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const length = gen.emitLoad("i32", lenPtr);

  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load double*, double** ${dataPtrField}`);

  const loopLabel = gen.nextLabel("includes_loop");
  const checkLabel = gen.nextLabel("includes_check");
  const bodyLabel = gen.nextLabel("includes_body");
  const foundLabel = gen.nextLabel("includes_found");
  const endLabel = gen.nextLabel("includes_end");

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

  const dblSearchValue = gen.ensureDouble(searchValue);
  const isEqual = gen.nextTemp();
  gen.emit(`${isEqual} = fcmp oeq double ${elem}, ${dblSearchValue}`);
  gen.emitBrCond(isEqual, foundLabel, loopLabel);

  gen.emitLabel(foundLabel);
  gen.emitBr(endLabel);

  gen.emitLabel(loopLabel);
  const nextCounter = gen.nextTemp();
  gen.emit(`${nextCounter} = add i32 ${counter}, 1`);
  gen.emitStore("i32", nextCounter, counterPtr);
  gen.emitBr(checkLabel);

  // phi selects 0 (not found from check) or 1 (found)
  gen.emitLabel(endLabel);
  const resultI32 = gen.nextTemp();
  gen.emit(`${resultI32} = phi i32 [ 0, %${checkLabel} ], [ 1, %${foundLabel} ]`);
  const result = gen.nextTemp();
  gen.emit(`${result} = sitofp i32 ${resultI32} to double`);
  return result;
}

function generateStringArrayIncludes(
  gen: IGeneratorContext,
  arrayPtr: string,
  searchValue: string,
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

  const loopLabel = gen.nextLabel("includes_loop");
  const checkLabel = gen.nextLabel("includes_check");
  const bodyLabel = gen.nextLabel("includes_body");
  const foundLabel = gen.nextLabel("includes_found");
  const endLabel = gen.nextLabel("includes_end");

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

  const cmpResult = gen.emitCall("i32", "@strcmp", `i8* ${elem}, i8* ${searchValue}`);
  const isEqual = gen.emitIcmp("eq", "i32", cmpResult, "0");
  gen.emitBrCond(isEqual, foundLabel, loopLabel);

  gen.emitLabel(foundLabel);
  gen.emitBr(endLabel);

  gen.emitLabel(loopLabel);
  const nextCounter = gen.nextTemp();
  gen.emit(`${nextCounter} = add i32 ${counter}, 1`);
  gen.emitStore("i32", nextCounter, counterPtr);
  gen.emitBr(checkLabel);

  // phi selects 0 (not found from check) or 1 (found)
  gen.emitLabel(endLabel);
  const resultI32 = gen.nextTemp();
  gen.emit(`${resultI32} = phi i32 [ 0, %${checkLabel} ], [ 1, %${foundLabel} ]`);
  const result = gen.nextTemp();
  gen.emit(`${result} = sitofp i32 ${resultI32} to double`);
  return result;
}
