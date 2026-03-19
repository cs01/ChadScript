// Array sort operations: default numeric/string sort, custom comparator sort
// generateArraySort accepts (gen, expr, params) and handles type detection + dispatch internally.

import { Expression, MethodCallNode, VariableNode } from "../../../../ast/types.js";
import { IGeneratorContext } from "./context.js";

interface ExprBase {
  type: string;
}

interface ArraySortContext {
  nextTemp(): string;
  nextLabel(prefix: string): string;
  emit(instruction: string): void;
  setVariableType(name: string, type: string): void;
  generateExpression(expr: Expression, params: string[]): string;
}

export function generateDefaultSortComparators(): string {
  let ir = "";

  ir += "define i32 @__cmp_double_asc(i8* %a, i8* %b) {\n";
  ir += "entry:\n";
  ir += "  %pa = bitcast i8* %a to double*\n";
  ir += "  %pb = bitcast i8* %b to double*\n";
  ir += "  %va = load double, double* %pa\n";
  ir += "  %vb = load double, double* %pb\n";
  ir += "  %lt = fcmp olt double %va, %vb\n";
  ir += "  br i1 %lt, label %ret_neg, label %check_gt\n";
  ir += "check_gt:\n";
  ir += "  %gt = fcmp ogt double %va, %vb\n";
  ir += "  br i1 %gt, label %ret_pos, label %ret_zero\n";
  ir += "ret_neg:\n";
  ir += "  ret i32 -1\n";
  ir += "ret_pos:\n";
  ir += "  ret i32 1\n";
  ir += "ret_zero:\n";
  ir += "  ret i32 0\n";
  ir += "}\n\n";

  ir += "define i32 @__cmp_string_asc(i8* %a, i8* %b) {\n";
  ir += "entry:\n";
  ir += "  %pa = bitcast i8* %a to i8**\n";
  ir += "  %pb = bitcast i8* %b to i8**\n";
  ir += "  %sa = load i8*, i8** %pa\n";
  ir += "  %sb = load i8*, i8** %pb\n";
  ir += "  %result = call i32 @strcmp(i8* %sa, i8* %sb)\n";
  ir += "  ret i32 %result\n";
  ir += "}\n\n";

  return ir;
}

export function generateArraySort(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length > 1) {
    return gen.emitError("sort() expects 0 or 1 arguments", expr.loc);
  }

  const arrayPtr = gen.generateExpression(expr.object, params);
  gen.setUsesArraySort(true);

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

  if (expr.args.length === 0) {
    if (isStringArray) {
      return generateDefaultStringSort(gen, arrayPtr);
    }
    return generateDefaultNumericSort(gen, arrayPtr);
  }

  let elementType = "";
  if (isObjectArray) {
    const exprObjBase2 = expr.object as ExprBase;
    if (exprObjBase2.type === "variable") {
      const varName = (expr.object as VariableNode).name;
      elementType = gen.symbolTable.getObjectArrayElementType(varName) || "";
    }
  }

  const predicateArg = expr.args[0];
  let compareFn: string;
  if (predicateArg.type === "variable") {
    compareFn = gen.mangleUserName((predicateArg as VariableNode).name);
  } else if (predicateArg.type === "arrow_function") {
    if (isStringArray) {
      gen.setExpectedCallbackParamTypes(["string", "string"]);
    } else if (isObjectArray) {
      gen.setExpectedCallbackParamTypes([elementType || "i8*", elementType || "i8*"]);
    }
    compareFn = gen.generateExpression(predicateArg, params);
    gen.setExpectedCallbackParamTypes(null);
  } else {
    return gen.emitError("sort() comparator must be a function name or inline function", expr.loc);
  }

  const sortEnvPtr = gen.getLastInlineLambdaEnvPtr();
  gen.setLastInlineLambdaEnvPtr(null);
  if (isStringArray) {
    return generateStringSortWithFn(gen, arrayPtr, compareFn, sortEnvPtr);
  }
  if (isObjectArray) {
    return generateObjectSortWithFn(gen, arrayPtr, compareFn, sortEnvPtr);
  }
  return generateNumericSortWithFn(gen, arrayPtr, compareFn, sortEnvPtr);
}

function generateDefaultNumericSort(gen: ArraySortContext, arrayPtr: string): string {
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const length = gen.nextTemp();
  gen.emit(`${length} = load i32, i32* ${lenPtr}`);

  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load double*, double** ${dataPtrField}`);

  const dataI8 = gen.nextTemp();
  gen.emit(`${dataI8} = bitcast double* ${dataPtr} to i8*`);
  const lenI64 = gen.nextTemp();
  gen.emit(`${lenI64} = zext i32 ${length} to i64`);

  gen.emit(
    `call void @qsort(i8* ${dataI8}, i64 ${lenI64}, i64 8, i32 (i8*, i8*)* @__cmp_double_asc)`,
  );

  gen.setVariableType(arrayPtr, "%Array*");
  return arrayPtr;
}

function generateDefaultStringSort(gen: ArraySortContext, arrayPtr: string): string {
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

  const dataI8 = gen.nextTemp();
  gen.emit(`${dataI8} = bitcast i8** ${dataPtr} to i8*`);
  const lenI64 = gen.nextTemp();
  gen.emit(`${lenI64} = zext i32 ${length} to i64`);

  gen.emit(
    `call void @qsort(i8* ${dataI8}, i64 ${lenI64}, i64 8, i32 (i8*, i8*)* @__cmp_string_asc)`,
  );
  gen.emit("call void @cs_str_cache_invalidate()");

  gen.setVariableType(arrayPtr, "%StringArray*");
  return arrayPtr;
}

function generateNumericSortWithFn(
  gen: ArraySortContext,
  arrayPtr: string,
  compareFn: string,
  envPtr?: string | null,
): string {
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const length = gen.nextTemp();
  gen.emit(`${length} = load i32, i32* ${lenPtr}`);

  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load double*, double** ${dataPtrField}`);

  const checkLabel = gen.nextLabel("sort_check");
  const outerBody = gen.nextLabel("sort_outer");
  const innerCheck = gen.nextLabel("sort_inner_check");
  const innerBody = gen.nextLabel("sort_inner_body");
  const swapLabel = gen.nextLabel("sort_swap");
  const noSwapLabel = gen.nextLabel("sort_noswap");
  const innerNext = gen.nextLabel("sort_inner_next");
  const outerNext = gen.nextLabel("sort_outer_next");
  const endLabel = gen.nextLabel("sort_end");

  const iPtr = gen.nextTemp();
  gen.emit(`${iPtr} = alloca i32`);
  gen.emit(`store i32 0, i32* ${iPtr}`);

  const jPtr = gen.nextTemp();
  gen.emit(`${jPtr} = alloca i32`);

  const lenMinus1 = gen.nextTemp();
  gen.emit(`${lenMinus1} = sub i32 ${length}, 1`);

  gen.emit(`br label %${checkLabel}`);

  gen.emit(`${checkLabel}:`);
  const i = gen.nextTemp();
  gen.emit(`${i} = load i32, i32* ${iPtr}`);
  const outerCond = gen.nextTemp();
  gen.emit(`${outerCond} = icmp slt i32 ${i}, ${lenMinus1}`);
  gen.emit(`br i1 ${outerCond}, label %${outerBody}, label %${endLabel}`);

  gen.emit(`${outerBody}:`);
  gen.emit(`store i32 0, i32* ${jPtr}`);

  const remaining = gen.nextTemp();
  gen.emit(`${remaining} = sub i32 ${lenMinus1}, ${i}`);

  gen.emit(`br label %${innerCheck}`);

  gen.emit(`${innerCheck}:`);
  const j = gen.nextTemp();
  gen.emit(`${j} = load i32, i32* ${jPtr}`);
  const innerCond = gen.nextTemp();
  gen.emit(`${innerCond} = icmp slt i32 ${j}, ${remaining}`);
  gen.emit(`br i1 ${innerCond}, label %${innerBody}, label %${outerNext}`);

  gen.emit(`${innerBody}:`);
  const ptrA = gen.nextTemp();
  gen.emit(`${ptrA} = getelementptr inbounds double, double* ${dataPtr}, i32 ${j}`);
  const valA = gen.nextTemp();
  gen.emit(`${valA} = load double, double* ${ptrA}`);

  const jPlus1 = gen.nextTemp();
  gen.emit(`${jPlus1} = add i32 ${j}, 1`);
  const ptrB = gen.nextTemp();
  gen.emit(`${ptrB} = getelementptr inbounds double, double* ${dataPtr}, i32 ${jPlus1}`);
  const valB = gen.nextTemp();
  gen.emit(`${valB} = load double, double* ${ptrB}`);

  const cmpResult = gen.nextTemp();
  const cmpArgs = envPtr
    ? `i8* ${envPtr}, double ${valA}, double ${valB}`
    : `double ${valA}, double ${valB}`;
  gen.emit(`${cmpResult} = call double @${compareFn}(${cmpArgs})`);
  const shouldSwap = gen.nextTemp();
  gen.emit(`${shouldSwap} = fcmp ogt double ${cmpResult}, 0.0`);
  gen.emit(`br i1 ${shouldSwap}, label %${swapLabel}, label %${noSwapLabel}`);

  gen.emit(`${swapLabel}:`);
  gen.emit(`store double ${valB}, double* ${ptrA}`);
  gen.emit(`store double ${valA}, double* ${ptrB}`);
  gen.emit(`br label %${innerNext}`);

  gen.emit(`${noSwapLabel}:`);
  gen.emit(`br label %${innerNext}`);

  gen.emit(`${innerNext}:`);
  const nextJ = gen.nextTemp();
  gen.emit(`${nextJ} = add i32 ${j}, 1`);
  gen.emit(`store i32 ${nextJ}, i32* ${jPtr}`);
  gen.emit(`br label %${innerCheck}`);

  gen.emit(`${outerNext}:`);
  const nextI = gen.nextTemp();
  gen.emit(`${nextI} = add i32 ${i}, 1`);
  gen.emit(`store i32 ${nextI}, i32* ${iPtr}`);
  gen.emit(`br label %${checkLabel}`);

  gen.emit(`${endLabel}:`);

  gen.setVariableType(arrayPtr, "%Array*");
  return arrayPtr;
}

function generateStringSortWithFn(
  gen: ArraySortContext,
  arrayPtr: string,
  compareFn: string,
  envPtr?: string | null,
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

  const checkLabel = gen.nextLabel("sort_check");
  const outerBody = gen.nextLabel("sort_outer");
  const innerCheck = gen.nextLabel("sort_inner_check");
  const innerBody = gen.nextLabel("sort_inner_body");
  const swapLabel = gen.nextLabel("sort_swap");
  const noSwapLabel = gen.nextLabel("sort_noswap");
  const innerNext = gen.nextLabel("sort_inner_next");
  const outerNext = gen.nextLabel("sort_outer_next");
  const endLabel = gen.nextLabel("sort_end");

  const iPtr = gen.nextTemp();
  gen.emit(`${iPtr} = alloca i32`);
  gen.emit(`store i32 0, i32* ${iPtr}`);

  const jPtr = gen.nextTemp();
  gen.emit(`${jPtr} = alloca i32`);

  const lenMinus1 = gen.nextTemp();
  gen.emit(`${lenMinus1} = sub i32 ${length}, 1`);

  gen.emit(`br label %${checkLabel}`);

  gen.emit(`${checkLabel}:`);
  const i = gen.nextTemp();
  gen.emit(`${i} = load i32, i32* ${iPtr}`);
  const outerCond = gen.nextTemp();
  gen.emit(`${outerCond} = icmp slt i32 ${i}, ${lenMinus1}`);
  gen.emit(`br i1 ${outerCond}, label %${outerBody}, label %${endLabel}`);

  gen.emit(`${outerBody}:`);
  gen.emit(`store i32 0, i32* ${jPtr}`);

  const remaining = gen.nextTemp();
  gen.emit(`${remaining} = sub i32 ${lenMinus1}, ${i}`);

  gen.emit(`br label %${innerCheck}`);

  gen.emit(`${innerCheck}:`);
  const j = gen.nextTemp();
  gen.emit(`${j} = load i32, i32* ${jPtr}`);
  const innerCond = gen.nextTemp();
  gen.emit(`${innerCond} = icmp slt i32 ${j}, ${remaining}`);
  gen.emit(`br i1 ${innerCond}, label %${innerBody}, label %${outerNext}`);

  gen.emit(`${innerBody}:`);
  const ptrA = gen.nextTemp();
  gen.emit(`${ptrA} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${j}`);
  const valA = gen.nextTemp();
  gen.emit(`${valA} = load i8*, i8** ${ptrA}`);

  const jPlus1 = gen.nextTemp();
  gen.emit(`${jPlus1} = add i32 ${j}, 1`);
  const ptrB = gen.nextTemp();
  gen.emit(`${ptrB} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${jPlus1}`);
  const valB = gen.nextTemp();
  gen.emit(`${valB} = load i8*, i8** ${ptrB}`);

  const cmpResult = gen.nextTemp();
  const cmpArgs = envPtr ? `i8* ${envPtr}, i8* ${valA}, i8* ${valB}` : `i8* ${valA}, i8* ${valB}`;
  gen.emit(`${cmpResult} = call double @${compareFn}(${cmpArgs})`);
  const shouldSwap = gen.nextTemp();
  gen.emit(`${shouldSwap} = fcmp ogt double ${cmpResult}, 0.0`);
  gen.emit(`br i1 ${shouldSwap}, label %${swapLabel}, label %${noSwapLabel}`);

  gen.emit(`${swapLabel}:`);
  gen.emit(`store i8* ${valB}, i8** ${ptrA}`);
  gen.emit(`store i8* ${valA}, i8** ${ptrB}`);
  gen.emit(`br label %${innerNext}`);

  gen.emit(`${noSwapLabel}:`);
  gen.emit(`br label %${innerNext}`);

  gen.emit(`${innerNext}:`);
  const nextJ = gen.nextTemp();
  gen.emit(`${nextJ} = add i32 ${j}, 1`);
  gen.emit(`store i32 ${nextJ}, i32* ${jPtr}`);
  gen.emit(`br label %${innerCheck}`);

  gen.emit(`${outerNext}:`);
  const nextI = gen.nextTemp();
  gen.emit(`${nextI} = add i32 ${i}, 1`);
  gen.emit(`store i32 ${nextI}, i32* ${iPtr}`);
  gen.emit(`br label %${checkLabel}`);

  gen.emit(`${endLabel}:`);

  gen.setVariableType(arrayPtr, "%StringArray*");
  return arrayPtr;
}

function generateObjectSortWithFn(
  gen: ArraySortContext,
  arrayPtr: string,
  compareFn: string,
  envPtr?: string | null,
): string {
  const lenPtr = gen.nextTemp();
  gen.emit(
    `${lenPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 1`,
  );
  const length = gen.nextTemp();
  gen.emit(`${length} = load i32, i32* ${lenPtr}`);

  const dataPtrField = gen.nextTemp();
  gen.emit(
    `${dataPtrField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`,
  );
  const rawDataPtr = gen.nextTemp();
  gen.emit(`${rawDataPtr} = load i8*, i8** ${dataPtrField}`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = bitcast i8* ${rawDataPtr} to i8**`);

  const checkLabel = gen.nextLabel("sort_check");
  const outerBody = gen.nextLabel("sort_outer");
  const innerCheck = gen.nextLabel("sort_inner_check");
  const innerBody = gen.nextLabel("sort_inner_body");
  const swapLabel = gen.nextLabel("sort_swap");
  const noSwapLabel = gen.nextLabel("sort_noswap");
  const innerNext = gen.nextLabel("sort_inner_next");
  const outerNext = gen.nextLabel("sort_outer_next");
  const endLabel = gen.nextLabel("sort_end");

  const iAlloc = gen.nextTemp();
  gen.emit(`${iAlloc} = alloca i32`);
  gen.emit(`store i32 0, i32* ${iAlloc}`);

  const jAlloc = gen.nextTemp();
  gen.emit(`${jAlloc} = alloca i32`);

  const lenMinus1 = gen.nextTemp();
  gen.emit(`${lenMinus1} = sub i32 ${length}, 1`);

  gen.emit(`br label %${checkLabel}`);

  gen.emit(`${checkLabel}:`);
  const i = gen.nextTemp();
  gen.emit(`${i} = load i32, i32* ${iAlloc}`);
  const outerCond = gen.nextTemp();
  gen.emit(`${outerCond} = icmp slt i32 ${i}, ${lenMinus1}`);
  gen.emit(`br i1 ${outerCond}, label %${outerBody}, label %${endLabel}`);

  gen.emit(`${outerBody}:`);
  gen.emit(`store i32 0, i32* ${jAlloc}`);
  const remaining = gen.nextTemp();
  gen.emit(`${remaining} = sub i32 ${lenMinus1}, ${i}`);
  gen.emit(`br label %${innerCheck}`);

  gen.emit(`${innerCheck}:`);
  const j = gen.nextTemp();
  gen.emit(`${j} = load i32, i32* ${jAlloc}`);
  const innerCond = gen.nextTemp();
  gen.emit(`${innerCond} = icmp slt i32 ${j}, ${remaining}`);
  gen.emit(`br i1 ${innerCond}, label %${innerBody}, label %${outerNext}`);

  gen.emit(`${innerBody}:`);
  const ptrA = gen.nextTemp();
  gen.emit(`${ptrA} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${j}`);
  const valA = gen.nextTemp();
  gen.emit(`${valA} = load i8*, i8** ${ptrA}`);

  const jPlus1 = gen.nextTemp();
  gen.emit(`${jPlus1} = add i32 ${j}, 1`);
  const ptrB = gen.nextTemp();
  gen.emit(`${ptrB} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${jPlus1}`);
  const valB = gen.nextTemp();
  gen.emit(`${valB} = load i8*, i8** ${ptrB}`);

  const cmpResult = gen.nextTemp();
  const cmpArgs = envPtr ? `i8* ${envPtr}, i8* ${valA}, i8* ${valB}` : `i8* ${valA}, i8* ${valB}`;
  gen.emit(`${cmpResult} = call double @${compareFn}(${cmpArgs})`);
  const shouldSwap = gen.nextTemp();
  gen.emit(`${shouldSwap} = fcmp ogt double ${cmpResult}, 0.0`);
  gen.emit(`br i1 ${shouldSwap}, label %${swapLabel}, label %${noSwapLabel}`);

  gen.emit(`${swapLabel}:`);
  gen.emit(`store i8* ${valB}, i8** ${ptrA}`);
  gen.emit(`store i8* ${valA}, i8** ${ptrB}`);
  gen.emit(`br label %${innerNext}`);

  gen.emit(`${noSwapLabel}:`);
  gen.emit(`br label %${innerNext}`);

  gen.emit(`${innerNext}:`);
  const nextJ = gen.nextTemp();
  gen.emit(`${nextJ} = add i32 ${j}, 1`);
  gen.emit(`store i32 ${nextJ}, i32* ${jAlloc}`);
  gen.emit(`br label %${innerCheck}`);

  gen.emit(`${outerNext}:`);
  const nextI = gen.nextTemp();
  gen.emit(`${nextI} = add i32 ${i}, 1`);
  gen.emit(`store i32 ${nextI}, i32* ${iAlloc}`);
  gen.emit(`br label %${checkLabel}`);

  gen.emit(`${endLabel}:`);

  gen.setVariableType(arrayPtr, "%ObjectArray*");
  return arrayPtr;
}
