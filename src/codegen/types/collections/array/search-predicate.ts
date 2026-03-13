// Array search-predicate operations: find, some, every, includes
// Exported functions accept (gen, expr, params) and handle predicate resolution internally.

import { MethodCallNode, VariableNode } from "../../../../ast/types.js";
import { IGeneratorContext, loadArrayMeta, detectArrayType } from "./context.js";

interface ExprBase {
  type: string;
}

/** Build call args, prepending env pointer for inline lambdas with captures.
 *  Does NOT clear the env ptr — caller must clear after the loop completes. */
function buildPredicateCallArgs(gen: IGeneratorContext, baseArgs: string): string {
  const envPtr = gen.getLastInlineLambdaEnvPtr();
  if (envPtr) {
    return `i8* ${envPtr}, ${baseArgs}`;
  }
  return baseArgs;
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
    return gen.emitError("find() requires exactly 1 argument (predicate function)", expr.loc);
  }

  const arrayPtr = gen.generateExpression(expr.object, params);
  const { isStringArray, isObjectArray } = detectArrayType(gen, expr, arrayPtr);

  let elementType = "";
  if (isObjectArray) {
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type === "variable") {
      const varName = (expr.object as VariableNode).name;
      elementType = gen.symbolTable.getObjectArrayElementType(varName) || "";
    }
  }

  const predicateArg = expr.args[0];
  let predicateFn: string;
  if (predicateArg.type === "variable") {
    predicateFn = gen.mangleUserName((predicateArg as VariableNode).name);
  } else if (predicateArg.type === "arrow_function") {
    if (isStringArray || isObjectArray) {
      gen.setExpectedCallbackParamType(elementType || "string");
    }
    predicateFn = gen.generateExpression(predicateArg, params);
    gen.setExpectedCallbackParamType(null);
  } else {
    return gen.emitError("find() argument must be a function name or inline function", expr.loc);
  }

  let result: string;
  if (isStringArray || isObjectArray) {
    result = generateStringArrayFind(gen, arrayPtr, predicateFn);
  } else {
    result = generateNumericArrayFind(gen, arrayPtr, predicateFn);
  }
  gen.setLastInlineLambdaEnvPtr(null);
  return result;
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

  const predicateResult = gen.emitCall(
    "double",
    `@${predicateFn}`,
    buildPredicateCallArgs(gen, `double ${elem}`),
  );

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
  gen.setVariableType(result, "double");
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

  const predicateResult = gen.emitCall(
    "double",
    `@${predicateFn}`,
    buildPredicateCallArgs(gen, `i8* ${elem}`),
  );

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
    return gen.emitError("some() requires exactly 1 argument (predicate function)", expr.loc);
  }

  const arrayPtr = gen.generateExpression(expr.object, params);
  const { isStringArray, isObjectArray } = detectArrayType(gen, expr, arrayPtr);

  let elementType = "";
  if (isObjectArray) {
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type === "variable") {
      const varName = (expr.object as VariableNode).name;
      elementType = gen.symbolTable.getObjectArrayElementType(varName) || "";
    }
  }

  const predicateArg = expr.args[0];
  let predicateFn: string;
  if (predicateArg.type === "variable") {
    predicateFn = gen.mangleUserName((predicateArg as VariableNode).name);
  } else if (predicateArg.type === "arrow_function") {
    if (isStringArray || isObjectArray) {
      gen.setExpectedCallbackParamType(elementType || "string");
    }
    predicateFn = gen.generateExpression(predicateArg, params);
    gen.setExpectedCallbackParamType(null);
  } else {
    return gen.emitError("some() argument must be a function name or inline function", expr.loc);
  }

  let result: string;
  if (isStringArray || isObjectArray) {
    result = generateStringArraySome(gen, arrayPtr, predicateFn);
  } else {
    result = generateNumericArraySome(gen, arrayPtr, predicateFn);
  }
  gen.setLastInlineLambdaEnvPtr(null);
  return result;
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

  const predicateResult = gen.emitCall(
    "double",
    `@${predicateFn}`,
    buildPredicateCallArgs(gen, `double ${elem}`),
  );

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
  gen.setVariableType(result, "double");
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

  const predicateResult = gen.emitCall(
    "double",
    `@${predicateFn}`,
    buildPredicateCallArgs(gen, `i8* ${elem}`),
  );

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
  gen.setVariableType(result, "double");
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
    return gen.emitError("every() requires exactly 1 argument (predicate function)", expr.loc);
  }

  const arrayPtr = gen.generateExpression(expr.object, params);
  const { isStringArray, isObjectArray } = detectArrayType(gen, expr, arrayPtr);

  let elementType = "";
  if (isObjectArray) {
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type === "variable") {
      const varName = (expr.object as VariableNode).name;
      elementType = gen.symbolTable.getObjectArrayElementType(varName) || "";
    }
  }

  const predicateArg = expr.args[0];
  let predicateFn: string;
  if (predicateArg.type === "variable") {
    predicateFn = gen.mangleUserName((predicateArg as VariableNode).name);
  } else if (predicateArg.type === "arrow_function") {
    if (isStringArray || isObjectArray) {
      gen.setExpectedCallbackParamType(elementType || "string");
    }
    predicateFn = gen.generateExpression(predicateArg, params);
    gen.setExpectedCallbackParamType(null);
  } else {
    return gen.emitError("every() argument must be a function name or inline function", expr.loc);
  }

  let result: string;
  if (isStringArray || isObjectArray) {
    result = generateStringArrayEvery(gen, arrayPtr, predicateFn);
  } else {
    result = generateNumericArrayEvery(gen, arrayPtr, predicateFn);
  }
  gen.setLastInlineLambdaEnvPtr(null);
  return result;
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

  const predicateResult = gen.emitCall(
    "double",
    `@${predicateFn}`,
    buildPredicateCallArgs(gen, `double ${elem}`),
  );

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
  gen.setVariableType(result, "double");
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

  const predicateResult = gen.emitCall(
    "double",
    `@${predicateFn}`,
    buildPredicateCallArgs(gen, `i8* ${elem}`),
  );

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
  gen.setVariableType(result, "double");
  return result;
}

// ============================================
// includes
// ============================================

function resolveIncludesFromIndex(
  gen: IGeneratorContext,
  fromIndex: string,
  length: string,
): string {
  const isNeg = gen.emitIcmp("slt", "i32", fromIndex, "0");
  const adjusted = gen.nextTemp();
  gen.emit(`${adjusted} = add i32 ${fromIndex}, ${length}`);
  const resolved = gen.nextTemp();
  gen.emit(`${resolved} = select i1 ${isNeg}, i32 ${adjusted}, i32 ${fromIndex}`);
  const stillNeg = gen.emitIcmp("slt", "i32", resolved, "0");
  const clamped = gen.nextTemp();
  gen.emit(`${clamped} = select i1 ${stillNeg}, i32 0, i32 ${resolved}`);
  return clamped;
}

export function generateArrayIncludes(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length < 1 || expr.args.length > 2) {
    return gen.emitError("includes() requires 1 or 2 arguments", expr.loc);
  }

  const arrayPtr = gen.generateExpression(expr.object, params);
  const searchValue = gen.generateExpression(expr.args[0], params);

  let fromIndex: string | null = null;
  if (expr.args.length === 2) {
    const fromRaw = gen.generateExpression(expr.args[1], params);
    const fromDbl = gen.ensureDouble(fromRaw);
    const tmp = gen.nextTemp();
    gen.emit(`${tmp} = fptosi double ${fromDbl} to i32`);
    fromIndex = tmp;
  }

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
    return generateStringArrayIncludes(gen, arrayPtr, searchValue, fromIndex);
  } else {
    return generateIntArrayIncludes(gen, arrayPtr, searchValue, fromIndex);
  }
}

function generateIntArrayIncludes(
  gen: IGeneratorContext,
  arrayPtr: string,
  searchValue: string,
  fromIndex: string | null,
): string {
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const length = gen.emitLoad("i32", lenPtr);

  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load double*, double** ${dataPtrField}`);

  const startIndex = fromIndex ? resolveIncludesFromIndex(gen, fromIndex, length) : "0";

  const loopLabel = gen.nextLabel("includes_loop");
  const checkLabel = gen.nextLabel("includes_check");
  const bodyLabel = gen.nextLabel("includes_body");
  const foundLabel = gen.nextLabel("includes_found");
  const endLabel = gen.nextLabel("includes_end");

  const counterPtr = gen.nextTemp();
  gen.emit(`${counterPtr} = alloca i32`);
  gen.emitStore("i32", startIndex, counterPtr);

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
  fromIndex: string | null,
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

  const startIndex = fromIndex ? resolveIncludesFromIndex(gen, fromIndex, length) : "0";

  const loopLabel = gen.nextLabel("includes_loop");
  const checkLabel = gen.nextLabel("includes_check");
  const bodyLabel = gen.nextLabel("includes_body");
  const foundLabel = gen.nextLabel("includes_found");
  const endLabel = gen.nextLabel("includes_end");

  const counterPtr = gen.nextTemp();
  gen.emit(`${counterPtr} = alloca i32`);
  gen.emitStore("i32", startIndex, counterPtr);

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

  gen.emitLabel(endLabel);
  const resultI32 = gen.nextTemp();
  gen.emit(`${resultI32} = phi i32 [ 0, %${checkLabel} ], [ 1, %${foundLabel} ]`);
  const result = gen.nextTemp();
  gen.emit(`${result} = sitofp i32 ${resultI32} to double`);
  return result;
}
