import { Expression, MethodCallNode } from "../../../ast/types.js";
import type { MethodCallGeneratorContext } from "../method-calls.js";

function emitPrint(
  ctx: MethodCallGeneratorContext,
  useStderr: boolean,
  fmtRef: string,
  args: string,
): void {
  if (useStderr) {
    const stderrPtr = ctx.nextTemp();
    ctx.emit(`${stderrPtr} = load i8*, i8** @stderr`);
    const temp = ctx.nextTemp();
    ctx.emit(`${temp} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, ${fmtRef}${args})`);
    const flushTemp = ctx.nextTemp();
    ctx.emit(`${flushTemp} = call i32 @fflush(i8* ${stderrPtr})`);
  } else {
    const temp = ctx.nextTemp();
    ctx.emit(`${temp} = call i32 (i8*, ...) @printf(${fmtRef}${args})`);
  }
}

function emitPrintStrNoNl(
  ctx: MethodCallGeneratorContext,
  useStderr: boolean,
  value: string,
): void {
  emitPrint(
    ctx,
    useStderr,
    `i8* getelementptr([3 x i8], [3 x i8]* @.str.strfmt_no_nl, i32 0, i32 0)`,
    `, i8* ${value}`,
  );
}

function emitPrintNumNoNl(
  ctx: MethodCallGeneratorContext,
  useStderr: boolean,
  value: string,
): void {
  const dbl = ctx.ensureDouble(value);
  emitPrint(
    ctx,
    useStderr,
    `i8* getelementptr([6 x i8], [6 x i8]* @.str.numfmt_no_nl, i32 0, i32 0)`,
    `, double ${dbl}`,
  );
}

function emitPrintSpace(ctx: MethodCallGeneratorContext, useStderr: boolean): void {
  const spaceRef = `i8* getelementptr([2 x i8], [2 x i8]* @.str.space, i32 0, i32 0)`;
  emitPrint(ctx, useStderr, spaceRef, "");
}

function emitPrintNewline(ctx: MethodCallGeneratorContext, useStderr: boolean): void {
  const nlRef = `i8* getelementptr([2 x i8], [2 x i8]* @.str.newline, i32 0, i32 0)`;
  emitPrint(ctx, useStderr, nlRef, "");
}

function emitArrayPrint(
  ctx: MethodCallGeneratorContext,
  useStderr: boolean,
  arrayPtr: string,
  arrayType: "Array" | "StringArray" | "ObjectArray",
): void {
  const lenPtr = ctx.nextTemp();
  ctx.emit(
    `${lenPtr} = getelementptr inbounds %${arrayType}, %${arrayType}* ${arrayPtr}, i32 0, i32 1`,
  );
  const len = ctx.nextTemp();
  ctx.emit(`${len} = load i32, i32* ${lenPtr}`);

  const openBracket = ctx.stringGen.doCreateStringConstant("[ ");
  const closeBracket = ctx.stringGen.doCreateStringConstant(" ]");
  const separator = ctx.stringGen.doCreateStringConstant(", ");
  const emptyArray = ctx.stringGen.doCreateStringConstant("[]");

  const isEmpty = ctx.nextTemp();
  ctx.emit(`${isEmpty} = icmp eq i32 ${len}, 0`);

  const emptyLabel = ctx.nextLabel("arr_empty");
  const nonEmptyLabel = ctx.nextLabel("arr_nonempty");
  const loopLabel = ctx.nextLabel("arr_loop");
  const loopBodyLabel = ctx.nextLabel("arr_body");
  const sepLabel = ctx.nextLabel("arr_sep");
  const loopLatchLabel = ctx.nextLabel("arr_latch");
  const endLabel = ctx.nextLabel("arr_end");
  const doneLabel = ctx.nextLabel("arr_done");

  ctx.emit(`br i1 ${isEmpty}, label %${emptyLabel}, label %${nonEmptyLabel}`);

  ctx.emit(`${emptyLabel}:`);
  emitPrintStrNoNl(ctx, useStderr, emptyArray);
  ctx.emit(`br label %${doneLabel}`);

  ctx.emit(`${nonEmptyLabel}:`);
  let dataPtr: string;
  if (arrayType === "Array") {
    const dataPtrField = ctx.nextTemp();
    ctx.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    dataPtr = ctx.nextTemp();
    ctx.emit(`${dataPtr} = load double*, double** ${dataPtrField}`);
  } else if (arrayType === "StringArray") {
    const dataPtrField = ctx.nextTemp();
    ctx.emit(
      `${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
    );
    dataPtr = ctx.nextTemp();
    ctx.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField}`);
  } else {
    const dataPtrField = ctx.nextTemp();
    ctx.emit(
      `${dataPtrField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`,
    );
    const rawData = ctx.nextTemp();
    ctx.emit(`${rawData} = load i8*, i8** ${dataPtrField}`);
    dataPtr = ctx.nextTemp();
    ctx.emit(`${dataPtr} = bitcast i8* ${rawData} to i8**`);
  }
  emitPrintStrNoNl(ctx, useStderr, openBracket);
  const iAlloca = ctx.nextTemp();
  ctx.emit(`${iAlloca} = alloca i32`);
  ctx.emit(`store i32 0, i32* ${iAlloca}`);
  ctx.emit(`br label %${loopLabel}`);

  ctx.emit(`${loopLabel}:`);
  const i = ctx.nextTemp();
  ctx.emit(`${i} = load i32, i32* ${iAlloca}`);
  const isFirst = ctx.nextTemp();
  ctx.emit(`${isFirst} = icmp eq i32 ${i}, 0`);
  ctx.emit(`br i1 ${isFirst}, label %${loopBodyLabel}, label %${sepLabel}`);

  ctx.emit(`${sepLabel}:`);
  emitPrintStrNoNl(ctx, useStderr, separator);
  ctx.emit(`br label %${loopBodyLabel}`);

  ctx.emit(`${loopBodyLabel}:`);
  if (arrayType === "Array") {
    const elemPtr = ctx.nextTemp();
    ctx.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${i}`);
    const elem = ctx.nextTemp();
    ctx.emit(`${elem} = load double, double* ${elemPtr}`);
    emitPrintNumNoNl(ctx, useStderr, elem);
  } else if (arrayType === "StringArray") {
    const elemPtr = ctx.nextTemp();
    ctx.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${i}`);
    const elem = ctx.nextTemp();
    ctx.emit(`${elem} = load i8*, i8** ${elemPtr}`);
    emitPrintStrNoNl(ctx, useStderr, elem);
  } else {
    const objStr = ctx.stringGen.doCreateStringConstant("[object Object]");
    emitPrintStrNoNl(ctx, useStderr, objStr);
  }

  ctx.emit(`br label %${loopLatchLabel}`);

  ctx.emit(`${loopLatchLabel}:`);
  const iCurrent = ctx.nextTemp();
  ctx.emit(`${iCurrent} = load i32, i32* ${iAlloca}`);
  const iNext = ctx.nextTemp();
  ctx.emit(`${iNext} = add i32 ${iCurrent}, 1`);
  ctx.emit(`store i32 ${iNext}, i32* ${iAlloca}`);
  const done = ctx.nextTemp();
  ctx.emit(`${done} = icmp eq i32 ${iNext}, ${len}`);
  ctx.emit(`br i1 ${done}, label %${endLabel}, label %${loopLabel}`);

  ctx.emit(`${endLabel}:`);
  emitPrintStrNoNl(ctx, useStderr, closeBracket);
  ctx.emit(`br label %${doneLabel}`);

  ctx.emit(`${doneLabel}:`);
}

function emitSingleArg(
  ctx: MethodCallGeneratorContext,
  useStderr: boolean,
  arg: Expression,
  params: string[],
): void {
  const argTyped = arg as { type: string; value: string | number };

  if (argTyped.type === "string") {
    const strValue = argTyped.value as string;
    const strConstPtr = ctx.stringGen.doCreateStringConstant(strValue);
    emitPrintStrNoNl(ctx, useStderr, strConstPtr);
    return;
  }

  if (argTyped.type === "number") {
    const argValue = ctx.generateExpression(arg, params);
    emitPrintNumNoNl(ctx, useStderr, argValue);
    return;
  }

  const argValue = ctx.generateExpression(arg, params);

  const isString = ctx.isStringExpression(arg);
  if (isString) {
    emitPrintStrNoNl(ctx, useStderr, argValue);
    return;
  }

  const isArray = ctx.isArrayExpression(arg);
  if (isArray) {
    emitArrayPrint(ctx, useStderr, argValue, "Array");
    return;
  }

  const isStringArray = ctx.isStringArrayExpression(arg);
  if (isStringArray) {
    emitArrayPrint(ctx, useStderr, argValue, "StringArray");
    return;
  }

  const isObjectArray = ctx.isObjectArrayExpression(arg);
  if (isObjectArray) {
    emitArrayPrint(ctx, useStderr, argValue, "ObjectArray");
    return;
  }

  const varType = ctx.getVariableType(argValue);
  if (varType === "i8*") {
    emitPrintStrNoNl(ctx, useStderr, argValue);
    return;
  }
  if (varType && varType.endsWith("*")) {
    const objStr = ctx.stringGen.doCreateStringConstant("[object Object]");
    emitPrintStrNoNl(ctx, useStderr, objStr);
    return;
  }

  emitPrintNumNoNl(ctx, useStderr, argValue);
}

export function generateConsoleCallInline(
  ctx: MethodCallGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  const method = expr.method;
  const useStderr = method === "error" || method === "warn";

  if (expr.args.length === 0) {
    emitPrintNewline(ctx, useStderr);
    return "0.0";
  }

  for (let i = 0; i < expr.args.length; i++) {
    if (i > 0) {
      emitPrintSpace(ctx, useStderr);
    }
    emitSingleArg(ctx, useStderr, expr.args[i] as Expression, params);
  }
  emitPrintNewline(ctx, useStderr);

  return "0.0";
}
