// Array search operations: indexOf, findIndex.
// Uses structured IR builders where possible; raw emit() for inbounds GEP, intrinsics, etc.

import { MethodCallNode, VariableNode } from "../../../../ast/types.js";
import { IGeneratorContext } from "./context.js";

/** Build call args, prepending env pointer for inline lambdas with captures.
 *  Does NOT clear the env ptr — caller must clear after the loop completes. */
function buildSearchCallArgs(gen: IGeneratorContext, baseArgs: string): string {
  const envPtr = gen.getLastInlineLambdaEnvPtr();
  if (envPtr) {
    return `i8* ${envPtr}, ${baseArgs}`;
  }
  return baseArgs;
}

interface ExprBase {
  type: string;
}

export function generateArrayIndexOf(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length < 1 || expr.args.length > 2) {
    return gen.emitError("indexOf() requires 1 or 2 arguments", expr.loc);
  }

  const arrayPtr = gen.generateExpression(expr.object, params);
  const searchValue = gen.generateExpression(expr.args[0], params);

  // Optional fromIndex (2nd arg) — defaults to 0
  // Negative fromIndex is resolved as max(0, length + fromIndex) per JS spec
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
  }
  if (!isStringArray) {
    const ptrType = gen.getVariableType(arrayPtr);
    if (ptrType === "%StringArray*" || ptrType === "%StringArray") isStringArray = true;
  }

  if (isStringArray) {
    return generateStringArrayIndexOf(gen, arrayPtr, searchValue, fromIndex);
  }
  return generateNumericArrayIndexOf(gen, arrayPtr, searchValue, fromIndex);
}

function resolveFromIndex(gen: IGeneratorContext, fromIndex: string, length: string): string {
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

function generateNumericArrayIndexOf(
  gen: IGeneratorContext,
  arrayPtr: string,
  searchValue: string,
  fromIndex: string | null,
): string {
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const length = gen.nextTemp();
  gen.emit(`${length} = load i32, i32* ${lenPtr}`);

  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load double*, double** ${dataPtrField}`);

  const startIndex = fromIndex ? resolveFromIndex(gen, fromIndex, length) : null;

  const resultPtr = gen.nextTemp();
  gen.emit(`${resultPtr} = alloca i32`);
  gen.emitStore("i32", "-1", resultPtr);

  const loopPtr = gen.nextTemp();
  gen.emit(`${loopPtr} = alloca i32`);
  gen.emitStore("i32", startIndex ?? "0", loopPtr);

  const checkLabel = gen.nextLabel("indexof_check");
  const bodyLabel = gen.nextLabel("indexof_body");
  const foundLabel = gen.nextLabel("indexof_found");
  const nextLabel = gen.nextLabel("indexof_next");
  const endLabel = gen.nextLabel("indexof_end");

  gen.emitBr(checkLabel);

  gen.emitLabel(checkLabel);
  const i = gen.emitLoad("i32", loopPtr);
  const cond = gen.emitIcmp("slt", "i32", i, length);
  gen.emitBrCond(cond, bodyLabel, endLabel);

  gen.emitLabel(bodyLabel);
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${i}`);
  const elem = gen.emitLoad("double", elemPtr);

  const dblSearch = gen.ensureDouble(searchValue);
  const eq = gen.nextTemp();
  gen.emit(`${eq} = fcmp oeq double ${elem}, ${dblSearch}`);
  gen.emitBrCond(eq, foundLabel, nextLabel);

  gen.emitLabel(foundLabel);
  gen.emitStore("i32", i, resultPtr);
  gen.emitBr(endLabel);

  gen.emitLabel(nextLabel);
  const nextI = gen.nextTemp();
  gen.emit(`${nextI} = add i32 ${i}, 1`);
  gen.emitStore("i32", nextI, loopPtr);
  gen.emitBr(checkLabel);

  gen.emitLabel(endLabel);
  const resultI32 = gen.emitLoad("i32", resultPtr);
  const result = gen.nextTemp();
  gen.emit(`${result} = sitofp i32 ${resultI32} to double`);
  gen.setVariableType(result, "double");
  return result;
}

function generateStringArrayIndexOf(
  gen: IGeneratorContext,
  arrayPtr: string,
  searchValue: string,
  fromIndex: string | null,
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
  gen.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField}`);

  const startIndex = fromIndex ? resolveFromIndex(gen, fromIndex, length) : null;

  const resultPtr = gen.nextTemp();
  gen.emit(`${resultPtr} = alloca i32`);
  gen.emitStore("i32", "-1", resultPtr);

  const loopPtr = gen.nextTemp();
  gen.emit(`${loopPtr} = alloca i32`);
  gen.emitStore("i32", startIndex ?? "0", loopPtr);

  const checkLabel = gen.nextLabel("indexof_check");
  const bodyLabel = gen.nextLabel("indexof_body");
  const foundLabel = gen.nextLabel("indexof_found");
  const nextLabel = gen.nextLabel("indexof_next");
  const endLabel = gen.nextLabel("indexof_end");

  gen.emitBr(checkLabel);

  gen.emitLabel(checkLabel);
  const i = gen.emitLoad("i32", loopPtr);
  const cond = gen.emitIcmp("slt", "i32", i, length);
  gen.emitBrCond(cond, bodyLabel, endLabel);

  gen.emitLabel(bodyLabel);
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${i}`);
  const elem = gen.emitLoad("i8*", elemPtr);

  const cmpResult = gen.emitCall("i32", "@strcmp", `i8* ${elem}, i8* ${searchValue}`);
  const eq = gen.emitIcmp("eq", "i32", cmpResult, "0");
  gen.emitBrCond(eq, foundLabel, nextLabel);

  gen.emitLabel(foundLabel);
  gen.emitStore("i32", i, resultPtr);
  gen.emitBr(endLabel);

  gen.emitLabel(nextLabel);
  const nextI = gen.nextTemp();
  gen.emit(`${nextI} = add i32 ${i}, 1`);
  gen.emitStore("i32", nextI, loopPtr);
  gen.emitBr(checkLabel);

  gen.emitLabel(endLabel);
  const resultI32 = gen.emitLoad("i32", resultPtr);
  const result = gen.nextTemp();
  gen.emit(`${result} = sitofp i32 ${resultI32} to double`);
  gen.setVariableType(result, "double");
  return result;
}

export function generateArrayFindIndex(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length !== 1) {
    return gen.emitError("findIndex() requires exactly 1 argument (predicate function)", expr.loc);
  }

  const arrayPtr = gen.generateExpression(expr.object, params);

  let isStringArray = false;
  const exprObjBase = expr.object as ExprBase;
  if (exprObjBase.type === "variable") {
    const varName = (expr.object as VariableNode).name;
    const varType = gen.getVariableType(varName);
    isStringArray = varType === "%StringArray*" || varType === "%StringArray";
  }

  const predicateArg = expr.args[0];
  let predicateFn: string;
  if (predicateArg.type === "variable") {
    predicateFn = gen.mangleUserName((predicateArg as VariableNode).name);
  } else if (predicateArg.type === "arrow_function") {
    if (isStringArray) {
      gen.setExpectedCallbackParamType("string");
    }
    predicateFn = gen.generateExpression(predicateArg, params);
    gen.setExpectedCallbackParamType(null);
  } else {
    return gen.emitError(
      "findIndex() argument must be a function name or inline function",
      expr.loc,
    );
  }

  let result: string;
  if (isStringArray) {
    result = generateStringArrayFindIndex(gen, arrayPtr, predicateFn);
  } else {
    result = generateNumericArrayFindIndex(gen, arrayPtr, predicateFn);
  }
  gen.setLastInlineLambdaEnvPtr(null);
  return result;
}

function generateNumericArrayFindIndex(
  gen: IGeneratorContext,
  arrayPtr: string,
  predicateFn: string,
): string {
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const length = gen.nextTemp();
  gen.emit(`${length} = load i32, i32* ${lenPtr}`);

  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load double*, double** ${dataPtrField}`);

  const resultPtr = gen.nextTemp();
  gen.emit(`${resultPtr} = alloca i32`);
  gen.emitStore("i32", "-1", resultPtr);

  const loopPtr = gen.nextTemp();
  gen.emit(`${loopPtr} = alloca i32`);
  gen.emitStore("i32", "0", loopPtr);

  const checkLabel = gen.nextLabel("findidx_check");
  const bodyLabel = gen.nextLabel("findidx_body");
  const foundLabel = gen.nextLabel("findidx_found");
  const nextLabel = gen.nextLabel("findidx_next");
  const endLabel = gen.nextLabel("findidx_end");

  gen.emitBr(checkLabel);

  gen.emitLabel(checkLabel);
  const i = gen.emitLoad("i32", loopPtr);
  const cond = gen.emitIcmp("slt", "i32", i, length);
  gen.emitBrCond(cond, bodyLabel, endLabel);

  gen.emitLabel(bodyLabel);
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${i}`);
  const elem = gen.emitLoad("double", elemPtr);

  const predicateResult = gen.emitCall(
    "double",
    `@${predicateFn}`,
    buildSearchCallArgs(gen, `double ${elem}`),
  );
  const isTruthy = gen.nextTemp();
  gen.emit(`${isTruthy} = fcmp one double ${predicateResult}, 0.0`);
  gen.emitBrCond(isTruthy, foundLabel, nextLabel);

  gen.emitLabel(foundLabel);
  gen.emitStore("i32", i, resultPtr);
  gen.emitBr(endLabel);

  gen.emitLabel(nextLabel);
  const nextI = gen.nextTemp();
  gen.emit(`${nextI} = add i32 ${i}, 1`);
  gen.emitStore("i32", nextI, loopPtr);
  gen.emitBr(checkLabel);

  gen.emitLabel(endLabel);
  const resultI32 = gen.emitLoad("i32", resultPtr);
  const result = gen.nextTemp();
  gen.emit(`${result} = sitofp i32 ${resultI32} to double`);
  gen.setVariableType(result, "double");
  return result;
}

function generateStringArrayFindIndex(
  gen: IGeneratorContext,
  arrayPtr: string,
  predicateFn: string,
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
  gen.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField}`);

  const resultPtr = gen.nextTemp();
  gen.emit(`${resultPtr} = alloca i32`);
  gen.emitStore("i32", "-1", resultPtr);

  const loopPtr = gen.nextTemp();
  gen.emit(`${loopPtr} = alloca i32`);
  gen.emitStore("i32", "0", loopPtr);

  const checkLabel = gen.nextLabel("findidx_check");
  const bodyLabel = gen.nextLabel("findidx_body");
  const foundLabel = gen.nextLabel("findidx_found");
  const nextLabel = gen.nextLabel("findidx_next");
  const endLabel = gen.nextLabel("findidx_end");

  gen.emitBr(checkLabel);

  gen.emitLabel(checkLabel);
  const i = gen.emitLoad("i32", loopPtr);
  const cond = gen.emitIcmp("slt", "i32", i, length);
  gen.emitBrCond(cond, bodyLabel, endLabel);

  gen.emitLabel(bodyLabel);
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${i}`);
  const elem = gen.emitLoad("i8*", elemPtr);

  const predicateResult = gen.emitCall(
    "double",
    `@${predicateFn}`,
    buildSearchCallArgs(gen, `i8* ${elem}`),
  );
  const isTruthy = gen.nextTemp();
  gen.emit(`${isTruthy} = fcmp one double ${predicateResult}, 0.0`);
  gen.emitBrCond(isTruthy, foundLabel, nextLabel);

  gen.emitLabel(foundLabel);
  gen.emitStore("i32", i, resultPtr);
  gen.emitBr(endLabel);

  gen.emitLabel(nextLabel);
  const nextI = gen.nextTemp();
  gen.emit(`${nextI} = add i32 ${i}, 1`);
  gen.emitStore("i32", nextI, loopPtr);
  gen.emitBr(checkLabel);

  gen.emitLabel(endLabel);
  const resultI32 = gen.emitLoad("i32", resultPtr);
  const result = gen.nextTemp();
  gen.emit(`${result} = sitofp i32 ${resultI32} to double`);
  gen.setVariableType(result, "double");
  return result;
}

export function generateArrayAt(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length !== 1) {
    return gen.emitError("at() expects 1 argument, got " + expr.args.length, expr.loc);
  }

  const arrayPtr = gen.generateExpression(expr.object, params);
  const indexRaw = gen.generateExpression(expr.args[0], params);
  const indexDouble = gen.ensureDouble(indexRaw);

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
    if (ptrType === "%ObjectArray*" || ptrType === "%ObjectArray") isObjectArray = true;
  }

  if (isStringArray) return generateStringArrayAt(gen, arrayPtr, indexDouble);
  if (isObjectArray) return generateObjectArrayAt(gen, arrayPtr, indexDouble);
  return generateNumericArrayAt(gen, arrayPtr, indexDouble);
}

function resolveNegativeIndex(gen: IGeneratorContext, indexDouble: string, length: string): string {
  const indexI32 = gen.nextTemp();
  gen.emit(`${indexI32} = fptosi double ${indexDouble} to i32`);
  const isNeg = gen.emitIcmp("slt", "i32", indexI32, "0");
  const adjusted = gen.nextTemp();
  gen.emit(`${adjusted} = add i32 ${indexI32}, ${length}`);
  const resolved = gen.nextTemp();
  gen.emit(`${resolved} = select i1 ${isNeg}, i32 ${adjusted}, i32 ${indexI32}`);
  return resolved;
}

function generateNumericArrayAt(
  gen: IGeneratorContext,
  arrayPtr: string,
  indexDouble: string,
): string {
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const length = gen.emitLoad("i32", lenPtr);
  const resolved = resolveNegativeIndex(gen, indexDouble, length);

  const inLow = gen.emitIcmp("sge", "i32", resolved, "0");
  const inHigh = gen.emitIcmp("slt", "i32", resolved, length);
  const inBounds = gen.nextTemp();
  gen.emit(`${inBounds} = and i1 ${inLow}, ${inHigh}`);

  const validLabel = gen.nextLabel("at_valid");
  const oobLabel = gen.nextLabel("at_oob");
  const endLabel = gen.nextLabel("at_end");
  gen.emitBrCond(inBounds, validLabel, oobLabel);

  gen.emitLabel(validLabel);
  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.emitLoad("double*", dataPtrField);
  const indexI64 = gen.nextTemp();
  gen.emit(`${indexI64} = sext i32 ${resolved} to i64`);
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i64 ${indexI64}`);
  const validVal = gen.emitLoad("double", elemPtr);
  gen.emitBr(endLabel);

  gen.emitLabel(oobLabel);
  gen.emitBr(endLabel);

  gen.emitLabel(endLabel);
  const resultNum = gen.nextTemp();
  gen.emit(
    `${resultNum} = phi double [${validVal}, %${validLabel}], [0x7FF8000000000000, %${oobLabel}]`,
  );
  gen.setVariableType(resultNum, "double");
  return resultNum;
}

function generateStringArrayAt(
  gen: IGeneratorContext,
  arrayPtr: string,
  indexDouble: string,
): string {
  const lenPtr = gen.nextTemp();
  gen.emit(
    `${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`,
  );
  const length = gen.emitLoad("i32", lenPtr);
  const resolved = resolveNegativeIndex(gen, indexDouble, length);

  const inLow = gen.emitIcmp("sge", "i32", resolved, "0");
  const inHigh = gen.emitIcmp("slt", "i32", resolved, length);
  const inBounds = gen.nextTemp();
  gen.emit(`${inBounds} = and i1 ${inLow}, ${inHigh}`);

  const validLabel = gen.nextLabel("at_valid");
  const oobLabel = gen.nextLabel("at_oob");
  const endLabel = gen.nextLabel("at_end");
  gen.emitBrCond(inBounds, validLabel, oobLabel);

  gen.emitLabel(validLabel);
  const dataPtrField = gen.nextTemp();
  gen.emit(
    `${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
  );
  const dataPtr = gen.emitLoad("i8**", dataPtrField);
  const indexI64 = gen.nextTemp();
  gen.emit(`${indexI64} = sext i32 ${resolved} to i64`);
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i64 ${indexI64}`);
  const validVal = gen.emitLoad("i8*", elemPtr);
  gen.emitBr(endLabel);

  gen.emitLabel(oobLabel);
  const emptyStr = gen.emitCall("i8*", "@GC_malloc_atomic", "i64 1");
  gen.emitStore("i8", "0", emptyStr);
  gen.emitBr(endLabel);

  gen.emitLabel(endLabel);
  const resultStr = gen.nextTemp();
  gen.emit(`${resultStr} = phi i8* [${validVal}, %${validLabel}], [${emptyStr}, %${oobLabel}]`);
  return resultStr;
}

function generateObjectArrayAt(
  gen: IGeneratorContext,
  arrayPtr: string,
  indexDouble: string,
): string {
  const lenPtr = gen.nextTemp();
  gen.emit(
    `${lenPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 1`,
  );
  const length = gen.emitLoad("i32", lenPtr);
  const resolved = resolveNegativeIndex(gen, indexDouble, length);

  const inLow = gen.emitIcmp("sge", "i32", resolved, "0");
  const inHigh = gen.emitIcmp("slt", "i32", resolved, length);
  const inBounds = gen.nextTemp();
  gen.emit(`${inBounds} = and i1 ${inLow}, ${inHigh}`);

  const validLabel = gen.nextLabel("at_valid");
  const oobLabel = gen.nextLabel("at_oob");
  const endLabel = gen.nextLabel("at_end");
  gen.emitBrCond(inBounds, validLabel, oobLabel);

  gen.emitLabel(validLabel);
  const dataPtrField = gen.nextTemp();
  gen.emit(
    `${dataPtrField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`,
  );
  const rawDataPtr = gen.emitLoad("i8*", dataPtrField);
  const dataPtr = gen.emitBitcast(rawDataPtr, "i8*", "i8**");
  const indexI64 = gen.nextTemp();
  gen.emit(`${indexI64} = sext i32 ${resolved} to i64`);
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i64 ${indexI64}`);
  const validVal = gen.emitLoad("i8*", elemPtr);
  gen.emitBr(endLabel);

  gen.emitLabel(oobLabel);
  const nullPtr = gen.nextTemp();
  gen.emit(`${nullPtr} = inttoptr i64 0 to i8*`);
  gen.emitBr(endLabel);

  gen.emitLabel(endLabel);
  const resultObj = gen.nextTemp();
  gen.emit(`${resultObj} = phi i8* [${validVal}, %${validLabel}], [${nullPtr}, %${oobLabel}]`);
  return resultObj;
}
