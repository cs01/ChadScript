import { Expression } from "../../../../ast/types.js";

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

export function generateDefaultNumericSort(gen: ArraySortContext, arrayPtr: string): string {
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const length = gen.nextTemp();
  gen.emit(`${length} = load i32, i32* ${lenPtr}`);

  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load double*, double** ${dataPtrField}, !tbaa !5`);

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

export function generateDefaultStringSort(gen: ArraySortContext, arrayPtr: string): string {
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

  const dataI8 = gen.nextTemp();
  gen.emit(`${dataI8} = bitcast i8** ${dataPtr} to i8*`);
  const lenI64 = gen.nextTemp();
  gen.emit(`${lenI64} = zext i32 ${length} to i64`);

  gen.emit(
    `call void @qsort(i8* ${dataI8}, i64 ${lenI64}, i64 8, i32 (i8*, i8*)* @__cmp_string_asc)`,
  );

  gen.setVariableType(arrayPtr, "%StringArray*");
  return arrayPtr;
}

export function generateNumericSortWithFn(
  gen: ArraySortContext,
  arrayPtr: string,
  compareFn: string,
): string {
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const length = gen.nextTemp();
  gen.emit(`${length} = load i32, i32* ${lenPtr}`);

  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load double*, double** ${dataPtrField}, !tbaa !5`);

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
  const jPtr = gen.nextTemp();
  gen.emit(`${jPtr} = alloca i32`);
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
  gen.emit(`${cmpResult} = call double @${compareFn}(double ${valA}, double ${valB})`);
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
