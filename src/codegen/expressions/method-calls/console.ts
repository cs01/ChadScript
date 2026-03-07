import { Expression, MethodCallNode, StringNode } from "../../../ast/types.js";
import type { MethodCallGeneratorContext } from "../method-calls.js";

function emitPrint(
  ctx: MethodCallGeneratorContext,
  useStderr: boolean,
  fmtRef: string,
  args: string,
): void {
  if (useStderr) {
    const stderrPtr = ctx.emitLoad("i8*", "@stderr");
    const temp = ctx.nextTemp();
    ctx.emit(`${temp} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, ${fmtRef}${args})`);
    const flushTemp = ctx.emitCall("i32", "@fflush", `i8* ${stderrPtr}`);
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
  const len = ctx.emitLoad("i32", lenPtr);

  const openBracket = ctx.stringGen.doCreateStringConstant("[ ");
  const closeBracket = ctx.stringGen.doCreateStringConstant(" ]");
  const separator = ctx.stringGen.doCreateStringConstant(", ");
  const emptyArray = ctx.stringGen.doCreateStringConstant("[]");

  const isEmpty = ctx.emitIcmp("eq", "i32", len, "0");

  const emptyLabel = ctx.nextLabel("arr_empty");
  const nonEmptyLabel = ctx.nextLabel("arr_nonempty");
  const loopLabel = ctx.nextLabel("arr_loop");
  const loopBodyLabel = ctx.nextLabel("arr_body");
  const sepLabel = ctx.nextLabel("arr_sep");
  const loopLatchLabel = ctx.nextLabel("arr_latch");
  const endLabel = ctx.nextLabel("arr_end");
  const doneLabel = ctx.nextLabel("arr_done");

  ctx.emitBrCond(isEmpty, emptyLabel, nonEmptyLabel);

  ctx.emitLabel(emptyLabel);
  emitPrintStrNoNl(ctx, useStderr, emptyArray);
  ctx.emitBr(doneLabel);

  ctx.emitLabel(nonEmptyLabel);
  let dataPtr: string;
  if (arrayType === "Array") {
    const dataPtrField = ctx.nextTemp();
    ctx.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    dataPtr = ctx.emitLoad("double*", dataPtrField);
  } else if (arrayType === "StringArray") {
    const dataPtrField = ctx.nextTemp();
    ctx.emit(
      `${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
    );
    dataPtr = ctx.emitLoad("i8**", dataPtrField);
  } else {
    const dataPtrField = ctx.nextTemp();
    ctx.emit(
      `${dataPtrField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`,
    );
    const rawData = ctx.emitLoad("i8*", dataPtrField);
    dataPtr = ctx.emitBitcast(rawData, "i8*", "i8**");
  }
  emitPrintStrNoNl(ctx, useStderr, openBracket);
  const iAlloca = ctx.nextTemp();
  ctx.emit(`${iAlloca} = alloca i32`);
  ctx.emitStore("i32", "0", iAlloca);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(loopLabel);
  const i = ctx.emitLoad("i32", iAlloca);
  const isFirst = ctx.emitIcmp("eq", "i32", i, "0");
  ctx.emitBrCond(isFirst, loopBodyLabel, sepLabel);

  ctx.emitLabel(sepLabel);
  emitPrintStrNoNl(ctx, useStderr, separator);
  ctx.emitBr(loopBodyLabel);

  ctx.emitLabel(loopBodyLabel);
  if (arrayType === "Array") {
    const elemPtr = ctx.nextTemp();
    ctx.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${i}`);
    const elem = ctx.emitLoad("double", elemPtr);
    emitPrintNumNoNl(ctx, useStderr, elem);
  } else if (arrayType === "StringArray") {
    const elemPtr = ctx.nextTemp();
    ctx.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${i}`);
    const elem = ctx.emitLoad("i8*", elemPtr);
    emitPrintStrNoNl(ctx, useStderr, elem);
  } else {
    const objStr = ctx.stringGen.doCreateStringConstant("[object Object]");
    emitPrintStrNoNl(ctx, useStderr, objStr);
  }

  ctx.emitBr(loopLatchLabel);

  ctx.emitLabel(loopLatchLabel);
  const iCurrent = ctx.emitLoad("i32", iAlloca);
  const iNext = ctx.nextTemp();
  ctx.emit(`${iNext} = add i32 ${iCurrent}, 1`);
  ctx.emitStore("i32", iNext, iAlloca);
  const done = ctx.emitIcmp("eq", "i32", iNext, len);
  ctx.emitBrCond(done, endLabel, loopLabel);

  ctx.emitLabel(endLabel);
  emitPrintStrNoNl(ctx, useStderr, closeBracket);
  ctx.emitBr(doneLabel);

  ctx.emitLabel(doneLabel);
}

function emitSingleArg(
  ctx: MethodCallGeneratorContext,
  useStderr: boolean,
  arg: Expression,
  params: string[],
): void {
  if (arg.type === "string") {
    const strNode = arg as StringNode;
    const strValue = strNode.value;
    const strConstPtr = ctx.stringGen.doCreateStringConstant(strValue);
    emitPrintStrNoNl(ctx, useStderr, strConstPtr);
    return;
  }

  if (arg.type === "number") {
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

export function generateConsoleTime(
  ctx: MethodCallGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  ctx.setUsesConsoleTime(true);
  ctx.setUsesUvHrtime(true);

  let labelPtr: string;
  if (expr.args.length > 0) {
    labelPtr = ctx.generateExpression(expr.args[0], params);
  } else {
    labelPtr = ctx.stringGen.doCreateStringConstant("default");
  }

  const ns = ctx.emitCall("i64", "@uv_hrtime", "");
  const storeResult = ctx.emitCall("i32", "@__console_timer_store", `i8* ${labelPtr}, i64 ${ns}`);

  return "0.0";
}

export function generateConsoleTimeEnd(
  ctx: MethodCallGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  ctx.setUsesConsoleTime(true);
  ctx.setUsesUvHrtime(true);

  let labelPtr: string;
  if (expr.args.length > 0) {
    labelPtr = ctx.generateExpression(expr.args[0], params);
  } else {
    labelPtr = ctx.stringGen.doCreateStringConstant("default");
  }

  const endNs = ctx.emitCall("i64", "@uv_hrtime", "");
  const startNs = ctx.emitCall("i64", "@__console_timer_load", `i8* ${labelPtr}`);

  const diffNs = ctx.nextTemp();
  ctx.emit(`${diffNs} = sub i64 ${endNs}, ${startNs}`);
  const diffDbl = ctx.nextTemp();
  ctx.emit(`${diffDbl} = uitofp i64 ${diffNs} to double`);
  const diffMs = ctx.nextTemp();
  ctx.emit(`${diffMs} = fdiv double ${diffDbl}, 1000000.0`);

  const fmtStr = ctx.stringGen.doCreateStringConstant("%s: %.3fms\n");
  const printResult = ctx.nextTemp();
  ctx.emit(
    `${printResult} = call i32 (i8*, ...) @printf(i8* ${fmtStr}, i8* ${labelPtr}, double ${diffMs})`,
  );

  return "0.0";
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
