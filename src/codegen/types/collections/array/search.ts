// NOTE: This file uses raw ctx.emit() extensively. Prefer structured IR builders
// (emitStore, emitLoad, emitCall, etc.) when modifying — see .claude/rules.md.

import { Expression, MethodCallNode, VariableNode } from "../../../../ast/types.js";

interface ExprBase {
  type: string;
}

interface ArraySearchContext {
  nextTemp(): string;
  nextLabel(prefix: string): string;
  emit(instruction: string): void;
  getVariableType(name: string): string | undefined;
  setVariableType(name: string, type: string): void;
  generateExpression(expr: Expression, params: string[]): string;
  ensureDouble(value: string): string;
}

export function generateArrayIndexOf(
  gen: ArraySearchContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length !== 1) {
    throw new Error("indexOf() requires exactly 1 argument");
  }

  const arrayPtr = gen.generateExpression(expr.object, params);
  const searchValue = gen.generateExpression(expr.args[0], params);

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
    return generateStringArrayIndexOf(gen, arrayPtr, searchValue);
  }
  return generateNumericArrayIndexOf(gen, arrayPtr, searchValue);
}

function generateNumericArrayIndexOf(
  gen: ArraySearchContext,
  arrayPtr: string,
  searchValue: string,
): string {
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const length = gen.nextTemp();
  gen.emit(`${length} = load i32, i32* ${lenPtr}`);

  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load double*, double** ${dataPtrField}, !tbaa !5`);

  const resultPtr = gen.nextTemp();
  gen.emit(`${resultPtr} = alloca i32`);
  gen.emit(`store i32 -1, i32* ${resultPtr}`);

  const loopPtr = gen.nextTemp();
  gen.emit(`${loopPtr} = alloca i32`);
  gen.emit(`store i32 0, i32* ${loopPtr}`);

  const checkLabel = gen.nextLabel("indexof_check");
  const bodyLabel = gen.nextLabel("indexof_body");
  const foundLabel = gen.nextLabel("indexof_found");
  const nextLabel = gen.nextLabel("indexof_next");
  const endLabel = gen.nextLabel("indexof_end");

  gen.emit(`br label %${checkLabel}`);

  gen.emit(`${checkLabel}:`);
  const i = gen.nextTemp();
  gen.emit(`${i} = load i32, i32* ${loopPtr}`);
  const cond = gen.nextTemp();
  gen.emit(`${cond} = icmp slt i32 ${i}, ${length}`);
  gen.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

  gen.emit(`${bodyLabel}:`);
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${i}`);
  const elem = gen.nextTemp();
  gen.emit(`${elem} = load double, double* ${elemPtr}`);

  const dblSearch = gen.ensureDouble(searchValue);
  const eq = gen.nextTemp();
  gen.emit(`${eq} = fcmp oeq double ${elem}, ${dblSearch}`);
  gen.emit(`br i1 ${eq}, label %${foundLabel}, label %${nextLabel}`);

  gen.emit(`${foundLabel}:`);
  gen.emit(`store i32 ${i}, i32* ${resultPtr}`);
  gen.emit(`br label %${endLabel}`);

  gen.emit(`${nextLabel}:`);
  const nextI = gen.nextTemp();
  gen.emit(`${nextI} = add i32 ${i}, 1`);
  gen.emit(`store i32 ${nextI}, i32* ${loopPtr}`);
  gen.emit(`br label %${checkLabel}`);

  gen.emit(`${endLabel}:`);
  const resultI32 = gen.nextTemp();
  gen.emit(`${resultI32} = load i32, i32* ${resultPtr}`);
  const result = gen.nextTemp();
  gen.emit(`${result} = sitofp i32 ${resultI32} to double`);
  return result;
}

function generateStringArrayIndexOf(
  gen: ArraySearchContext,
  arrayPtr: string,
  searchValue: string,
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

  const resultPtr = gen.nextTemp();
  gen.emit(`${resultPtr} = alloca i32`);
  gen.emit(`store i32 -1, i32* ${resultPtr}`);

  const loopPtr = gen.nextTemp();
  gen.emit(`${loopPtr} = alloca i32`);
  gen.emit(`store i32 0, i32* ${loopPtr}`);

  const checkLabel = gen.nextLabel("indexof_check");
  const bodyLabel = gen.nextLabel("indexof_body");
  const foundLabel = gen.nextLabel("indexof_found");
  const nextLabel = gen.nextLabel("indexof_next");
  const endLabel = gen.nextLabel("indexof_end");

  gen.emit(`br label %${checkLabel}`);

  gen.emit(`${checkLabel}:`);
  const i = gen.nextTemp();
  gen.emit(`${i} = load i32, i32* ${loopPtr}`);
  const cond = gen.nextTemp();
  gen.emit(`${cond} = icmp slt i32 ${i}, ${length}`);
  gen.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

  gen.emit(`${bodyLabel}:`);
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${i}`);
  const elem = gen.nextTemp();
  gen.emit(`${elem} = load i8*, i8** ${elemPtr}`);

  const cmpResult = gen.nextTemp();
  gen.emit(`${cmpResult} = call i32 @strcmp(i8* ${elem}, i8* ${searchValue})`);
  const eq = gen.nextTemp();
  gen.emit(`${eq} = icmp eq i32 ${cmpResult}, 0`);
  gen.emit(`br i1 ${eq}, label %${foundLabel}, label %${nextLabel}`);

  gen.emit(`${foundLabel}:`);
  gen.emit(`store i32 ${i}, i32* ${resultPtr}`);
  gen.emit(`br label %${endLabel}`);

  gen.emit(`${nextLabel}:`);
  const nextI = gen.nextTemp();
  gen.emit(`${nextI} = add i32 ${i}, 1`);
  gen.emit(`store i32 ${nextI}, i32* ${loopPtr}`);
  gen.emit(`br label %${checkLabel}`);

  gen.emit(`${endLabel}:`);
  const resultI32 = gen.nextTemp();
  gen.emit(`${resultI32} = load i32, i32* ${resultPtr}`);
  const result = gen.nextTemp();
  gen.emit(`${result} = sitofp i32 ${resultI32} to double`);
  return result;
}

export function generateArrayFindIndex(
  gen: ArraySearchContext,
  expr: MethodCallNode,
  params: string[],
  predicateFn: string,
  isStringArray: boolean,
): string {
  const arrayPtr = gen.generateExpression(expr.object, params);

  if (isStringArray) {
    return generateStringArrayFindIndex(gen, arrayPtr, predicateFn);
  }
  return generateNumericArrayFindIndex(gen, arrayPtr, predicateFn);
}

function generateNumericArrayFindIndex(
  gen: ArraySearchContext,
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
  gen.emit(`${dataPtr} = load double*, double** ${dataPtrField}, !tbaa !5`);

  const resultPtr = gen.nextTemp();
  gen.emit(`${resultPtr} = alloca i32`);
  gen.emit(`store i32 -1, i32* ${resultPtr}`);

  const loopPtr = gen.nextTemp();
  gen.emit(`${loopPtr} = alloca i32`);
  gen.emit(`store i32 0, i32* ${loopPtr}`);

  const checkLabel = gen.nextLabel("findidx_check");
  const bodyLabel = gen.nextLabel("findidx_body");
  const foundLabel = gen.nextLabel("findidx_found");
  const nextLabel = gen.nextLabel("findidx_next");
  const endLabel = gen.nextLabel("findidx_end");

  gen.emit(`br label %${checkLabel}`);

  gen.emit(`${checkLabel}:`);
  const i = gen.nextTemp();
  gen.emit(`${i} = load i32, i32* ${loopPtr}`);
  const cond = gen.nextTemp();
  gen.emit(`${cond} = icmp slt i32 ${i}, ${length}`);
  gen.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

  gen.emit(`${bodyLabel}:`);
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${i}`);
  const elem = gen.nextTemp();
  gen.emit(`${elem} = load double, double* ${elemPtr}`);

  const predicateResult = gen.nextTemp();
  gen.emit(`${predicateResult} = call double @${predicateFn}(double ${elem})`);
  const isTruthy = gen.nextTemp();
  gen.emit(`${isTruthy} = fcmp one double ${predicateResult}, 0.0`);
  gen.emit(`br i1 ${isTruthy}, label %${foundLabel}, label %${nextLabel}`);

  gen.emit(`${foundLabel}:`);
  gen.emit(`store i32 ${i}, i32* ${resultPtr}`);
  gen.emit(`br label %${endLabel}`);

  gen.emit(`${nextLabel}:`);
  const nextI = gen.nextTemp();
  gen.emit(`${nextI} = add i32 ${i}, 1`);
  gen.emit(`store i32 ${nextI}, i32* ${loopPtr}`);
  gen.emit(`br label %${checkLabel}`);

  gen.emit(`${endLabel}:`);
  const resultI32 = gen.nextTemp();
  gen.emit(`${resultI32} = load i32, i32* ${resultPtr}`);
  const result = gen.nextTemp();
  gen.emit(`${result} = sitofp i32 ${resultI32} to double`);
  return result;
}

function generateStringArrayFindIndex(
  gen: ArraySearchContext,
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
  gen.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField}, !tbaa !5`);

  const resultPtr = gen.nextTemp();
  gen.emit(`${resultPtr} = alloca i32`);
  gen.emit(`store i32 -1, i32* ${resultPtr}`);

  const loopPtr = gen.nextTemp();
  gen.emit(`${loopPtr} = alloca i32`);
  gen.emit(`store i32 0, i32* ${loopPtr}`);

  const checkLabel = gen.nextLabel("findidx_check");
  const bodyLabel = gen.nextLabel("findidx_body");
  const foundLabel = gen.nextLabel("findidx_found");
  const nextLabel = gen.nextLabel("findidx_next");
  const endLabel = gen.nextLabel("findidx_end");

  gen.emit(`br label %${checkLabel}`);

  gen.emit(`${checkLabel}:`);
  const i = gen.nextTemp();
  gen.emit(`${i} = load i32, i32* ${loopPtr}`);
  const cond = gen.nextTemp();
  gen.emit(`${cond} = icmp slt i32 ${i}, ${length}`);
  gen.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

  gen.emit(`${bodyLabel}:`);
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${i}`);
  const elem = gen.nextTemp();
  gen.emit(`${elem} = load i8*, i8** ${elemPtr}`);

  const predicateResult = gen.nextTemp();
  gen.emit(`${predicateResult} = call double @${predicateFn}(i8* ${elem})`);
  const isTruthy = gen.nextTemp();
  gen.emit(`${isTruthy} = fcmp one double ${predicateResult}, 0.0`);
  gen.emit(`br i1 ${isTruthy}, label %${foundLabel}, label %${nextLabel}`);

  gen.emit(`${foundLabel}:`);
  gen.emit(`store i32 ${i}, i32* ${resultPtr}`);
  gen.emit(`br label %${endLabel}`);

  gen.emit(`${nextLabel}:`);
  const nextI = gen.nextTemp();
  gen.emit(`${nextI} = add i32 ${i}, 1`);
  gen.emit(`store i32 ${nextI}, i32* ${loopPtr}`);
  gen.emit(`br label %${checkLabel}`);

  gen.emit(`${endLabel}:`);
  const resultI32 = gen.nextTemp();
  gen.emit(`${resultI32} = load i32, i32* ${resultPtr}`);
  const result = gen.nextTemp();
  gen.emit(`${result} = sitofp i32 ${resultI32} to double`);
  return result;
}
